import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { loggedPath, requestLogger } from './requestLogger';

it('logs the request and its status with the download ticket redacted', async () => {
  const path = '/api/admin/backups/archive.zip/download';
  const app = new Hono().use(requestLogger).get(path, (c) => c.text('Denied', 401));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const response = await app.request(`${path}?%61ccess=test-ticket&source=browser`);
    expect(response.status).toBe(401);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(1, `<-- GET ${path}?access=redacted&source=browser`);
    const outgoing = String(log.mock.calls[1]?.[0]);
    expect(outgoing).toMatch(
      new RegExp(`^--> GET ${path}\\?access=redacted&source=browser 401 \\d+ms$`),
    );
    expect(outgoing).not.toContain('test-ticket');
  } finally {
    log.mockRestore();
  }
});

it('keeps the parameters that are not credentials', () => {
  expect(loggedPath('http://app/api/shapes/tasks?offset=-1&handle=h1')).toBe(
    '/api/shapes/tasks?offset=-1&handle=h1',
  );
  expect(loggedPath('http://app/api/health')).toBe('/api/health');
});

it('omits every query parameter on the MCP endpoint', () => {
  expect(loggedPath('http://app/api/mcp?token=test-token&source=client')).toBe('/api/mcp');
  expect(loggedPath('http://app/api/mcp/?token=test-token')).toBe('/api/mcp/');
});
