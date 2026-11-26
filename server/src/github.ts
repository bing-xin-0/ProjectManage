// GitHub 数据源集成：
// 用用户配置的 GitHub PAT 调用 GitHub REST API 拉取仓库列表与提交元数据。
// 只传 commit 元数据（hash/message/作者/时间/分支），不上传代码。
// v1 仅支持 GitHub（非 GitHub 托管 v1 不支持）。

import { db } from './db.js';
import type { SyncCommitInput } from './types.js';

const GITHUB_API = 'https://api.github.com';
const PER_PAGE = 100;

/** GitHub API 未授权/令牌失效 */
export class GithubAuthError extends Error {
  constructor(message = 'GitHub 令牌无效或已过期') {
    super(message);
    this.name = 'GithubAuthError';
  }
}

/** GitHub API 限流 */
export class GithubRateLimitError extends Error {
  constructor(message = 'GitHub API 限流，请稍后再试') {
    super(message);
    this.name = 'GithubRateLimitError';
  }
}

export interface GithubRepo {
  full_name: string;
  name: string;
  owner: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
}

export interface GithubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string; // ISO 8601 UTC
    };
  };
}

/** 解析 repo_full_name（"owner/name"）→ { owner, name } */
export function parseRepoFullName(full: string): { owner: string; name: string } | null {
  const m = /^([^/]+)\/([^/]+)$/.exec(full.trim());
  return m ? { owner: m[1], name: m[2] } : null;
}

/** GitHub API 基础请求：带 PAT，处理 401/403/404 */
async function ghFetch(token: string, path: string): Promise<any> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'project-pulse',
    },
  });
  if (res.status === 401) throw new GithubAuthError();
  if (res.status === 403) {
    // 限流：X-RateLimit-Remaining 为 0
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') throw new GithubRateLimitError();
    throw new GithubAuthError();
  }
  if (res.status === 404) throw new Error('GitHub 仓库或资源不存在');
  if (!res.ok) {
    throw new Error(`GitHub API 请求失败 (${res.status})`);
  }
  return res.json();
}

/** 校验 PAT 并返回 GitHub 用户名（GET /user） */
export async function verifyTokenAndUser(token: string): Promise<string> {
  const user = await ghFetch(token, '/user');
  const username = (user?.login ?? '').trim();
  if (!username) throw new GithubAuthError('无法从令牌解析 GitHub 用户名');
  return username;
}

/**
 * 列出用户可见的仓库（分页拉取，含私有仓库）。
 * 返回 { repos, totalCount }，默认最多拉 500 个。
 */
