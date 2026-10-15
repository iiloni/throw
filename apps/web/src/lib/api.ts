import type {
  CreateProject,
  CreateStatus,
  CreateTask,
  CreateWorkspace,
  ReleasesResponse,
  TxidResponse,
  UpdateProject,
  UpdateStatus,
  UpdateTask,
  UpdateTaskResponse,
  UpdateWorkspace,
  VersionInfo,
} from '@throw/shared';
import { getAuthToken } from './auth';
import { compatibleFetch } from './compatibility';
import { getServerUrl } from './serverUrl';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const token = getAuthToken();
  const response = await compatibleFetch(`${getServerUrl()}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
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
  createTask: (body: CreateTask) =>
    request<TxidResponse>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, body: UpdateTask) =>
    request<UpdateTaskResponse>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  purgeTask: (id: string) => request<TxidResponse>(`/tasks/${id}`, { method: 'DELETE' }),
};
