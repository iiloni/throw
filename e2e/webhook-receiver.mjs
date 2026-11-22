// A webhook receiver for E2E tests, run inside the app container (`./scripts/dev.sh exec`)
// so the server reaches it on loopback. Prints its port, then one JSON line per request.
// It answers 204, or the status named by a `/status/<code>` path, and exits when its
// stdin closes.
import { createServer } from 'node:http';

const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    process.stdout.write(
      `${JSON.stringify({ method: request.method, url: request.url, headers: request.headers, body })}\n`,
    );
    const status = Number(/^\/status\/(\d{3})/.exec(request.url ?? '')?.[1] ?? 204);
    response.writeHead(status).end();
  });
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`);
});

process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
// Never outlive a test that lost track of it.
setTimeout(() => process.exit(0), 10 * 60_000).unref();
