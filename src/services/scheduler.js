/**
 * 简易定时调度器(基于 setInterval,无外部依赖)
 *
 * 当前任务:
 * - 每 10 分钟:回查 auto_passed 且 recheck_at 到期的 completion → 发放积分
 * - 每 10 分钟:超时未提交的 claimed completion → 释放名额
 * - 每 30 分钟:过期任务 → 标记 expired + 退还剩余积分
 */
const completionsService = require('./completions');
const pool = require('../config/db');
const pointsService = require('./points');
const creditService = require('./credit');
const notify = require('./notifications');
const parser = require('./qishui-parser');

const RECHECK_INTERVAL_MS = 10 * 60 * 1000;   // 10 分钟
const EXPIRY_INTERVAL_MS = 30 * 60 * 1000;    // 30 分钟
const RECHECK_BATCH_SIZE = 50;
const CLAIM_TIMEOUT_MINUTES = 30;

// 智能刷新:有人用就快,没人用就慢
const REFRESH_FAST_MS = 2 * 60 * 1000;        // 有活跃用户:2 分钟
const REFRESH_SLOW_MS = 30 * 60 * 1000;       // 无人使用:30 分钟
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;    // 5 分钟内有请求算活跃

let lastActivityAt = 0;                        // 最后一次 API 请求时间
let lastRefreshAt = 0;                         // 最后一次刷新时间

/**
 * 外部调用:记录用户活跃(在 server.js 的中间件里调)
 */
function recordActivity() {
  lastActivityAt = Date.now();
}

function isActive() {
  return (Date.now() - lastActivityAt) < ACTIVE_THRESHOLD_MS;
}

let recheckTimer = null;
let expiryTimer = null;
let smartTimer = null;

function startScheduler() {
  console.log('[scheduler] 启动定时任务');

  setTimeout(() => {
    runRecheckJob();
    runClaimTimeoutJob();
    runTaskExpiryJob();
    recheckTimer = setInterval(() => {
      runRecheckJob();
      runClaimTimeoutJob();
    }, RECHECK_INTERVAL_MS);
    expiryTimer = setInterval(runTaskExpiryJob, EXPIRY_INTERVAL_MS);

    // 智能刷新:每分钟检查一次是否该刷新
    smartTimer = setInterval(() => {
      const now = Date.now();
      const interval = isActive() ? REFRESH_FAST_MS : REFRESH_SLOW_MS;
      if (now - lastRefreshAt >= interval) {
        lastRefreshAt = now;
        runInteractionRefreshJob();
      }
    }, 60 * 1000);
  }, 30 * 1000);
}

/**
 * 回查已通过的 completion,发放积分
 */
async function runRecheckJob() {
  try {
    const results = await completionsService.recheckDueCompletions(RECHECK_BATCH_SIZE);
    if (results.length > 0) {
      const awarded = results.filter(r => r.status === 'awarded').length;
      const failed = results.filter(r => r.status === 'recheck_failed').length;
      console.log(`[scheduler] 回查 ${results.length} 条:发放 ${awarded},失败 ${failed}`);
    }
  } catch (err) {
    console.error('[scheduler] 回查任务异常:', err.message);
  }
}

/**
 * 超时未提交的接单 → 释放名额
 * claimed 状态且 claimed_at 超过 30 分钟的,自动标为 timeout
 */
async function runClaimTimeoutJob() {
  try {
    const [rows] = await pool.query(
      `SELECT id, task_id, user_id FROM task_completions
       WHERE status = 'claimed'
         AND claimed_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
       LIMIT 100`,
      [CLAIM_TIMEOUT_MINUTES]
    );
    if (rows.length === 0) return;

    for (const row of rows) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          `UPDATE task_completions SET status = 'timeout' WHERE id = ? AND status = 'claimed'`,
          [row.id]
        );
        await conn.query(
          `UPDATE tasks SET quota_remaining = quota_remaining + 1
           WHERE id = ? AND quota_remaining < quota_total`,
          [row.task_id]
        );
        await conn.commit();

        // 通知 + 扣信用分
        notify.send({
          userId: row.user_id,
          type: 'claim_timeout',
          title: '接单超时',
          content: '你有一个接单超过 30 分钟未提交,名额已释放',
          refType: 'task',
          refId: row.task_id
        });
        creditService.adjust(row.user_id, -10, '接单超时未提交', 'completion', row.id);
      } catch (e) {
        await conn.rollback();
      } finally {
        conn.release();
      }
    }
    console.log(`[scheduler] 超时释放 ${rows.length} 个接单名额`);
  } catch (err) {
    console.error('[scheduler] 接单超时处理异常:', err.message);
  }
}

