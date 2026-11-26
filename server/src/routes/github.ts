import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { db, nowIso } from '../db.js';
import type { SyncCommitInput } from '../types.js';
import {
  listUserRepos,
  fetchRepoCommits,
  getGithubToken,
  getRepoInfo,
  ingestCommits,
  latestCommitSha,
  refreshLastActive,
  parseRepoFullName,
  GithubAuthError,
  GithubRateLimitError,
  GithubConnectError,
} from '../github.js';

/**
 * GitHub 数据源路由：
 * - GET /api/github/repos — 列出用户可见仓库（需已配 PAT）
 * - POST /api/github/projects — 从 GitHub 仓库登记项目（{ repoFullName, description?, visibility?, note? }）
 * - POST /api/github/projects/:projectId/sync — 手动同步某个 GitHub 项目（增量）
 */
export function registerGithubRoutes(app: FastifyInstance) {
  app.get('/api/github/repos', async (request, reply) => {
    const ownerId = request.auth!.id;
    const token = getGithubToken(ownerId);
    if (!token) return reply.code(400).send({ error: '尚未配置 GitHub 令牌，请先到设置页填写' });
    try {
      const repos = await listUserRepos(token);
      return { repos };
    } catch (e) {
      if (e instanceof GithubAuthError || e instanceof GithubRateLimitError) {
        return reply.code(401).send({ error: e.message });
      }
      if (e instanceof GithubConnectError) {
        return reply.code(502).send({ error: e.message });
      }
      throw e;
    }
  });

  app.post('/api/github/projects', async (request, reply) => {
    const ownerId = request.auth!.id;
    const body = request.body as { repoFullName?: string; description?: string; visibility?: string; note?: string } | null;
    const repoFullName = (body?.repoFullName ?? '').trim();
    const parsed = parseRepoFullName(repoFullName);
    if (!parsed) return reply.code(400).send({ error: '仓库名格式应为 owner/repo，例如 bing-xin-0/ProjectManage' });

    const token = getGithubToken(ownerId);
    if (!token) return reply.code(400).send({ error: '尚未配置 GitHub 令牌' });

    // 幂等：已有同名项目则直接返回
    const existing = db
      .prepare('SELECT * FROM projects WHERE owner_id = ? AND name = ?')
      .get(ownerId, parsed.name) as any | undefined;
    if (existing) {
      // 若已存在但 source 不是 github，仍绑定 repo_full_name
      if (!existing.repo_full_name) {
        db.prepare(
          "UPDATE projects SET source = 'github', repo_full_name = ?, repo_remote = ? WHERE id = ?",
        ).run(repoFullName, `github.com/${repoFullName}.git`, existing.id);
      }
      return { ...existing, ...aggregateFor(existing) };
    }

    // 先取仓库元信息（默认分支 + 描述），再拉默认分支提交历史
    let repoInfo: { default_branch: string; description: string | null } | null = null;
    let commits: SyncCommitInput[] = [];
    try {
      repoInfo = await getRepoInfo(token, parsed.owner, parsed.name);
      commits = await fetchRepoCommits(token, parsed.owner, parsed.name, undefined, repoInfo.default_branch);
    } catch (e) {
      if (e instanceof GithubAuthError || e instanceof GithubRateLimitError) {
        return reply.code(401).send({ error: e.message });
      }
      if (e instanceof GithubConnectError) {
        return reply.code(502).send({ error: e.message });
      }
      return reply.code(400).send({ error: e instanceof Error ? e.message : '登记失败' });
    }

    const shareToken = randomUUID();
    const visibility = body?.visibility === 'public' ? 'public' : 'private';
    const description = body?.description ?? repoInfo?.description ?? null;
    const info = db
      .prepare(
        `INSERT INTO projects (owner_id, name, source, repo_full_name, repo_remote, repo_default_branch, description, status, visibility, share_token, note, created_at)
         VALUES (?, ?, 'github', ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      )
      .run(
        ownerId,
        parsed.name,
        repoFullName,
        `github.com/${repoFullName}.git`,
        repoInfo?.default_branch ?? 'main',
        description,
        visibility,
        shareToken,
        body?.note ?? null,
        nowIso(),
      );
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid) as any | undefined;
    if (row) {
      const added = ingestCommits(row.id, commits);
      refreshLastActive(row.id);
      db.prepare('INSERT INTO sync_log (project_id, machine_id) VALUES (?, ?)').run(row.id, 'github');
      return { ...row, ...aggregateFor(row), synced: added };
    }
    return reply.code(500).send({ error: '创建项目失败' });
  });

  app.post('/api/github/projects/:projectId/sync', async (request, reply) => {
    const ownerId = request.auth!.id;
    const params = request.params as { projectId: string };
    const row = db
      .prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?')
      .get(params.projectId, ownerId) as any | undefined;
    if (!row) return reply.code(404).send({ error: '项目不存在' });
    if (row.source !== 'github' || !row.repo_full_name) {
      return reply.code(400).send({ error: '该项目不是 GitHub 数据源项目' });
    }
    const token = getGithubToken(ownerId);
    if (!token) return reply.code(400).send({ error: '尚未配置 GitHub 令牌' });
    const parsed = parseRepoFullName(row.repo_full_name);
    if (!parsed) return reply.code(400).send({ error: '仓库名格式错误' });

    try {
      const sinceSha = latestCommitSha(row.id);
      const commits = await fetchRepoCommits(
        token,
        parsed.owner,
        parsed.name,
        sinceSha ?? undefined,
        row.repo_default_branch ?? undefined,
      );
      const added = ingestCommits(row.id, commits);
      refreshLastActive(row.id);
      db.prepare('INSERT INTO sync_log (project_id, machine_id) VALUES (?, ?)').run(row.id, 'github');
      return { ok: true, added, total: totalCommits(row.id), syncedAt: nowIso() };
    } catch (e) {
      if (e instanceof GithubAuthError || e instanceof GithubRateLimitError) {
        return reply.code(401).send({ error: e.message });
      }
      if (e instanceof GithubConnectError) {
        return reply.code(502).send({ error: e.message });
      }
      return reply.code(400).send({ error: e instanceof Error ? e.message : '同步失败' });
    }
  });
}

function totalCommits(projectId: number): number {
  return (
    db.prepare('SELECT COUNT(*) AS c FROM commits WHERE project_id = ?').get(projectId) as { c: number }
  ).c;
}

function aggregateFor(p: any): any {
  const total = totalCommits(p.id);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const week = (
    db.prepare('SELECT COUNT(*) AS c FROM commits WHERE project_id = ? AND committed_at >= ?').get(
      p.id,
      weekAgo,
    ) as { c: number }
  ).c;
  const idleDays = p.last_active_at
    ? Math.floor((Date.now() - new Date(p.last_active_at).getTime()) / 86400000)
    : null;
  const threshold = p.idle_days_override ?? 30;
  const isStale = p.status === 'active' && idleDays !== null && idleDays > threshold;
  return { commit_count: total, week_commits: week, idle_days: idleDays, is_stale: isStale };
}