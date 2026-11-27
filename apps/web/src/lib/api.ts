import type {
  CreateComment,
  CreateGithubConnection,
  CreateMcpToken,
  CreateProject,
  CreateStatus,
  CreateTag,
  CreateTask,
  CreateTaskRelation,
  CreateWebhook,
  CreateWorkspace,
  ReleasesResponse,
  TagWriteResponse,
  TxidResponse,
  UpdateComment,
  UpdateGithubConnection,
  UpdateProject,
  UpdateStatus,
  UpdateTag,
  UpdateTask,
  UpdateTaskResponse,
  UpdateWebhook,
  UpdateWorkspace,
  VersionInfo,
} from '@throw/shared';
import {
  createMcpTokenResponseSchema,
  githubConnectionResponseSchema,
  githubConnectionSecretResponseSchema,
  type linkGithubRequestSchema,
  mcpTokensResponseSchema,
  txidResponseSchema,
  webhookResponseSchema,
  webhookSecretResponseSchema,
  webhooksResponseSchema,
  webhookTestResponseSchema,
} from '@throw/shared';
import type { z } from 'zod';
import { getAuthToken } from './auth';
import { compatibleFetch, ensureStatusColorSupport, ensureTaskSizeSupport } from './compatibility';
import { getServerUrl } from './serverUrl';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Refused because it went with a token this device has since replaced. */
    readonly staleToken = false,
  ) {
    super(message);
  }
}

export type LinkGithubRequest = z.input<typeof linkGithubRequestSchema>;

