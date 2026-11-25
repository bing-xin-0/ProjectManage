import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { db, nowIso } from '../db.js';
import type {
  ProjectRow,
  ProjectStatus,
  Visibility,
  ShareMessagePolicy,
  BindingRow,
  ProjectAggregate,
  SyncBody,
  SyncCommitInput,
} from '../types.js';

const VALID_STATUS: ProjectStatus[] = ['active', 'paused', 'completed', 'archived'];
const VALID_VISIBILITY: Visibility[] = ['public', 'private'];
const VALID_SHARE_POLICY: ShareMessagePolicy[] = ['hidden', 'full'];

function normalizeStatus(s: string): ProjectStatus {
  return VALID_STATUS.includes(s as ProjectStatus) ? (s as ProjectStatus) : 'active';
}

export function registerProjectRoutes(app: FastifyInstance) {
  
  // ---------- 项目 CRUD ----------

  app.get('/api/projects', async (request) => {
    const ownerId = request.auth!.id;
    const rows = db
      .prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY starred DESC, last_active_at DESC')
      .all(ownerId) as ProjectRow[];
    return rows.map((p) => ({ ...p, ...aggregateFor(p) }));
  });

  app.post('/api/projects', async (request, reply) => {
    const ownerId = request.auth!.id;
    const body = request.body as Partial<ProjectRow> & { name: string };
    const name = (body.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: '项目名不能为空' });
    const existing = db
      .prepare('SELECT id FROM projects WHERE owner_id = ? AND name = ?')
      .get(ownerId, name) as { id: number } | undefined;
    if (existing) {
      // 桌面端重发同名项目 → 返回既有项目（幂等）
      return db.prepare('SELECT * FROM projects WHERE id = ?').get(existing.id);
    }
    const shareToken = randomUUID();
    const info = db
      .prepare(
        `INSERT INTO projects (owner_id, name, repo_remote, description, status, visibility, share_token,
           share_message_policy, starred, tags, idle_days_override, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ownerId,
        name,
        body.repo_remote ?? null,
        body.description ?? null,
        normalizeStatus(body.status ?? 'active'),
        VALID_VISIBILITY.includes(body.visibility as Visibility) ? body.visibility : 'private',
        shareToken,
        VALID_SHARE_POLICY.includes(body.share_message_policy as ShareMessagePolicy)
          ? body.share_message_policy
          : 'hidden',
        body.starred ? 1 : 0,
        body.tags ?? null,
        body.idle_days_override ?? null,
        body.note ?? null,
      );
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid) as ProjectRow;
    return { ...row, ...aggregateFor(row) };
  });

  app.get('/api/projects/:id', async (request, reply) => {
    const p = findOwned(request);
    if (!p) return reply.code(404).send({ error: '项目不存在' });
    return { ...p, ...aggregateFor(p) };
  });

  app.patch('/api/projects/:id', async (request, reply) => {
    const p = findOwned(request);
    if (!p) return reply.code(404).send({ error: '项目不存在' });
    const body = request.body as Partial<ProjectRow>;
    const fields: string[] = [];
    const values: unknown[] = [];

    const assign = (col: string, val: unknown, validate?: (v: any) => boolean) => {
      if (validate && !validate(val)) return;
      fields.push(`${col} = ?`);
      values.push(val);
    };

    if (body.name !== undefined) assign('name', String(body.name).trim());
    if (body.repo_remote !== undefined) assign('repo_remote', body.repo_remote);
    if (body.description !== undefined) assign('description', body.description);
    if (body.status !== undefined) assign('status', body.status, (v) => VALID_STATUS.includes(v));
    if (body.visibility !== undefined)
      assign('visibility', body.visibility, (v) => VALID_VISIBILITY.includes(v));
    if (body.share_message_policy !== undefined)
      assign('share_message_policy', body.share_message_policy, (v) =>
        VALID_SHARE_POLICY.includes(v),
      );
    if (body.starred !== undefined) assign('starred', body.starred ? 1 : 0);
    if (body.tags !== undefined) assign('tags', body.tags);
    if (body.idle_days_override !== undefined) assign('idle_days_override', body.idle_days_override);
    if (body.note !== undefined) assign('note', body.note);

    if (fields.length) {
      values.push(p.id);
      db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id) as ProjectRow;
    return { ...row, ...aggregateFor(row) };
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    const p = findOwned(request);
    if (!p) return reply.code(404).send({ error: '项目不存在' });
    db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
    return { ok: true };
  });

  // ---------- 桌面端增量同步 ----------

  app.post('/api/projects/:id/sync', async (request, reply) => {
    const p = findOwned(request);
    if (!p) return reply.code(404).send({ error: '项目不存在' });
    const body = request.body as SyncBody;
    if (!body || !Array.isArray(body.commits)) {
      return reply.code(400).send({ error: '缺少 commits 数组' });
    }
    const machineId = (body.machineId ?? '').trim();
    const localPath = (body.localPath ?? '').trim();

    // 上报/更新本机绑定
    if (machineId && localPath) {
      db.prepare(
        `INSERT INTO project_local_bindings (project_id, machine_id, local_path, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, machine_id)
         DO UPDATE SET local_path = excluded.local_path, updated_at = excluded.updated_at`,
      ).run(p.id, machineId, localPath, nowIso());
    }

    // 增量插入提交（按 hash 去重）
    const insert = db.prepare(
      `INSERT OR IGNORE INTO commits (project_id, hash, message, author, author_email, committed_at, committed_offset, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction((commits: SyncCommitInput[]) => {
      let added = 0;
      for (const c of commits) {
        const info = insert.run(
          p.id,
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
    const added = tx(body.commits);

    // 更新 last_active_at 与状态自动回切
    const latest = db
      .prepare('SELECT committed_at FROM commits WHERE project_id = ? ORDER BY committed_at DESC LIMIT 1')
      .get(p.id) as { committed_at: string } | undefined;
    if (latest) {
      db.prepare('UPDATE projects SET last_active_at = ? WHERE id = ?').run(latest.committed_at, p.id);
      if (p.status === 'completed' || p.status === 'archived') {
        db.prepare("UPDATE projects SET status = 'active' WHERE id = ?").run(p.id);
      }
    }
    db.prepare('INSERT INTO sync_log (project_id, machine_id) VALUES (?, ?)').run(p.id, machineId);

    return { added, total: totalCommits(p.id), machineId };
  });

  // ---------- 本地路径绑定 ----------

  app.get('/api/projects/:id/bindings', async (request, reply) => {
    const p = findOwned(request);
    if (!p) return reply.code(404).send({ error: '项目不存在' });
    return db
      .prepare('SELECT * FROM project_local_bindings WHERE project_id = ?')
      .all(p.id) as BindingRow[];
  });

  app.put('/api/projects/:id/bindings', async (request, reply) => {
    const p = findOwned(request);
    if (!p) return reply.code(404).send({ error: '项目不存在' });
    const body = request.body as { machineId?: string; localPath?: string };
    const machineId = (body.machineId ?? '').trim();
    const localPath = (body.localPath ?? '').trim();
    if (!machineId || !localPath) return reply.code(400).send({ error: 'machineId/localPath 必填' });
    db.prepare(
      `INSERT INTO project_local_bindings (project_id, machine_id, local_path, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, machine_id)
       DO UPDATE SET local_path = excluded.local_path, updated_at = excluded.updated_at`,
    ).run(p.id, machineId, localPath, nowIso());
    return db
      .prepare('SELECT * FROM project_local_bindings WHERE project_id = ? AND machine_id = ?')
      .get(p.id, machineId);
  });

  app.delete('/api/projects/:id/bindings/:machineId', async (request, reply) => {
    const p = findOwned(request);
    if (!p) return reply.code(404).send({ error: '项目不存在' });
    const params = request.params as { machineId: string };
    db.prepare('DELETE FROM project_local_bindings WHERE project_id = ? AND machine_id = ?').run(
      p.id,
      params.machineId,
    );
    return { ok: true };
  });

  // ---------- 分享令牌轮换 ----------

  app.post(
    '/api/projects/:id/rotate-share-token',
    { schema: { body: { type: 'object', additionalProperties: true } } },
    async (request, reply) => {
      const p = findOwned(request);
      if (!p) return reply.code(404).send({ error: '项目不存在' });
      const token = randomUUID();
      db.prepare('UPDATE projects SET share_token = ? WHERE id = ?').run(token, p.id);
      return { shareToken: token };
    },
  );

  // ---------- 辅助 ----------

  function findOwned(request: any): ProjectRow | undefined {
    const params = request.params as { id: string };
    const row = db.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').get(
      params.id,
      request.auth!.id,
    ) as ProjectRow | undefined;
    return row;
  }

  function totalCommits(projectId: number): number {
    return (
      db
        .prepare('SELECT COUNT(*) AS c FROM commits WHERE project_id = ?')
        .get(projectId) as { c: number }
    ).c;
  }

  function aggregateFor(p: ProjectRow): ProjectAggregate {
    const total = totalCommits(p.id);
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const week = (
      db
        .prepare('SELECT COUNT(*) AS c FROM commits WHERE project_id = ? AND committed_at >= ?')
        .get(p.id, weekAgo) as { c: number }
    ).c   ;
    const idleDays = p.last_active_at ? Math.floor((Date.now() - new Date(p.last_active_at).getTime()) / 86400000) : null;
    const idleDaysThreshold = p.idle_days_override ?? 30;
    const isStale = p.status === 'active' && idleDays !== null && idleDays > idleDaysThreshold;
    return { commit_count: total, week_commits: week, idle_days: idleDays, is_stale: isStale };
  }
}