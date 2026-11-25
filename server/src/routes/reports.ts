import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { buildDailyReport, buildWeeklyReport } from '../reports.js';

export function registerReportRoutes(app: FastifyInstance) {
  
  app.get('/api/reports/daily', async (request) => {
    const ownerId = request.auth!.id;
    const tzOffsetHours = tzFromQuery(request.query);
    return buildDailyReport(ownerId, tzOffsetHours);
  });

  app.get('/api/reports/weekly', async (request) => {
    const ownerId = request.auth!.id;
    const tzOffsetHours = tzFromQuery(request.query);
    return buildWeeklyReport(ownerId, tzOffsetHours);
  });
}

function tzFromQuery(query: unknown): number {
  const q = query as { tz?: string };
  const n = Number(q.tz ?? 0);
  if (Number.isNaN(n) || n < -12 || n > 14) return 0;
  return n;
}