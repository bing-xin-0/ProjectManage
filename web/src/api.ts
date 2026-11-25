// Web API 封装：统一走 /api，自动带 JWT

const TOKEN_KEY = 'project-pulse-token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });
  if (res.status === 401) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? '未登录');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? `请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ---------- 认证 ----------

export interface AuthResult {
  user: { id: number; username: string; email: string | null };
  token: string;
}

export const authApi = {
  register: (data: { username: string; password: string; email?: string }) =>
    request<AuthResult>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: { username: string; password: string }) =>
    request<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request<{ user: AuthResult['user'] | null }>('/auth/me'),
};

// ---------- 项目 ----------

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface Project {
  id: number;
  owner_id: number;
  name: string;
  repo_remote: string | null;
  description: string | null;
  status: ProjectStatus;
  visibility: 'public' | 'private';
  share_token: string | null;
  share_message_policy: 'hidden' | 'full';
  starred: number;
  tags: string | null;
  idle_days_override: number | null;
  note: string | null;
  created_at: string;
  last_active_at: string | null;
  commit_count: number;
  week_commits: number;
  idle_days: number | null;
  is_stale: boolean;
}

export interface DashboardData {
  projects: Project[];
  stale: Project[];
  recentCommits: {
    hash: string;
    message: string | null;
    committed_at: string;
    branch: string | null;
    author: string | null;
    project_id: number;
    project_name: string;
  }[];
  totals: {
    projectCount: number;
    activeCount: number;
    weekCommits: number;
    staleCount: number;
  };
}

export const projectApi = {
  list: () => request<Project[]>('/projects'),
  create: (data: { name: string; repo_remote?: string; description?: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  get: (id: number) => request<Project>(`/projects/${id}`),
  update: (id: number, data: Partial<Project>) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: number) => request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
  dashboard: () => request<DashboardData>('/dashboard'),
  rotateShareToken: (id: number) =>
    request<{ shareToken: string }>(`/projects/${id}/rotate-share-token`, {
      method: 'POST',
      body: '{}',
    }),
};

// ---------- 提交 / 统计 ----------

export interface CommitItem {
  id: number;
  hash: string;
  message: string | null;
  author: string | null;
  committed_at: string;
  branch: string | null;
}

export interface TimelineData {
  branches: { branch: string; points: { time: string; hash: string }[] }[];
  total: number;
}

export interface ProjectStats {
  total: number;
  week: number;
  month: number;
  lastActiveAt: string | null;
  branches: (string | null)[];
  weekBuckets: { weekStart: string; count: number }[];
}

export const commitApi = {
  list: (projectId: number, page = 1, pageSize = 30) =>
    request<{ items: CommitItem[]; total: number; page: number; pageSize: number }>(
      `/projects/${projectId}/commits?page=${page}&pageSize=${pageSize}`,
    ),
  timeline: (projectId: number) => request<TimelineData>(`/projects/${projectId}/timeline`),
  stats: (projectId: number) => request<ProjectStats>(`/projects/${projectId}/stats`),
};

// ---------- 报告 ----------

export interface DailyReport {
  date: string;
  totalCommits: number;
  activeProjects: number;
  staleCount: number;
  byProject: { projectId: number; name: string; commits: number }[];
  stale: { projectId: number; name: string; idleDays: number }[];
}

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  totalCommits: number;
  activeProjects: number;
  staleCount: number;
  byProject: { projectId: number; name: string; commits: number; activeDays: number }[];
  dailyCommits: { day: string; commits: number }[];
  stale: { projectId: number; name: string; idleDays: number }[];
}

export const reportApi = {
  daily: (tz = 0) => request<DailyReport>(`/reports/daily?tz=${tz}`),
  weekly: (tz = 0) => request<WeeklyReport>(`/reports/weekly?tz=${tz}`),
};

// ---------- 公开分享 ----------

export interface PublicShare {
  name: string;
  description: string | null;
  status: string;
  lastActiveAt: string | null;
  totalCommits: number;
  shareMessagePolicy: 'hidden' | 'full';
  owner: string;
  commits: {
    hash: string;
    message: string | null;
    committed_at: string;
    branch: string | null;
    author: string | null;
  }[];
}

export const publicApi = {
  get: (shareToken: string) => request<PublicShare>(`/public/projects/${shareToken}`),
};