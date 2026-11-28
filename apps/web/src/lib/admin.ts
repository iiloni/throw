import {
  adminUserSchema,
  type CreateInvite,
  createInviteResponseSchema,
  invitesResponseSchema,
  type ListUsers,
  resetUserPasswordResponseSchema,
  type UserRole,
  userActionResponseSchema,
  usersResponseSchema,
} from '@throw/shared';
import { z } from 'zod';
import { getAuthToken } from './auth';
import { compatibleFetch } from './compatibility';
import { getServerUrl } from './serverUrl';

/**
 * The server's user directory and invites, for its admins (ADR 0018). Like backups these are
 * plain requests rather than queued writes: each needs the server's answer now.
 */
export class AdminRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }

  /** The server no longer takes this session for an admin's. */
  get accessDenied() {
    return this.status === 401 || this.status === 403;
  }
}

const errorSchema = z.object({ error: z.string() });

async function failure(response: Response) {
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    // Not from the API: a proxy's error page.
  }
  const error = errorSchema.safeParse(parsed);
  return new AdminRequestError(
    response.status,
    error.success ? error.data.error : 'The server did not answer as expected.',
  );
}

function withTimeout(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20_000);
  if (!signal) return timeout;
  // Older Android WebViews lack `AbortSignal.any`; the caller's signal alone still cancels.
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal;
}

async function send(
  path: string,
  { method = 'GET', body, signal }: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await compatibleFetch(`${getServerUrl()}/api/admin${path}`, {
      method,
      cache: 'no-store',
      signal: withTimeout(signal),
      headers: {
        Authorization: `Bearer ${getAuthToken() ?? ''}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AdminRequestError(0, 'Could not reach the Throw server.');
  }
  if (!response.ok) throw await failure(response);
  return response.json();
}

const user = (id: string) => `/users/${encodeURIComponent(id)}`;

export const adminApi = {
  users: async (query: ListUsers, signal?: AbortSignal) => {
    const search = new URLSearchParams({
      search: query.search,
      offset: String(query.offset),
      limit: String(query.limit),
    });
    return usersResponseSchema.parse(await send(`/users?${search}`, { signal }));
  },
  setRole: async (id: string, role: UserRole) =>
    adminUserSchema.parse(await send(`${user(id)}/role`, { method: 'PATCH', body: { role } })),
  resetPassword: async (id: string) =>
    resetUserPasswordResponseSchema.parse(
      await send(`${user(id)}/reset-password`, { method: 'POST' }),
    ),
  deleteUser: async (id: string) =>
    userActionResponseSchema.parse(await send(user(id), { method: 'DELETE' })),
  invites: async (signal?: AbortSignal) =>
    invitesResponseSchema.parse(await send('/invites', { signal })),
  createInvite: async (body: CreateInvite) =>
    createInviteResponseSchema.parse(await send('/invites', { method: 'POST', body })),
  deleteInvite: async (id: string) =>
    userActionResponseSchema.parse(
      await send(`/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    ),
};

/** A date as the admin pages list it: day, month and year, in the device's language. */
export const formatDay = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export const formatMoment = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
