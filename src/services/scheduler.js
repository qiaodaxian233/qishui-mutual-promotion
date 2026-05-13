/**
 * 简易定时调度器(基于 setInterval,无外部依赖)
 *
 * 当前任务:
 * - 每 10 分钟回查一次 auto_passed 且 recheck_at 到期的 completion
 *
 * 未来可加:
 * - 每小时检查活跃任务的分享链接是否失效
 * - 每天凌晨过期任务的清理
 */
const completionsService = require('./completions');

const RECHECK_INTERVAL_MS = 10 * 60 * 1000;   // 10 分钟
const RECHECK_BATCH_SIZE = 50;

let recheckTimer = null;

function startScheduler() {
  console.log('[scheduler] 启动定时任务');

  // 启动后先延迟 30 秒再跑首次(让服务先稳定下来)
  setTimeout(() => {
    runRecheckJob();
    recheckTimer = setInterval(runRecheckJob, RECHECK_INTERVAL_MS);
  }, 30 * 1000);
}

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

function stopScheduler() {
  if (recheckTimer) clearInterval(recheckTimer);
  recheckTimer = null;
}

module.exports = { startScheduler, stopScheduler, runRecheckJob };
