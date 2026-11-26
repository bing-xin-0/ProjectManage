import type { FastifyRequest } from 'fastify';

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';
export type Visibility = 'public' | 'private';
export type ShareMessagePolicy = 'hidden' | 'full';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  email: string | null;
  github_token: string | null;
  github_username: string | null;
  created_at: string;
}

export interface ProjectRow {
  id: number;
  owner_id: number;
  name: string;
  source: string;
  repo_full_name: string | null;
  repo_remote: string | null;
  description: string | null;
  status: ProjectStatus;
  visibility: Visibility;
  share_token: string | null;
  share_message_policy: ShareMessagePolicy;
  starred: number;
  tags: string | null;
  idle_days_override: number | null;
  note: string | null;
  created_at: string;
  last_active_at: string | null;
}

export interface CommitRow {
  id: number;
  project_id: number;
  hash: string;
  message: string | null;
  author: string | null;
  author_email: string | null;
  committed_at: string;
  committed_offset: string | null;
  branch: string | null;
}

export interface BindingRow {
  id: number;
  project_id: number;
  machine_id: string;
  local_path: string;
  created_at: string;
  updated_at: string;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string | null;
}

export interface JwtPayload {
  sub: number;
  username: string;
  email: string | null;
  iat: number;
  exp: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthUser;
  }
}

/** 项目列表/详情的聚合统计字段 */
export interface ProjectAggregate {
  commit_count: number;
  week_commits: number;
  idle_days: number | null;
  is_stale: boolean;
}

/** 桌面端增量上传单条提交 */
export interface SyncCommitInput {
  hash: string;
  message?: string | null;
  author?: string | null;
  author_email?: string | null;
  committed_at: string; // UTC ISO
  committed_offset?: string | null;
  branch?: string | null;
}

/** 桌面端同步请求体 */
export interface SyncBody {
  machineId: string;
  localPath: string;
  commits: SyncCommitInput[];
}