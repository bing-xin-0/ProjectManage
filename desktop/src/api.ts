// 桌面端 API 封装：服务器地址 + token 本地持久化（localStorage）

const CFG_KEY = 'pp-server-config';

export interface ServerConfig {
  baseUrl: string;
  token: string;
  username: string;
  machineId: string;
}

export function getConfig(): ServerConfig | null {
  const raw = localStorage.getItem(CFG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServerConfig;
  } catch {
    return null;
  }
}

export function setConfig(cfg: ServerConfig | null) {
  if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(CFG_KEY);
}

export function getMachineId(): string {
  const cfg = getConfig();
  if (cfg?.machineId) return cfg.machineId;
  // 生成并持久化 machineId（uuid 简化）
  const id =
    'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  return id;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}, cfg?: ServerConfig): Promise<T> {
  const base = (cfg?.baseUrl ?? 'http://localhost:3000').replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (cfg?.token) headers.Authorization = `Bearer ${cfg.token}`;

  let res: Response;
  try {
    res = await fetch(`${base}/api${path}`, { ...options, headers });
  } catch (e) {
    throw new ApiError(0, '无法连接服务器，请检查地址与服务是否启动');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? `请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface AuthResult {
  user: { id: number; username: string; email: string | null };
  token: string;
}

export const authApi = {
  login: (cfg: ServerConfig, data: { username: string; password: string }) =>
    request<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify(data) }, cfg),
};

export interface Project {
  id: number;
  name: string;
  repo_remote: string | null;
  status: string;
  note: string | null;
  last_active_at: string | null;
  commit_count: number;
  week_commits: number;
}

export const projectApi = {
  list: (cfg: ServerConfig) => request<Project[]>('/projects', {}, cfg),
  create: (cfg: ServerConfig, data: { name: string; repo_remote?: string; description?: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }, cfg),
  update: (cfg: ServerConfig, id: number, patch: Partial<Project>) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }, cfg),
  sync: (
    cfg: ServerConfig,
    projectId: number,
    body: { machineId: string; localPath: string; commits: unknown[] },
  ) =>
    request<{ added: number; total: number }>(
      `/projects/${projectId}/sync`,
      { method: 'POST', body: JSON.stringify(body) },
      cfg,
    ),
};

/** Tauri 命令返回的 git 采集结果 */
export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  author_email: string;
  committed_at: string;
  committed_offset: string;
  branch: string;
}

export interface GitCollectResult {
  is_git: boolean;
  repo_remote: string | null;
  branch: string | null;
  commits: GitCommit[];
  error: string | null;
}

/** 本地注册的项目（存 localStorage：目录 + 服务端 projectId） */
export interface LocalProject {
  localPath: string;
  name: string;
  serverProjectId: number | null;
  lastSyncHash: string | null;
}

const LOCAL_KEY = 'pp-local-projects';

export function getLocalProjects(): LocalProject[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as LocalProject[];
  } catch {
    return [];
  }
}

export function setLocalProjects(list: LocalProject[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
}