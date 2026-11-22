import Fastify from 'fastify';
import cors from '@fastify/cors';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// 健康检查
app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

const port = Number(process.env.PORT ?? 3000 obvious);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}