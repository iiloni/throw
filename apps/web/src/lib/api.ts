import type {
  CreateComment,
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
  mcpTokensResponseSchema,
  webhookResponseSchema,
  webhookSecretResponseSchema,
  webhooksResponseSchema,
  webhookTestResponseSchema,
} from '@throw/shared';
import { getAuthToken } from './auth';
import { compatibleFetch, ensureTaskSizeSupport } from './compatibility';
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

async function writeTask<T>(
  path: string,
  method: string,
  body: CreateTask | UpdateTask,
  sized: boolean,
) {
  if (sized) await ensureTaskSizeSupport();
  try {
    return await request<T>(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    // A server downgraded since bootstrap can reject the new field with a validation error.
    if (sized && error instanceof ApiError && error.status === 400)
      await ensureTaskSizeSupport(true);
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
    request<TxidResponse>('/statuses', { method: 'POST', body: JSON.stringify(body) }),
  updateStatus: (id: string, body: UpdateStatus) =>
    request<TxidResponse>(`/statuses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteStatus: (id: string) => request<TxidResponse>(`/statuses/${id}`, { method: 'DELETE' }),
  createTag: (body: CreateTag) =>
    request<TagWriteResponse>('/tags', { method: 'POST', body: JSON.stringify(body) }),
  updateTag: (id: string, body: UpdateTag) =>
    request<TagWriteResponse>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTag: (id: string) => request<TagWriteResponse>(`/tags/${id}`, { method: 'DELETE' }),
  createTask: (body: CreateTask) =>
    writeTask<TagWriteResponse>('/tasks', 'POST', body, body.size !== undefined),
  updateTask: (id: string, body: UpdateTask) =>
    writeTask<UpdateTaskResponse>(`/tasks/${id}`, 'PATCH', body, body.changes.size !== undefined),
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
