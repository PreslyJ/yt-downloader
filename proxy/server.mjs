// Tiny authenticated HTTP CONNECT proxy that only tunnels to YouTube hosts.
// Run on a machine with a home IP and expose it to the Vercel deployment
// (e.g. Tailscale Funnel), then set YT_PROXY_URL on Vercel to point at it.
//
//   PROXY_USER=yt PROXY_PASS=... node proxy/server.mjs
import http from 'node:http';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';

const USER = process.env.PROXY_USER;
const PASS = process.env.PROXY_PASS;
const PORT = Number(process.env.PROXY_PORT ?? 8899);
const HOST = process.env.PROXY_HOST ?? '127.0.0.1';

if (!USER || !PASS || PASS.length < 16) {
  console.error('PROXY_USER and PROXY_PASS (min 16 chars) are required');
  process.exit(1);
}

const ALLOWED_HOST = /(^|\.)(youtube\.com|googlevideo\.com|ytimg\.com)$/i;
const EXPECTED = Buffer.from(`Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`);

function authorized(header) {
  if (typeof header !== 'string') return false;
  const given = Buffer.from(header);
  return given.length === EXPECTED.length && timingSafeEqual(given, EXPECTED);
}

function reject(socket, status, message, extraHeaders = '') {
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\n${extraHeaders}Connection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

const server = http.createServer((_req, res) => {
  res.writeHead(405, { Connection: 'close' }).end();
});

server.on('connect', (req, clientSocket, head) => {
  if (!authorized(req.headers['proxy-authorization'])) {
    return reject(clientSocket, 407, 'Proxy Authentication Required', 'Proxy-Authenticate: Basic realm="yt"\r\n');
  }

  const target = req.url ?? '';
  const separator = target.lastIndexOf(':');
  const host = target.slice(0, separator);
  const port = Number(target.slice(separator + 1));

  if (port !== 443 || !ALLOWED_HOST.test(host)) {
    console.warn(`blocked CONNECT ${target}`);
    return reject(clientSocket, 403, 'Forbidden');
  }

  const upstream = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  const close = () => {
    upstream.destroy();
    clientSocket.destroy();
  };
  upstream.on('error', close);
  clientSocket.on('error', close);
  upstream.setTimeout(120_000, close);
});

server.listen(PORT, HOST, () => console.log(`yt proxy listening on ${HOST}:${PORT}`));
