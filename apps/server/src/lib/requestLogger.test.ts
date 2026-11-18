import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { requestLogger } from './requestLogger';

it('logs the request path and response status without logging query credentials', async () => {
  const path = '/api/admin/backups/archive.zip/download';
  const app = new Hono().use(requestLogger).get(path, (c) => c.text('Denied', 401));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const response = await app.request(`${path}?%61ccess=test-ticket&source=browser`);
    expect(response.status).toBe(401);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(1, `<-- GET ${path}`);
    const outgoing = log.mock.calls[1]?.[0];
    expect(outgoing).toContain(`--> GET ${path} `);
    expect(outgoing).toContain('401');
    expect(outgoing).not.toContain('?');
  } finally {
    log.mockRestore();
  }
});
