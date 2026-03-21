import { spawn } from 'child_process';
import { logger } from './logger.js';
import { resolveGroupIpcPath } from './group-folder.js';
import {
  CONTAINER_IMAGE,
  CREDENTIAL_PROXY_PORT,
  TIMEZONE,
} from './config.js';
import {
  CONTAINER_RUNTIME_BIN,
  CONTAINER_HOST_GATEWAY,
} from './container-runtime.js';
import { readEnvFile } from './env.js';
import { hostGatewayArgs, readonlyMountArgs } from './container-runtime.js';
import { detectAuthMode } from './credential-proxy.js';
import type { RegisteredGroup } from './types.js';

export interface SubagentRequest {
  requestId: string;
  type: 'search';
  prompt: string;
  timestamp: string;
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';
const SUBAGENT_TIMEOUT_MS = 60_000;

function buildSubagentArgs(
  mounts: Array<{ hostPath: string; containerPath: string; readonly?: boolean }>,
  containerName: string,
  subagentType: string,
): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  args.push('-e', `TZ=${TIMEZONE}`);
  args.push('-e', `NANOCLAW_SUBAGENT_TYPE=${subagentType}`);

  const containerSecrets = readEnvFile([
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
  ]);

  args.push('-e', `ANTHROPIC_BASE_URL=http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}`);

  const authMode = detectAuthMode();
  if (authMode === 'api-key') {
    args.push('-e', 'ANTHROPIC_API_KEY=placeholder');
  } else {
    args.push('-e', 'CLAUDE_CODE_OAUTH_TOKEN=placeholder');
  }

  if (containerSecrets.ANTHROPIC_DEFAULT_HAIKU_MODEL)
    args.push('-e', `ANTHROPIC_DEFAULT_HAIKU_MODEL=${containerSecrets.ANTHROPIC_DEFAULT_HAIKU_MODEL}`);
  if (containerSecrets.ANTHROPIC_DEFAULT_SONNET_MODEL)
    args.push('-e', `ANTHROPIC_DEFAULT_SONNET_MODEL=${containerSecrets.ANTHROPIC_DEFAULT_SONNET_MODEL}`);
  if (containerSecrets.ANTHROPIC_DEFAULT_OPUS_MODEL)
    args.push('-e', `ANTHROPIC_DEFAULT_OPUS_MODEL=${containerSecrets.ANTHROPIC_DEFAULT_OPUS_MODEL}`);

  args.push(...hostGatewayArgs());

  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
    args.push('--user', `${hostUid}:${hostGid}`);
    args.push('-e', 'HOME=/home/node');
  }

  for (const mount of mounts) {
    if (mount.readonly) {
      args.push(...readonlyMountArgs(mount.hostPath, mount.containerPath));
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  args.push(CONTAINER_IMAGE);
  return args;
}

export async function runSubagentContainer(
  group: RegisteredGroup,
  request: SubagentRequest,
  chatJid: string,
): Promise<string> {
  const containerName = `nanoclaw-subagent-${request.type}-${Date.now()}`;
  const groupIpcDir = resolveGroupIpcPath(group.folder);
  const mounts = [{ hostPath: groupIpcDir, containerPath: '/workspace/ipc' }];
  const containerArgs = buildSubagentArgs(mounts, containerName, request.type);

  const input = {
    prompt: request.prompt,
    groupFolder: group.folder,
    chatJid,
    isMain: false,
    assistantName: 'Andy',
  };

  logger.info({ group: group.name, type: request.type, containerName }, 'Spawning subagent container');

  return new Promise((resolve, reject) => {
    const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    container.stdin.write(JSON.stringify(input));
    container.stdin.end();

    let stdout = '';
    let result: string | null = null;

    container.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
      const endIdx = stdout.indexOf(OUTPUT_END_MARKER);
      if (startIdx !== -1 && endIdx !== -1) {
        const jsonStr = stdout.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.result) result = parsed.result;
        } catch { /* ignore */ }
      }
    });

    container.stderr.on('data', (data: Buffer) => {
      logger.debug({ group: group.name }, `Subagent stderr: ${data.toString().slice(0, 200)}`);
    });

    const timeout = setTimeout(() => {
      container.kill();
      reject(new Error('Subagent timeout after 60s'));
    }, SUBAGENT_TIMEOUT_MS);

    container.on('close', () => {
      clearTimeout(timeout);
      if (result) {
        logger.info({ group: group.name, type: request.type }, 'Subagent completed successfully');
        resolve(result);
      } else {
        reject(new Error('Subagent returned no result'));
      }
    });

    container.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
