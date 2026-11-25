import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import type { CommitRow, ProjectRow } from '../types.js';

export function registerCommitRoutes(app: FastifyInstance) {
  
  function findOwned(request: any): ProjectRow | undefined {
    const params = request.params as { id: string };
    return db
      .prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?')
      .get(params.id, request.auth!.id) as ProjectRow | undefined;
  }

  // ---------- 提交列表（分页 + 过滤） ----------

  app.get('/api/projects/:id/commits', async (request, reply) => {
    const p = findOwned(request);
    if (!p) return reply.code(404).send({ error: '项目不存在' });
    const q = request.query as { page?: string; pageSize?: string; branch?: string };
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '30', 10) || 30));
    const offset = (page - 1) * pageSize;
    const LIMIT = pageSize;

    let where = 'project_id = ?';
    const args: unknown[] = [p.id];
    if (q.branch) {
      where += ' AND branch = ?';
      args.push(q.branch);
    }
    const rows = db
      .prepare(`SELECT * FROM commits WHERE ${where} ORDER BY committed_at DESC LIMIT ? OFFSET ?`)
      .all(...args, LIMIT, offset) as CommitRow[];
    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM commits WHERE ${where}`).get(...args) as { c: number }
    ).c;
    return { items: rows, total, page, pageSize };
  });

  // ---------- 提交时间线（散点聚合） ----------

  app.get('/api/projects/:id/timeline', async (request, reply) => {
    const p = findOwned(request);
    if (!p) return reply.code(404).send({ error: '项目不存在' });
    const q = request.query as { since?: string };
    let rows: CommitRow[];
    if (q.since) {
      rows = db
        .prepare('SELECT * FROM commits WHERE project_id = ? AND committed_at >= ? ORDER BY committed_at')
        .all(p.id, q.since) as CommitRow[];
    } else {
      rows = db
        .prepare('SELECT * FROM commits WHERE project_id = ? ORDER BY committed_at')
        .all(p.id) as CommitRow[];
    }
    // 按分支分组：{ branch: [{time, hash}] }
    const byBranch = new Map<string, { time: string; hash: string }[]>();
    for (const c of rows) {
      const b = c.branch ?? 'unknown';
      if (!byBranch.has(b)) byBranch.set(b, []);
      byBranch.get(b)!.push({ time: c.committed_at, hash: c.hash });
    }
    const branches = [...byBranch.entries()].map(([branch, points]) => ({ branch, points }));
    return { branches, total: rows.length };
  });

  // ---------- 统计 ----------

  app.get('/api/projects/:id/stats', async (request, reply) => {
    const p = findOwned(request);
    if (!p) return reply.code(404).send({ error: '项目不存在' });
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // 周一
    startOfWeek.setHours(0, 0, 0, 0);
    const weekAgoIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const week = (
      db
        .prepare('SELECT COUNT(*) AS c FROM commits WHERE project_id = ? AND committed_at >= ?')
        .get(p.id, weekAgoIso) as { c: number }
    ).c;
    const monthAgoIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const month = (
      db
        .prepare('SELECT COUNT(*) AS c FROM commits WHERE project_id = ? AND committed_at >= ?')
        .get(p.id, monthAgoIso) as { c: number }
    ).c;

    // 按周提交数（最近 12 周）
    const weekBuckets: { weekStart: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(Date.now() - i * 7 * 24 * 3600 * 1000);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
      const count = (
        db
          .prepare(
            'SELECT COUNT(*) AS c FROM commits WHERE project_id = ? AND committed_at >= ? AND committed_at < ?',
          )
          .get(p.id, start.toISOString(), end.toISOString()) as { c: number }
      ).c;
      weekBuckets.push({ weekStart: start.toISOString().slice(0, 10), count });
    }

    const branches = (
      db
        .prepare('SELECT DISTINCT branch FROM commits WHERE project_id = ?')
        .all(p.id) as { branch: string | null }[]
    )
      .map((r) => r.branch)
      .filter(Boolean);

    return {
      total: (
        db.prepare('SELECT COUNT(*) AS c FROM commits WHERE project_id = ?').get(p.id) as { c: number }
      ).c,
      week,
      month,
      lastActiveAt: p.last_active_at,
      branches,
      weekBuckets,
    };
  });
}