async function apiResponse(path: string, init: RequestInit) {
  const token = getAuthToken();
  const response = await compatibleFetch(`${getServerUrl()}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const stale = response.status === 401 && token !== getAuthToken();
    throw new ApiError(response.status, await response.text(), stale);
  }
  return response;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await apiResponse(path, init);
  return response.json() as Promise<T>;
}

async function writeWithCapability<T>(
  path: string,
  method: string,
  body: object,
  ensureSupport?: (force?: boolean) => Promise<void>,
  force = false,
) {
  await ensureSupport?.(force);
  try {
    return await request<T>(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    // A server downgraded since bootstrap can reject the new field with a validation error.
    if (error instanceof ApiError && error.status === 400) await ensureSupport?.(true);
    throw error;
  }
}

// Version discovery remains available while the protocol gate pauses data requests.
async function bootstrap<T>(path: string): Promise<T> {
  const response = await fetch(`${getServerUrl()}/api${path}`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${getAuthToken() ?? ''}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return response.json() as Promise<T>;
}
export const api = {
  mcpTokens: (signal?: AbortSignal) =>
    request<unknown>('/mcp-tokens', { cache: 'no-store', signal }).then(
      mcpTokensResponseSchema.parse,
    ),
  createMcpToken: (body: CreateMcpToken) =>
    request<unknown>('/mcp-tokens', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).then(createMcpTokenResponseSchema.parse),
  revokeMcpToken: (id: string) =>
    apiResponse(`/mcp-tokens/${id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(20_000),
    }),
  webhooks: (signal?: AbortSignal) =>
    request<unknown>('/webhooks', { cache: 'no-store', signal }).then(webhooksResponseSchema.parse),
  createWebhook: (body: CreateWebhook) =>
    request<unknown>('/webhooks', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).then(webhookSecretResponseSchema.parse),
  updateWebhook: (id: string, body: UpdateWebhook) =>
    request<unknown>(`/webhooks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).then(webhookResponseSchema.parse),
  deleteWebhook: (id: string) =>
    apiResponse(`/webhooks/${id}`, { method: 'DELETE', signal: AbortSignal.timeout(20_000) }),
  rotateWebhookSecret: (id: string) =>
    request<unknown>(`/webhooks/${id}/secret`, {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
    }).then(webhookSecretResponseSchema.parse),
  // The server waits up to ten seconds for the receiver.
  testWebhook: (id: string) =>
    request<unknown>(`/webhooks/${id}/test`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    }).then(webhookTestResponseSchema.parse),
  githubConnection: (projectId: string, signal?: AbortSignal) =>
    request<unknown>(`/integrations/github/projects/${projectId}`, {
      cache: 'no-store',
      signal,
    }).then(githubConnectionResponseSchema.parse),
  createGithubConnection: (projectId: string, body: CreateGithubConnection) =>
    request<unknown>(`/integrations/github/projects/${projectId}`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).then(githubConnectionSecretResponseSchema.parse),
  updateGithubConnection: (projectId: string, body: UpdateGithubConnection) =>
    request<unknown>(`/integrations/github/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).then(githubConnectionResponseSchema.parse),
  deleteGithubConnection: (projectId: string) =>
    apiResponse(`/integrations/github/projects/${projectId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(20_000),
    }),
  rotateGithubSecret: (projectId: string) =>
    request<unknown>(`/integrations/github/projects/${projectId}/secret`, {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
    }).then(githubConnectionSecretResponseSchema.parse),
  rotateGithubUrl: (projectId: string) =>
    request<unknown>(`/integrations/github/projects/${projectId}/url`, {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
    }).then(githubConnectionResponseSchema.parse),
  // A task's pull request and issue links (ADR 0017): online only, since a link needs the
  // connection the server holds. The new row arrives through the links shape.
  linkGithub: (taskId: string, body: LinkGithubRequest) =>
    request<unknown>(`/integrations/github/tasks/${taskId}/links`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).then(txidResponseSchema.parse),
  unlinkGithub: (taskId: string, linkId: string) =>
    request<unknown>(`/integrations/github/tasks/${taskId}/links/${linkId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(20_000),
    }).then(txidResponseSchema.parse),
  versionInfo: () => bootstrap<VersionInfo>('/updates'),
  releases: () => bootstrap<ReleasesResponse>('/updates/releases'),
  createWorkspace: (body: CreateWorkspace) =>
    request<TxidResponse>('/workspaces', { method: 'POST', body: JSON.stringify(body) }),
  updateWorkspace: (id: string, body: UpdateWorkspace) =>
    request<TxidResponse>(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteWorkspace: (id: string) => request<TxidResponse>(`/workspaces/${id}`, { method: 'DELETE' }),
  createProject: (body: CreateProject) =>
    request<TxidResponse>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  updateProject: (id: string, body: UpdateProject) =>
    request<TxidResponse>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  purgeProject: (id: string) => request<TxidResponse>(`/projects/${id}`, { method: 'DELETE' }),
  createStatus: (body: CreateStatus) =>
    writeWithCapability<TxidResponse>(
      '/statuses',
      'POST',
      body,
      body.color !== undefined ? ensureStatusColorSupport : undefined,
      // Older servers silently discard unknown create fields, so get a fresh capability.
      true,
    ),
  updateStatus: (id: string, body: UpdateStatus) =>
    writeWithCapability<TxidResponse>(
      `/statuses/${id}`,
      'PATCH',
      body,
      body.color !== undefined ? ensureStatusColorSupport : undefined,
    ),
  deleteStatus: (id: string) => request<TxidResponse>(`/statuses/${id}`, { method: 'DELETE' }),
  createTag: (body: CreateTag) =>
    request<TagWriteResponse>('/tags', { method: 'POST', body: JSON.stringify(body) }),
  updateTag: (id: string, body: UpdateTag) =>
    request<TagWriteResponse>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTag: (id: string) => request<TagWriteResponse>(`/tags/${id}`, { method: 'DELETE' }),
  createTask: (body: CreateTask) =>
    writeWithCapability<TagWriteResponse>(
      '/tasks',
      'POST',
      body,
      body.size !== undefined ? ensureTaskSizeSupport : undefined,
    ),
  updateTask: (id: string, body: UpdateTask) =>
    writeWithCapability<UpdateTaskResponse>(
      `/tasks/${id}`,
      'PATCH',
      body,
      body.changes.size !== undefined ? ensureTaskSizeSupport : undefined,
    ),
  purgeTask: (id: string) => request<TxidResponse>(`/tasks/${id}`, { method: 'DELETE' }),
  createTaskRelation: (body: CreateTaskRelation) =>
    request<TxidResponse>('/task-relations', { method: 'POST', body: JSON.stringify(body) }),
  deleteTaskRelation: (id: string) =>
    request<TxidResponse>(`/task-relations/${id}`, { method: 'DELETE' }),
  createComment: (body: CreateComment) =>
    request<TxidResponse>('/comments', { method: 'POST', body: JSON.stringify(body) }),
  updateComment: (id: string, body: UpdateComment) =>
    request<TxidResponse>(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteComment: (id: string) => request<TxidResponse>(`/comments/${id}`, { method: 'DELETE' }),
};
