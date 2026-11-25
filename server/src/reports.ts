import { db } from './db.js';
import type { ProjectRow } from './types.js';
import nodemailer, { type Transporter } from 'nodemailer';

export interface DailyReport {
  date: string; // YYYY-MM-DD（按配置时区）
  totalCommits: number;
  activeProjects: number;
  staleCount: number;
  byProject: { projectId: number; name: string; commits: number }[];
  stale: { projectId: number; name: string; idleDays: number }[];
}

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  totalCommits: number;
  activeProjects: number;
  staleCount: number;
  byProject: { projectId: number; name: string; commits: number; activeDays: number }[];
  dailyCommits: { day: string; commits: number }[];
  stale: { projectId: number; name: string; idleDays: number }[];
}

const WEEK_MS = 7 * 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** 凉了判定（按项目阈值，默认 30 天） */
export function isStale(p: ProjectRow, now = Date.now()): boolean {
  if (p.status !== 'active' || !p.last_active_at) return false;
  const idleDays = Math.floor((now - new Date(p.last_active_at).getTime()) / DAY_MS);
  const threshold = p.idle_days_override ?? 30;
  return idleDays > threshold;
}

export function idleDaysFor(p: ProjectRow, now = Date.now()): number | null {
  return p.last_active_at ? Math.floor((now - new Date(p.last_active_at).getTime()) / DAY_MS) : null;
}

/** 计算「本地时区的一天起点」的 UTC 时间戳（用于按用户时区分组） */
function dayStartUtcMs(now: Date, tzOffsetHours: number): number {
  const shifted = now.getTime() + tzOffsetHours * 3600 * 1000;
  const dayFloor = Math.floor(shifted / DAY_MS) * DAY_MS;
  return dayFloor - tzOffsetHours * 3600 * 1000;
}

export function buildDailyReport(ownerId: number, tzOffsetHours = 0): DailyReport {
  const now = new Date();
  const start = dayStartUtcMs(now, tzOffsetHours);
  const end = start + DAY_MS;
  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();
  const projects = db.prepare('SELECT * FROM projects WHERE owner_id = ?').all(ownerId) as ProjectRow[];

  const byProject: DailyReport['byProject'] = [];
  for (const p of projects) {
    const c = (
      db
        .prepare(
          'SELECT COUNT(*) AS c FROM commits WHERE project_id = ? AND committed_at >= ? AND committed_at < ?',
        )
        .get(p.id, startIso, endIso) as { c: number }
    ).c;
    if (c > 0) byProject.push({ projectId: p.id, name: p.name, commits: c });
  }

  const stale = projects
    .filter((p) => isStale(p))
    .map((p) => ({ projectId: p.id, name: p.name, idleDays: idleDaysFor(p)! }));

  return {
    date: new Date(start + tzOffsetHours * 3600 * 1000).toISOString().slice(0, 10),
    totalCommits: byProject.reduce((s, x) => s + x.commits, 0),
    activeProjects: projects.filter((p) => p.status === 'active').length,
    staleCount: stale.length,
    byProject,
    stale,
  };
}

export function buildWeeklyReport(ownerId: number, tzOffsetHours = 0): WeeklyReport {
  const now = new Date();
  const todayStart = dayStartUtcMs(now, tzOffsetHours);
  // 本周一：todayStart - ((dayIndex + 6) % 7) 天
  const dayIndex = (Math.floor((todayStart + tzOffsetHours * 3600 * 1000) / DAY_MS) + 3) % 7; // 0=周一
  const weekStart = todayStart - dayIndex * DAY_MS;
  const weekEnd = weekStart + WEEK_MS;
  const startIso = new Date(weekStart).toISOString();
  const endIso = new Date(weekEnd).toISOString();
  const projects = db.prepare('SELECT * FROM projects WHERE owner_id = ?').all(ownerId) as ProjectRow[];

  const dailyCommits: WeeklyReport['dailyCommits'] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + i * DAY_MS + tzOffsetHours * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    dailyCommits.push({ day: d, commits: 0 });
  }

  const byProject: WeeklyReport['byProject'] = [];
  for (const p of projects) {
    const rows = db
      .prepare(
        'SELECT committed_at FROM commits WHERE project_id = ? AND committed_at >= ? AND committed_at < ?',
      )
      .all(p.id, startIso, endIso) as { committed_at: string }[];
    if (rows.length === 0) continue;
    const daysSeen = new Set<string>();
    for (const r of rows) {
      const day = new Date(
        new Date(r.committed_at).getTime() + tzOffsetHours * 3600 * 1000,
      )
        .toISOString()
        .slice(0, 10);
      daysSeen.add(day);
      const idx = dailyCommits.findIndex((d) => d.day === day);
      if (idx >= 0) dailyCommits[idx].commits += 1;
    }
    byProject.push({ projectId: p.id, name: p.name, commits: rows.length, activeDays: daysSeen.size });
  }

  const stale = projects
    .filter((p) => isStale(p))
    .map((p) => ({ projectId: p.id, name: p.name, idleDays: idleDaysFor(p)! }));

  const fmt = (ms: number) =>
    new Date(ms + tzOffsetHours * 3600 * 1000).toISOString().slice(0, 10);
  return {
    weekStart: fmt(weekStart),
    weekEnd: fmt(weekEnd - 1),
    totalCommits: byProject.reduce((s, x) => s + x.commits, 0),
    activeProjects: projects.filter((p) => p.status === 'active').length,
    staleCount: stale.length,
    byProject,
    dailyCommits,
    stale,
  };
}

// ---------- SMTP 邮件摘要 ----------

export function createMailer(): Transporter | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
    },
  });
}

export function renderDailyText(r: DailyReport): string {
  const lines = [
    `【项目管家】日报 ${r.date}`,
    `提交总数：${r.totalCommits} · 活跃项目：${r.activeProjects} · 凉了提醒：${r.staleCount}`,
    '',
    '各项目提交：',
    ...(r.byProject.length
      ? r.byProject.map((x) => `- ${x.name}: ${x.commits} 次`)
      : ['（今日无提交）']),
    '',
    r.stale.length
      ? `凉了项目：${r.stale.map((s) => `${s.name}(${s.idleDays}天)`).join('、')}`
      : '无凉了项目。',
  ];
  return lines.join('\n');
}

export function renderWeeklyText(r: WeeklyReport): string {
  const lines = [
    `【项目管家】周报 ${r.weekStart} ~ ${r.weekEnd}`,
    `提交总数：${r.totalCommits} · 活跃项目：${r.activeProjects} · 凉了提醒：${r.staleCount}`,
    '',
    '各项目投入：',
    ...(r.byProject.length
      ? r.byProject.map((x) => `- ${x.name}: ${x.commits} 次 / ${x.activeDays} 天`)
      : ['（本周无提交）']),
    '',
    '每日提交：',
    ...r.dailyCommits.map((d) => `- ${d.day}: ${d.commits}`),
    '',
    r.stale.length
      ? `凉了项目：${r.stale.map((s) => `${s.name}(${s.idleDays}天)`).join('、')}`
      : '无凉了项目。',
  ];
  return lines.join('\n');
}

export async function sendReportEmail(
  to: string,
  subject: string,
  text: string,
): Promise<boolean> {
  const mailer = createMailer();
  if (!mailer) return false;
  await mailer.sendMail({
    from: process.env.SMTP_FROM ?? 'project-pulse@localhost',
    to,
    subject,
    text,
  });
  return true;
}