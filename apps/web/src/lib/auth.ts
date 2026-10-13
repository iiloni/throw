import { Capacitor } from '@capacitor/core';
import { createAuthClient } from 'better-auth/react';
import { z } from 'zod';
import { getServerUrl } from './serverUrl';

const TOKEN_KEY = 'throw-auth-token';
const USER_KEY = 'throw-user';

function sessionKey(key: string) {
  // Bundled dev apps share https://localhost across worktrees; their servers do not.
  return Capacitor.isNativePlatform() && import.meta.env.THROW_DEV_SERVER_URL
    ? `${key}:${getServerUrl()}`
    : key;
}

const signedInUserSchema = z.object({ id: z.string().min(1), name: z.string(), email: z.string() });
export type SignedInUser = z.infer<typeof signedInUserSchema>;

export function getAuthToken(): string | null {
  return localStorage.getItem(sessionKey(TOKEN_KEY));
}

/**
 * The user the saved token belongs to, remembered from the last session the server returned.
 * Offline there is no session to fetch, and the app still needs to know whose data to open.
 */
export function getSignedInUser(): SignedInUser | null {
  try {
    const parsed = signedInUserSchema.safeParse(
      JSON.parse(localStorage.getItem(sessionKey(USER_KEY)) ?? ''),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearAuthToken() {
  localStorage.removeItem(sessionKey(TOKEN_KEY));
  localStorage.removeItem(sessionKey(USER_KEY));
}

function userOf(data: unknown): SignedInUser | null {
  if (!data || typeof data !== 'object' || !('user' in data)) return null;
  const parsed = signedInUserSchema.safeParse(data.user);
  if (!parsed.success) return null;
  const { id, name, email } = parsed.data;
  return { id, name, email };
}

/**
 * Every client authenticates with a bearer token rather than cookies, so the
 * web app and the Android app (a different origin) share one code path.
 */
export const authClient = createAuthClient({
  baseURL: getServerUrl(),
  basePath: '/api/auth',
  fetchOptions: {
    auth: { type: 'Bearer', token: () => getAuthToken() ?? '' },
    onSuccess: (context) => {
      // A sign-in returns a token, and so does a changed password.
      const token = context.response.headers.get('set-auth-token');
      if (token) localStorage.setItem(sessionKey(TOKEN_KEY), token);
      const user = userOf(context.data);
      if (user && getAuthToken()) localStorage.setItem(sessionKey(USER_KEY), JSON.stringify(user));
    },
  },
});

/**
 * The signed-in user, asking the server when this device has a token but has not remembered
 * the user yet. Null when signed out, or when that lookup fails offline.
 */
export async function resolveSignedInUser(): Promise<SignedInUser | null> {
  if (!getAuthToken()) return null;
  const remembered = getSignedInUser();
  if (remembered) return remembered;
  try {
    await authClient.getSession();
  } catch {
    // Offline: carry on without knowing the user.
  }
  return getSignedInUser();
}
