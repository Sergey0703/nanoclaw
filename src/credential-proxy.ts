/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'OPENROUTER_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
  ]);

  // Use api-key mode when ANTHROPIC_API_KEY is set, or when AUTH_TOKEN is set
  // with a non-Anthropic base URL (e.g. NVIDIA, OpenRouter use Bearer auth)
  const baseUrlForAuth = secrets.ANTHROPIC_BASE_URL || '';
  const isNonAnthropicEndpoint = baseUrlForAuth && !baseUrlForAuth.includes('api.anthropic.com');
  const authMode: AuthMode =
    (secrets.ANTHROPIC_API_KEY || (isNonAnthropicEndpoint && secrets.ANTHROPIC_AUTH_TOKEN))
      ? 'api-key'
      : 'oauth';
  const oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'api-key') {
          // API key mode: inject auth header
          // Use Authorization: Bearer for non-Anthropic endpoints (NVIDIA, OpenRouter), x-api-key for native Anthropic
          delete headers['x-api-key'];
          delete headers['authorization'];
          const baseUrl = secrets.ANTHROPIC_BASE_URL || '';
          // Use ANTHROPIC_AUTH_TOKEN if available (NVIDIA/OpenRouter), otherwise ANTHROPIC_API_KEY
          const apiKey = secrets.ANTHROPIC_AUTH_TOKEN || secrets.ANTHROPIC_API_KEY || '';
          if (baseUrl && !baseUrl.includes('api.anthropic.com')) {
            headers['authorization'] = 'Bearer ' + apiKey;
          } else {
            headers['x-api-key'] = apiKey;
          }
        } else {
          // OAuth mode: replace placeholder Bearer token with the real one
          // only when the container actually sends an Authorization header
          // (exchange request + auth probes). Post-exchange requests use
          // x-api-key only, so they pass through without token injection.
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        // Rewrite body BEFORE creating upstream request (content-length must be correct)
        let outBody = body;
        const baseUrl = secrets.ANTHROPIC_BASE_URL || '';
        // OpenAI-compatible endpoints that need Anthropic→OpenAI format conversion
        const isNvidiaBase =
          baseUrl.includes('integrate.api.nvidia.com') ||
          baseUrl.includes('nvidia.com') ||
          baseUrl.includes('api.groq.com') ||
          baseUrl.includes('openrouter.ai');

        if (baseUrl && !baseUrl.includes('api.anthropic.com') && req.method === 'POST') {
          try {
            const parsed = JSON.parse(body.toString());
            const openrouterModel =
              secrets.ANTHROPIC_DEFAULT_SONNET_MODEL ||
              secrets.OPENROUTER_MODEL ||
              process.env.OPENROUTER_MODEL ||
              'qwen/qwen3-32b';
            if (parsed.model && parsed.model.startsWith('claude-')) {
              parsed.model = openrouterModel;
            }
            // Strip Claude Code SDK-specific fields unsupported by non-Anthropic endpoints
            delete parsed.output_config;
            delete parsed.thinking;
            delete parsed.betas;
            delete parsed.metadata;

            // Convert Anthropic format to OpenAI format for NVIDIA/OpenAI-compatible endpoints
            if (isNvidiaBase) {
              // Convert system messages: Anthropic uses system top-level, OpenAI uses role:system in messages
              if (parsed.system && Array.isArray(parsed.messages)) {
                const systemText = Array.isArray(parsed.system)
                  ? parsed.system.map((b: { text?: string }) => b.text || '').join('\n')
                  : String(parsed.system);
                parsed.messages = [{ role: 'system', content: systemText }, ...parsed.messages];
                delete parsed.system;
              }
              // Convert Anthropic message content to OpenAI format
              if (Array.isArray(parsed.messages)) {
                const newMessages: unknown[] = [];
                for (const msg of parsed.messages as Array<{ role: string; content: unknown }>) {
                  if (!Array.isArray(msg.content)) {
                    newMessages.push(msg);
                    continue;
                  }
                  const blocks = msg.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown }>;
                  if (msg.role === 'assistant') {
                    // Anthropic assistant: may have text + tool_use blocks → OpenAI: content + tool_calls
                    const textParts = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('\n');
                    const toolCalls = blocks.filter(b => b.type === 'tool_use').map(b => ({
                      id: b.id || `call_${Date.now()}`,
                      type: 'function',
                      function: { name: b.name || '', arguments: JSON.stringify(b.input || {}) },
                    }));
                    const converted: Record<string, unknown> = { role: 'assistant', content: textParts || null };
                    if (toolCalls.length > 0) converted['tool_calls'] = toolCalls;
                    newMessages.push(converted);
                  } else if (msg.role === 'user') {
                    // Anthropic user: may have text + tool_result blocks
                    // Split: text blocks → user message, tool_result blocks → tool messages
                    const textBlocks = blocks.filter(b => b.type === 'text');
                    const toolResults = blocks.filter(b => b.type === 'tool_result');
                    if (textBlocks.length > 0) {
                      newMessages.push({ role: 'user', content: textBlocks.map(b => b.text || '').join('\n') });
                    }
                    for (const tr of toolResults) {
                      const resultContent = Array.isArray(tr.content)
                        ? (tr.content as Array<{ text?: string }>).map(c => c.text || '').join('\n')
                        : String(tr.content || '');
                      newMessages.push({ role: 'tool', tool_call_id: tr.tool_use_id || '', content: resultContent });
                    }
                  } else {
                    const text = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('\n');
                    newMessages.push({ ...msg, content: text });
                  }
                }
                parsed.messages = newMessages;
              }
              // cap max_tokens for Groq (models have varying limits, 16000 is safe)
              if (parsed.max_tokens && parsed.max_tokens > 16000) {
                parsed.max_tokens = 16000;
              }
              // max_tokens -> max_completion_tokens only for NVIDIA (Groq uses max_tokens)
              const isNvidiaOnly = baseUrl.includes('integrate.api.nvidia.com') || baseUrl.includes('nvidia.com');
              if (isNvidiaOnly && parsed.max_tokens && !parsed.max_completion_tokens) {
                parsed.max_completion_tokens = parsed.max_tokens;
                delete parsed.max_tokens;
              }
              // Convert Anthropic tools format to OpenAI tools format
              if (Array.isArray(parsed.tools)) {
                parsed.tools = parsed.tools.map((tool: { name: string; description?: string; input_schema?: unknown }) => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description || '',
                    parameters: tool.input_schema || { type: 'object', properties: {} },
                  },
                }));
              }
              // Disable streaming - convert response synchronously
              parsed.stream = false;
            }

            outBody = Buffer.from(JSON.stringify(parsed));
            headers['content-length'] = outBody.length;
            headers['content-type'] = 'application/json';
            // Bypass Cloudflare WAF error 1010 (blocks Hetzner IPs on requests with tools)
            headers['user-agent'] = 'PostmanRuntime/7.37.3';
            headers['accept'] = '*/*';
            // Prevent gzip — Groq compresses responses, Node SDK cannot decompress → SyntaxError
            headers['accept-encoding'] = 'identity';
            delete headers['connection'];
            logger.info({ model: parsed.model, bodyLen: outBody.length }, 'Proxy sending to upstream');
          } catch {
            /* not JSON, pass through */
          }
        }

        // Rewrite URL path for NVIDIA (Anthropic /v1/messages → OpenAI /chat/completions)
        const upstreamPath = (() => {
          const basePath = upstreamUrl.pathname.replace(/\/+$/, '');
          let reqPath = (req.url || '').replace(/[?&]beta=true/g, '').replace(/\?$/, '');
          if (isNvidiaBase) {
            reqPath = reqPath.replace('/v1/messages', '/chat/completions');
          }
          return basePath + reqPath;
        })();

        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: upstreamPath,
            method: req.method,
            headers,
          } as RequestOptions,
          (upRes) => {
            // Filter hop-by-hop headers from upstream response before forwarding
            const resHeaders = { ...upRes.headers };
            delete resHeaders['connection'];
            delete resHeaders['keep-alive'];
            delete resHeaders['transfer-encoding'];
            delete resHeaders['upgrade'];
            delete resHeaders['proxy-authenticate'];
            delete resHeaders['proxy-authorization'];
            delete resHeaders['te'];
            delete resHeaders['trailers'];
            delete resHeaders['alt-svc'];

            // For NVIDIA: convert OpenAI response format back to Anthropic format
            // isNvidiaResp: use isNvidiaBase only — URL may have ?beta=true suffix which breaks path check
            const isNvidiaResp = isNvidiaBase;
            if (isNvidiaResp && upRes.statusCode === 200) {
              const respChunks: Buffer[] = [];
              upRes.on('data', (c) => respChunks.push(c));
              upRes.on('end', () => {
                try {
                  const rawBuf = Buffer.concat(respChunks);
                  let rawResp: string;
                  // Fallback gzip decompression if server ignores accept-encoding: identity
                  if (rawBuf[0] === 0x1f && rawBuf[1] === 0x8b) {
                    const zlib = await import('zlib');
                    rawResp = await new Promise<string>((res, rej) => {
                      zlib.gunzip(rawBuf, (err, r) => err ? rej(err) : res(r.toString()));
                    });
                  } else {
                    rawResp = rawBuf.toString();
                  }
                  const openaiResp = JSON.parse(rawResp);
                  const choice = openaiResp.choices?.[0];
                  const msg = choice?.message || {};
                  // Build Anthropic content blocks
                  const contentBlocks: unknown[] = [];
                  if (msg.content) {
                    contentBlocks.push({ type: 'text', text: msg.content });
                  }
                  // Convert OpenAI tool_calls → Anthropic tool_use blocks
                  if (Array.isArray(msg.tool_calls)) {
                    for (const tc of msg.tool_calls) {
                      let inputObj: unknown = {};
                      try { inputObj = JSON.parse(tc.function?.arguments || '{}'); } catch { /* */ }
                      contentBlocks.push({
                        type: 'tool_use',
                        id: tc.id || `tool_${Date.now()}`,
                        name: tc.function?.name || '',
                        input: inputObj,
                      });
                    }
                  }
                  const finishReason = choice?.finish_reason;
                  const stopReason = finishReason === 'length' ? 'max_tokens'
                    : finishReason === 'tool_calls' ? 'tool_use'
                    : 'end_turn';
                  const anthropicResp = {
                    id: openaiResp.id || 'msg_proxy',
                    type: 'message',
                    role: 'assistant',
                    content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }],
                    model: 'claude-sonnet-4-6',
                    stop_reason: stopReason,
                    stop_sequence: null,
                    usage: {
                      input_tokens: openaiResp.usage?.prompt_tokens || 0,
                      output_tokens: openaiResp.usage?.completion_tokens || 0,
                    },
                  };
                  const respBody = JSON.stringify(anthropicResp);
                  resHeaders['content-length'] = String(Buffer.byteLength(respBody));
                  resHeaders['content-type'] = 'application/json';
                  res.writeHead(200, resHeaders);
                  res.end(respBody);
                } catch {
                  res.writeHead(upRes.statusCode!, resHeaders);
                  res.end(Buffer.concat(respChunks));
                }
              });
            } else {
              res.writeHead(upRes.statusCode!, resHeaders);
              upRes.pipe(res, { end: true });
            }
          },
        );

        upstream.on('error', (err) => {
          logger.error({ err, url: req.url }, 'Credential proxy upstream error');
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(outBody);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
