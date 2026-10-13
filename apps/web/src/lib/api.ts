import type {
  CreateProject,
  CreateWorkspace,
  TxidResponse,
  UpdateProject,
  UpdateWorkspace,
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

export const api = {
  createWorkspace: (body: CreateWorkspace) =>
    request<TxidResponse>('/workspaces', { method: 'POST', body: JSON.stringify(body) }),
  updateWorkspace: (id: string, body: UpdateWorkspace) =>
    request<TxidResponse>(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteWorkspace: (id: string) => request<TxidResponse>(`/workspaces/${id}`, { method: 'DELETE' }),
  createProject: (body: CreateProject) =>
    request<TxidResponse>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  updateProject: (id: string, body: UpdateProject) =>
    request<TxidResponse>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProject: (id: string) => request<TxidResponse>(`/projects/${id}`, { method: 'DELETE' }),
};
