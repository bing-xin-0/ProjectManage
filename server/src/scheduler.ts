import cron from 'node-cron';
import { db } from './db.js';
import {
  buildDailyReport,
  buildWeeklyReport,
  renderDailyText,
  renderWeeklyText,
  sendReportEmail,
  createMailer,
} from './reports.js';
import {
  fetchRepoCommits,
  getGithubToken,
  ingestCommits,
  latestCommitSha,
  refreshLastActive,
  parseRepoFullName,
} from './github.js';

/**
 * 定时任务：
 * 1. 日报/周报邮件（需 SMTP）
 * 2. GitHub 项目定时同步（每 N 分钟，SYNC_INTERVAL_MIN 覆盖，默认 30 分钟）
 * 定时任务独立于 SMTP——GitHub 同步不需要邮件配置。
 */
export function startScheduler() {
  const tz = Number(process.env.REPORT_TZ ?? 8);
  const dailyCron = process.env.REPORT_DAILY_CRON ?? '0 9 * * *';
  const weeklyCron = process.env.REPORT_WEEKLY_CRON ?? '30 9 * * 1';

  if (process.env.SMTP_HOST && createMailer()) {
    cron.schedule(dailyCron, async () => {
      try {
        await sendToAllDaily(tz);
      } catch (e) {
        console.error('[scheduler] daily report failed', e);
      }
    });

    cron.schedule(weeklyCron, async () => {
      try {
        await sendToAllWeekly(tz);
      } catch (e) {
        console.error('[scheduler] weekly report failed', e);
      }
    });
    console.log(`[scheduler] 定时邮件摘要已启动：日报 ${dailyCron}，周报 ${weeklyCron}`);
  } else {
    console.log('[scheduler] SMTP_HOST 未配置，定时邮件摘要关闭');
  }

  // GitHub 定时同步：默认每 30 分钟
  const syncIntervalMin = Number(process.env.GITHUB_SYNC_INTERVAL_MIN ?? 30) || 30;
  cron.schedule(`*/${Math.max(1, Math.min(59, syncIntervalMin))} * * * *`, async () => {
    try {
      const n = await syncAllGithubProjects();
      if (n > 0) console.log(`[scheduler] GitHub 同步完成：${n} 个项目`);
    } catch (e) {
      console.error('[scheduler] GitHub sync failed', e);
    }
  });
  console.log(`[scheduler] GitHub 定时同步已启动：每 ${syncIntervalMin} 分钟`);
}

/** 给所有有邮箱的用户发日报 */
export async function sendToAllDaily(tz = 0) {
  const users = db
    .prepare('SELECT id, username, email FROM users WHERE email IS NOT NULL')
    .all() as { id: number; username: string; email: string }[];
  for (const u of users) {
    const report = buildDailyReport(u.id, tz);
    await sendReportEmail(u.email, `【项目管家】日报 ${report.date}`, renderDailyText(report));
  }
  return users.length;
}

/** 给所有有邮箱的用户发周报 */
export async function sendToAllWeekly(tz = 0) {
  const users = db
    .prepare('SELECT id, username, email FROM users WHERE email IS NOT NULL')
    .all() as { id: number; username: string; email: string }[];
  for (const u of users) {
    const report = buildWeeklyReport(u.id, tz);
    await sendReportEmail(
      u.email,
      `【项目管家】周报 ${report.weekStart} ~ ${report.weekEnd}`,
      renderWeeklyText(report),
    );
  }
  return users.length;
}

/** 同步所有用户的 GitHub 项目（增量），返回成功同步的项目数 */
export async function syncAllGithubProjects(): Promise<number> {
  const projects = db
    .prepare("SELECT * FROM projects WHERE source = 'github' AND repo_full_name IS NOT NULL")
    .all() as {
    id: number;
    owner_id: number;
    repo_full_name: string;
  }[];
  let ok = 0;
  for (const p of projects) {
    const token = getGithubToken(p.owner_id);
    if (!token) continue;
    const parsed = parseRepoFullName(p.repo_full_name);
    if (!parsed) continue;
    try {
      const sinceSha = latestCommitSha(p.id);
      const commits = await fetchRepoCommits(token, parsed.owner, parsed.name, sinceSha ?? undefined);
      ingestCommits(p.id, commits);
      refreshLastActive(p.id);
      db.prepare('INSERT INTO sync_log (project_id, machine_id) VALUES (?, ?)').run(p.id, 'github');
      ok++;
    } catch (e) {
      // 单项目失败不阻断其他项目
      console.error(`[scheduler] github sync failed for project ${p.id} (${p.repo_full_name})`, e);
    }
  }
  return ok;
}