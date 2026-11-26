import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { verifyTokenAndUser, GithubAuthError } from '../github.js';

/**
 * GitHub 设置：
 * - GET /api/settings/github — 返回是否已配置 + 绑定的 GitHub 用户名（不回传 token）
 * - PUT /api/settings/github — 保存 PAT（校验后写入），可传 { token, githubUsername? }
 */
export function registerSettingsRoutes(app: FastifyInstance) {
  app.get('/api/settings/github', async (request) => {
    const ownerId = request.auth!.id;
    const row = db
      .prepare('SELECT github_token, github_username FROM users WHERE id = ?')
      .get(ownerId) as { github_token: string | null; github_username: string | null };
    return {
      configured: Boolean(row.github_token),
      githubUsername: row.github_username,
    };
  });

  app.put('/api/settings/github', async (request, reply) => {
    const ownerId = request.auth!.id;
    const body = request.body as { token?: string } | null;
    const token = (body?.token ?? '').trim();
    if (!token) {
      // 传空 token = 清除配置
      db.prepare('UPDATE users SET github_token = NULL, github_username = NULL WHERE id = ?').run(ownerId);
      return { ok: true, configured: false };
    }
    try {
      const username = await verifyTokenAndUser(token);
      db.prepare('UPDATE users SET github_token = ?, github_username = ? WHERE id = ?').run(
        token,
        username,
        ownerId,
      );
      return { ok: true, configured: true, githubUsername: username };
    } catch (e) {
      if (e instanceof GithubAuthError) {
        return reply.code(401).send({ error: e.message });
      }
      throw e;
    }
  });
}