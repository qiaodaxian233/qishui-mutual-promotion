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

const RECHECK_INTERVAL_MS = 10 * 60 * 1000;   // 10 分钟
const EXPIRY_INTERVAL_MS = 30 * 60 * 1000;    // 30 分钟
const RECHECK_BATCH_SIZE = 50;
const CLAIM_TIMEOUT_MINUTES = 30;              // 接单后 30 分钟不提交就超时

let recheckTimer = null;
let expiryTimer = null;

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

        const refund = (task.reward_points * task.quota_remaining) +
                       (task.platform_fee - Math.ceil((task.quota_total - task.quota_remaining) * task.reward_points * 0.10));
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
  recheckTimer = null;
  expiryTimer = null;
}

module.exports = { startScheduler, stopScheduler, runRecheckJob, runClaimTimeoutJob, runTaskExpiryJob };
