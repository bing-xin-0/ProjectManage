import type { FastifyInstance } from 'fastify';
import { sendToAllDaily, sendToAllWeekly } from '../scheduler.js';

/**
 * 管理接口：手动触发日报/周报邮件发送（调试用）。
 * 无鉴权——v1 极简实现，仅限内网部署。生产需加管理员鉴权。
 */
export function registerAdminRoutes(app: FastifyInstance) {
  app.post('/api/admin/trigger-report', async (request, reply) => {
    const body = request.body as { type?: string; tz?: number } | null;
    const type = body?.type ?? 'daily';
    const tz = Number(body?.tz ?? 0) || 0;
    try {
      if (type === 'weekly') {
        const n = await sendToAllWeekly(tz);
        return { ok: true, type, sent: n };
      }
      const n = await sendToAllDaily(tz);
      return { ok: true, type: 'daily', sent: n };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message ?? '发送失败' });
    }
  });
}