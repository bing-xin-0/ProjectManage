import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { registerUser, loginUser, verifyToken, type RegisterBody, type LoginBody } from '../auth.js';

export function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (request, reply) => {
    try {
      const body = request.body as RegisterBody;
      const result = await registerUser(body);
      return { ...result, user: { ...result.user } };
    } catch (e: any) {
      return reply.code(e.statusCode ?? 500).send({ error: e.message ?? '注册失败' });
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    try {
      const body = request.body as LoginBody;
      const result = loginUser(body);
      return result;
    } catch (e: any) {
      return reply.code(e.statusCode ?? 500).send({ error: e.message ?? '登录失败' });
    }
  });

  app.get('/api/auth/me', async (request) => {
    const authz = request.headers.authorization ?? '';
    if (!authz.startsWith('Bearer ')) {
      return { user: null };
    }
    try {
      const user = verifyToken(authz.slice(7));
      return { user };
    } catch {
      return { user: null };
    }
  });

  // 健康检查
  app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString() }));
}