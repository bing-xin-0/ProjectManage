import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import type { ProjectRow, CommitRow, ShareMessagePolicy } from '../types.js';

/** 公开分享页（免登录，仅元数据，按 share_message_policy 脱敏） */
export function registerPublicRoutes(app: FastifyInstance) {
  app.get('/api/public/projects/:shareToken', async (request, reply) => {
    const params = request.params as { shareToken: string };
    const p = db
      .prepare("SELECT * FROM projects WHERE share_token = ? AND visibility = 'public'")
      .get(params.shareToken) as ProjectRow | undefined;
    if (!p) return reply.code(404).send({ error: '分享链接无效或项目未公开' });

    const owner = db.prepare('SELECT username FROM users WHERE id = ?').get(p.owner_id) as {
      username: string;
    };
    const commits = db
      .prepare(
        'SELECT hash, message, committed_at, committed_offset, branch, author FROM commits WHERE project_id = ? ORDER BY committed_at DESC LIMIT 50',
      )
      .all(p.id) as CommitRow[];

    const total = (
      db.prepare('SELECT COUNT(*) AS c FROM commits WHERE project_id = ?').get(p.id) as { c: number }
    ).c;

    const policy: ShareMessagePolicy = p.share_message_policy ?? 'hidden';

    const publicCommits = commits.map((c) => {
      const base = {
        hash: c.hash,
        committed_at: c.committed_at,
        branch: c.branch,
        author: c.author,
      };
      if (policy === 'full') return { ...base, message: c.message };
      // hidden：不暴露完整 message，只给 hash 前 7 位
      return { ...base, hash: c.hash.slice(0, 7), message: undefined };
    });

    return {
      name: p.name,
      description: p.description,
      status: p.status,
      lastActiveAt: p.last_active_at,
      totalCommits: total,
      shareMessagePolicy: policy,
      owner: owner.username,
      commits: publicCommits,
    };
  });
}