export async function listUserRepos(token: string, maxPages = 5): Promise<GithubRepo[]> {
  const repos: GithubRepo[] = [];
  let page = 1;
  while (page <= maxPages) {
    const data = await ghFetch(
      token,
      `/user/repos?per_page=${PER_PAGE}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    );
    if (!Array.isArray(data) || data.length === 0) break;
    for (const r of data) {
      repos.push({
        full_name: r.full_name,
        name: r.name,
        owner: r.owner?.login ?? '',
        private: !!r.private,
        html_url: r.html_url,
        description: r.description ?? null,
        default_branch: r.default_branch ?? 'main',
      });
    }
    if (data.length < PER_PAGE) break;
    page++;
  }
  return repos;
}

/**
 * 拉取某个仓库默认分支的提交历史（可增量：sinceSha 存在时只取该 sha 之后的提交）。
 *
 * 注意 GitHub commits API 的 `sha` 参数语义是「从该 SHA 开始往回列历史」（含该 SHA 及其祖先），
 * 若直接把上次同步的 tip 传进去，只会返回已经入库的旧提交、永远拿不到新提交。
 * 正确做法：从默认分支头部列起（sha=defaultBranch），逐页遇到 sinceSha 即停（其后的都已在库）。
 * 若 sinceSha 不在默认分支历史里（如 force-push/分支切换），最多拉 10 页（1000 条），去重兜底。
 *
 * 返回按时间倒序的提交列表（已映射为 SyncCommitInput，committed_at 为 UTC ISO）。
 */
export async function fetchRepoCommits(
  token: string,
  owner: string,
  name: string,
  sinceSha?: string,
  defaultBranch?: string,
): Promise<SyncCommitInput[]> {
  const commits: SyncCommitInput[] = [];
  const branch = defaultBranch ?? 'main';
  let page = 1;
  while (page <= 10) {
    const path = `/repos/${owner}/${name}/commits?per_page=${PER_PAGE}&page=${page}&sha=${branch}`;
    const data = await ghFetch(token, path);
    if (!Array.isArray(data) || data.length === 0) break;
    let reachedSince = false;
    for (const c of data) {
      if (sinceSha && c.sha === sinceSha) {
        reachedSince = true;
        break;
      }
      const author = c?.commit?.author;
      const date = author?.date;
      const iso = date ? new Date(date).toISOString() : new Date().toISOString();
      commits.push({
        hash: c.sha,
        message: c.commit?.message ?? null,
        author: author?.name ?? null,
        author_email: author?.email ?? null,
        committed_at: iso,
        committed_offset: null,
        branch, // 统一归并到默认分支，便于时间线分组展示
      });
    }
    if (reachedSince) break;
    if (data.length < PER_PAGE) break;
    page++;
  }
  return commits;
}

/** 取仓库信息（默认分支 + 描述），用于登记/同步时归并分支与补全描述 */
export async function getRepoInfo(
  token: string,
  owner: string,
  name: string,
): Promise<{ default_branch: string; description: string | null }> {
  const r = await ghFetch(token, `/repos/${owner}/${name}`);
  return {
    default_branch: r.default_branch ?? 'main',
    description: r.description ?? null,
  };
}

/** 已入库的 GitHub 项目（source='github'） */
export function githubProjectsOf(ownerId: number): any[] {
  return db
    .prepare("SELECT * FROM projects WHERE owner_id = ? AND source = 'github'")
    .all(ownerId);
}

/** 获取用户已配置的 PAT（无则返回 null） */
export function getGithubToken(ownerId: number): string | null {
  const row = db.prepare('SELECT github_token FROM users WHERE id = ?').get(ownerId) as
    | { github_token: string | null }
    | undefined;
  return row?.github_token ?? null;
}

/**
 * 把 GitHub 提交批量入库（按 hash 去重）。
 * 返回新增数量。
 */
export function ingestCommits(projectId: number, commits: SyncCommitInput[]): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO commits (project_id, hash, message, author, author_email, committed_at, committed_offset, branch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((list: SyncCommitInput[]) => {
    let added = 0;
    for (const c of list) {
      const info = insert.run(
        projectId,
        c.hash,
        c.message ?? null,
        c.author ?? null,
        c.author_email ?? null,
        c.committed_at,
        c.committed_offset ?? null,
        c.branch ?? null,
      );
      if (info.changes > 0) added++;
    }
    return added;
  });
  return tx(commits);
}

/** 取项目最近一条提交的 sha（用于增量同步） */
export function latestCommitSha(projectId: number): string | null {
  const row = db
    .prepare('SELECT hash FROM commits WHERE project_id = ? ORDER BY committed_at DESC LIMIT 1')
    .get(projectId) as { hash: string } | undefined;
  return row?.hash ?? null;
}

/** 更新项目的 last_active_at（取库内最新提交时间） */
export function refreshLastActive(projectId: number): void {
  const latest = db
    .prepare('SELECT committed_at FROM commits WHERE project_id = ? ORDER BY committed_at DESC LIMIT 1')
    .get(projectId) as { committed_at: string } | undefined;
  if (latest) {
    db.prepare('UPDATE projects SET last_active_at = ? WHERE id = ?').run(latest.committed_at, projectId);
  }
}