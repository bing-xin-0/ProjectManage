import Fastify from 'fastify';
import cors from '@fastify/cors';
import './db.js';
import { authHook } from './auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerCommitRoutes } from './routes/commits.js';
import { registerDashboardRoute } from './routes/dashboard.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerPublicRoutes } from './routes/public.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// 统一注册一次鉴权（decorateRequest + preHandler 校验 Bearer token）
authHook(app);

registerAuthRoutes(app);
registerProjectRoutes(app);
registerCommitRoutes(app);
registerDashboardRoute(app);
registerReportRoutes(app);
registerPublicRoutes(app);

const port = Number(process.env.PORT ?? 3000);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}