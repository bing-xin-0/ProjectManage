import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import type { ProjectRow, ProjectAggregate } from '../types.js';

export function registerDashboardRoute(app: FastifyInstance) {
  
  app.get('/api/dashboard', async (request) => {
    const ownerId = request.auth!.id;
    const rows = db
      .prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY starred DESC, last_active_at DESC')
      .all(ownerId) as ProjectRow[];

    const projects = rows.map((p) => {
      const agg = aggregateFor(p);
      return { ...p, ...agg };
    });

    const stale = projects.filter((p) => p.is_stale);
    const recentCommits = db
      .prepare(
        `SELECT c.hash, c.message, c.committed_at, c.branch, c.author, p.id AS project_id, p.name AS project_name
         FROM commits c JOIN projects p ON p.id = c.project_id
         WHERE p.owner_id = ?
         ORDER BY c.committed_at DESC LIMIT 20`,
      )
      .all(ownerId);

    return {
      projects,
      stale,
      recentCommits,
      totals: {
        projectCount: projects.length,
        activeCount: projects.filter((p) => p.status === 'active').length,
        weekCommits: projects.reduce((s, p) => s + (p as any).week_commits, 0),
        staleCount: stale.length,
      },
    };
  });
}

function aggregateFor(p: ProjectRow): ProjectAggregate {
  const total = (
    db.prepare('SELECT COUNT(*) AS c FROM commits WHERE project_id = ?').get(p.id) as { c: number }
  ).c;
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const week = (
    db
      .prepare('SELECT COUNT(*) AS c FROM commits WHERE project_id = ? AND committed_at >= ?')
      .get(p.id, weekAgo) as { c: number }
  ).c;
  const idleDays = p.last_active_at
    ? Math.floor((Date.now() - new Date(p.last_active_at).getTime()) / 86400000)
    : null;
  const threshold = p.idle_days_override ?? 30;
  const isStale = p.status === 'active' && idleDays !== null && idleDays > threshold;
  return { commit_count: total, week_commits: week, idle_days: idleDays, is_stale: isStale };
}