/**
 * 过期任务 → 标记 expired + 退还剩余积分
 */
async function runTaskExpiryJob() {
  try {
    const [rows] = await pool.query(
      `SELECT id, publisher_id, reward_points, platform_fee, quota_total, quota_remaining
       FROM tasks
       WHERE status = 'active' AND expires_at <= NOW()
       LIMIT 50`
    );
    if (rows.length === 0) return;

    for (const task of rows) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // 计算退款
        const completedCount = task.quota_total - task.quota_remaining;
        const usedReward = completedCount * task.reward_points;
        const usedFee = Math.ceil(usedReward * 0.10);
        const refund = (task.reward_points * task.quota_remaining) +
                       (task.platform_fee - usedFee);

        if (refund > 0) {
          await pointsService.addInTx(conn, {
            userId: task.publisher_id,
            amount: refund,
            type: 'task_refund',
            refType: 'task',
            refId: task.id,
            note: `任务过期退款,剩余名额 ${task.quota_remaining}`
          });
        }

        await conn.query(
          `UPDATE tasks SET status = 'expired' WHERE id = ?`,
          [task.id]
        );

        await conn.commit();

        notify.send({
          userId: task.publisher_id,
          type: 'task_expired',
          title: '任务已过期',
          content: refund > 0 ? `已退还 ${refund} 积分` : '任务已全部完成',
          refType: 'task',
          refId: task.id
        });
      } catch (e) {
        await conn.rollback();
        console.error(`[scheduler] 过期任务 #${task.id} 处理失败:`, e.message);
      } finally {
        conn.release();
      }
    }
    console.log(`[scheduler] 过期处理 ${rows.length} 个任务`);
  } catch (err) {
    console.error('[scheduler] 任务过期处理异常:', err.message);
  }
}

function stopScheduler() {
  if (recheckTimer) clearInterval(recheckTimer);
  if (expiryTimer) clearInterval(expiryTimer);
  if (smartTimer) clearInterval(smartTimer);
  recheckTimer = null;
  expiryTimer = null;
  smartTimer = null;
}

/**
 * 每 5 分钟抓取活跃任务的最新互动数,更新快照
 */
async function runInteractionRefreshJob() {
  try {
    const [tasks] = await pool.query(
      `SELECT t.id, t.share_link, t.song_id
       FROM tasks t
       WHERE t.status = 'active' AND t.expires_at > NOW()
       ORDER BY t.created_at DESC
       LIMIT 10`
    );
    if (tasks.length === 0) return;

    let updated = 0;
    for (const task of tasks) {
      try {
        const fetched = await parser.fetchShareHtml(task.share_link);
        if (!fetched.ok) continue;
        const interactions = parser.extractInteractions(fetched.html);
        if (interactions.likes == null && interactions.comments == null) continue;

        await pool.query(
          `INSERT INTO interaction_snapshots
             (song_id, task_id, likes, comments, shares, plays, snapshot_type, source)
           VALUES (?, ?, ?, ?, ?, ?, 'periodic', 'scrape')`,
          [task.song_id, task.id,
           interactions.likes ?? null, interactions.comments ?? null,
           interactions.shares ?? null, interactions.plays ?? null]
        );
        updated++;

        // 避免太快被封,每次间隔 2 秒
        await new Promise(r => setTimeout(r, 2000));
      } catch {}
    }
    if (updated > 0) {
      console.log(`[scheduler] 互动数刷新 ${updated}/${tasks.length} 个任务`);
    }
  } catch (err) {
    console.error('[scheduler] 互动数刷新异常:', err.message);
  }
}

module.exports = { startScheduler, stopScheduler, recordActivity, runRecheckJob, runClaimTimeoutJob, runTaskExpiryJob, runInteractionRefreshJob };
