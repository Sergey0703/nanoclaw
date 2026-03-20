import { setGlobalDispatcher, ProxyAgent } from '/opt/nanoclaw/node_modules/undici/index.js';
setGlobalDispatcher(new ProxyAgent('http://46.62.246.93:8888'));
await import('/root/.npm/_npx/e7216dc061acbf6a/node_modules/@sinco-lab/mcp-youtube-transcript/dist/index.js');
