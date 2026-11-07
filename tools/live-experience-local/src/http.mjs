import { createServer } from 'node:http';

export async function startHttp(engine, port = 8787) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('INVALID_PORT');
  const server = createServer(async (request, response) => {
    const allowedHost = '127.0.0.1:' + server.address().port;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const json = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); };
    if (request.headers.host !== allowedHost || request.headers.origin) return json(403, { error: 'LOCAL_ORIGIN_ONLY' });
    if (request.method !== 'GET') return json(405, { error: 'READ_ONLY_LOCAL_API' });
    try {
      const url = new URL(request.url, 'http://' + allowedHost);
      if (url.pathname === '/health') return json(200, engine.status());
      if (url.pathname === '/v1/photos') return json(200, engine.snapshot());
      const match = url.pathname.match(/^\/v1\/media\/([a-f0-9-]{36})\/(thumbnail|display)$/);
      if (match) {
        const bytes = await engine.media(match[1], match[2]);
        if (bytes) { response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length }); response.end(bytes); return; }
      }
      return json(404, { error: 'NOT_FOUND' });
    } catch { return json(503, { error: 'LOCAL_SERVICE_UNAVAILABLE' }); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
