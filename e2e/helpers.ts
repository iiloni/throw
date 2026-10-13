import {
  type APIRequestContext,
  type APIResponse,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { z } from 'zod';

// Signing in reloads the page to open that user's local database. The dev server sends the
// app unbundled, so on a busy machine that load far outlasts the default five seconds.
export const APP_LOAD_TIMEOUT = 30_000;

const signUpResponse = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
});

const origin = () => new URL(test.info().project.use.baseURL ?? '').origin;
const freshEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

/**
 * The bearer token of the session a sign-in or sign-up response opened. The `token` in its
 * body is the bare session token, which the API does not take: only this signed one.
 */
export function bearerToken(response: APIResponse) {
  const token = response.headers()['set-auth-token'];
  expect(token).toBeTruthy();
  return token as string;
}

/** Makes an account through the API and returns what a request as that user needs. */
export async function createAccount(request: APIRequestContext) {
  const email = freshEmail();
  const response = await request.post('/api/auth/sign-up/email', {
    headers: { Origin: origin() },
    data: { email, name: '', password: 'password123' },
  });
  expect(response.ok()).toBeTruthy();
  const { user } = signUpResponse.parse(await response.json());
  const token = bearerToken(response);
  return { email, user, token, headers: { Authorization: `Bearer ${token}` } };
}

/**
 * Signs up a fresh user, so each test starts with only the workspace every account gets.
 * The account is made through the API and its session stored as the app stores one, which
 * takes one page load where the form takes two. `auth.spec.ts` covers the form.
 */
export async function signUp(page: Page) {
  const account = await createAccount(page.request);
  const context = page.context();
  await context.setStorageState({
    // The form's request leaves the session cookie in the browser too.
    cookies: await context.cookies(),
    origins: [
      {
        origin: origin(),
        localStorage: [
          { name: 'throw-auth-token', value: account.token },
          { name: 'throw-user', value: JSON.stringify(account.user) },
        ],
      },
    ],
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Personal' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  return account;
}

const shapeMessages = z.array(
  z.object({
    key: z.string().optional(),
    value: z.record(z.string(), z.unknown()).optional(),
    headers: z.object({ operation: z.string().optional() }).loose(),
  }),
);

/**
 * The rows a shape holds for the signed-in user now, read through the server's proxy. The
 * first response is the shape as it was when Electric first built it, so this follows its
 * log to the end.
 */
export async function shapeRows(
  request: APIRequestContext,
  shape: string,
  headers: Record<string, string>,
) {
  const rows = new Map<string, Record<string, unknown>>();
  let offset = '-1';
  let handle: string | undefined;
  for (let reads = 0; reads < 50; reads++) {
    const query = new URLSearchParams({ offset, ...(handle ? { handle } : {}) });
    const response = await request.get(`/api/shapes/${shape}?${query}`, { headers });
    expect(response.ok()).toBeTruthy();
    for (const { key, value, headers: message } of shapeMessages.parse(await response.json())) {
      if (!key) continue;
      if (message.operation === 'delete') rows.delete(key);
      else rows.set(key, { ...rows.get(key), ...value });
    }
    handle = response.headers()['electric-handle'];
    offset = response.headers()['electric-offset'] ?? offset;
    if ('electric-up-to-date' in response.headers()) return [...rows.values()];
  }
  throw new Error(`The ${shape} shape never caught up`);
}
