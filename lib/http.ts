import { ProxyAgent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';

// YouTube blocks datacenter IPs (Vercel included). When YT_PROXY_URL is set,
// every YouTube request goes through that (residential) proxy. Stream URLs are
// bound to the IP that requested them, so the player request and the media
// download must share one exit IP — use a sticky-session proxy endpoint.
let agent: ProxyAgent | null | undefined;

function getAgent(): ProxyAgent | null {
  if (agent === undefined) {
    const proxyUrl = process.env.YT_PROXY_URL;
    agent = proxyUrl ? new ProxyAgent(proxyUrl) : null;
  }
  return agent;
}

export function proxyEnabled(): boolean {
  return getAgent() !== null;
}

export function ytFetch(url: string, init: UndiciRequestInit = {}) {
  const dispatcher = getAgent();
  return undiciFetch(url, dispatcher ? { ...init, dispatcher } : init);
}
