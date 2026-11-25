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

/**
 * 定时发送日报/周报邮件：
 * - 每日 09:00 发日报（REPORT_DAILY_CRON 覆盖，默认 '0 9 * * *'）
 * - 每周一 09:30 发周报（REPORT_WEEKLY_CRON 覆盖，默认 '30 9 * * 1'）
 * 时区由 REPORT_TZ 指定（小时偏移，默认 8）。
 */
export function startScheduler() {
  if (!process.env.SMTP_HOST) {
    console.log('[scheduler] SMTP_HOST 未配置，定时邮件摘要关闭');
    return;
  }
  if (!createMailer()) {
    console.log('[scheduler] 无法创建 mailer，定时邮件摘要关闭');
    return;
  }
  const tz = Number(process.env.REPORT_TZ ?? 8);
  const dailyCron = process.env.REPORT_DAILY_CRON ?? '0 9 * * *';
  const weeklyCron = process.env.REPORT_WEEKLY_CRON ?? '30 9 * * 1';

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