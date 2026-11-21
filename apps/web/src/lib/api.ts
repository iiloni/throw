import type {
  CreateComment,
  CreateMcpToken,
  CreateProject,
  CreateStatus,
  CreateTag,
  CreateTask,
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
  UpdateWorkspace,
  VersionInfo,
} from '@throw/shared';
import { createMcpTokenResponseSchema, mcpTokensResponseSchema } from '@throw/shared';
import { getAuthToken } from './auth';
import { compatibleFetch } from './compatibility';
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
    request<TagWriteResponse>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, body: UpdateTask) =>
    request<UpdateTaskResponse>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  purgeTask: (id: string) => request<TxidResponse>(`/tasks/${id}`, { method: 'DELETE' }),
  createComment: (body: CreateComment) =>
    request<TxidResponse>('/comments', { method: 'POST', body: JSON.stringify(body) }),
  updateComment: (id: string, body: UpdateComment) =>
    request<TxidResponse>(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteComment: (id: string) => request<TxidResponse>(`/comments/${id}`, { method: 'DELETE' }),
};
