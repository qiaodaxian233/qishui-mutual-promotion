/**
 * 接单 + 自动验证(互动数差值校验)
 *
 * 流程:
 *   1. claim(领取):
 *      - 校验任务存在/活跃/有名额
 *      - 校验非自己发布
 *      - 反作弊:IP+设备指纹双因子(同 IP+同设备 不能接同一任务两次)
 *      - 抓当前互动数,存 baseline 快照
 *      - 锁行减名额,创建 completion 状态=claimed
 *
 *   2. submit(完成):
 *      - 校验是接单者本人
 *      - 校验状态=claimed
 *      - 再抓一次互动数 → 与 baseline 对比
 *      - like 任务:likes 增量 ≥ 1 → auto_passed
 *      - comment 任务:comments 增量 ≥ 1 → auto_passed
 *      - share 任务:shares 增量 ≥ 1 → auto_passed
 *      - 不增加 → auto_rejected,名额返还
 *
 *   3. recheck(24h 后定时回查,本阶段先写函数,定时调度后做):
 *      - 再抓一次 → 数没掉下去 → 发放积分
 *      - 数掉了(用户撤销点赞) → recheck_failed,扣信用分
 */
const pool = require('../config/db');
const parser = require('./qishui-parser');
const songsService = require('./songs');
const pointsService = require('./points');
const notify = require('./notifications');
const creditService = require('./credit');

const RECHECK_HOURS = 24;
const MIN_SUBMIT_INTERVAL_SECONDS = 10;  // 领取后至少 10 秒才能提交,防脚本秒过

const TASK_TYPE_TO_FIELD = {
  like: 'likes',
  comment: 'comments',
  share: 'shares'
};

/**
 * 领取任务
 *
 * @param {Object} params
 *   - userId, taskId
 *   - ipHash:已 hash 的 IP
 *   - deviceFp:设备指纹(前端传)
 *   - userAgent
 *
 * @returns {Object} { ok, completionId?, error?, baseline? }
 */
async function claimTask({ userId, taskId, ipHash, deviceFp, userAgent }) {
  if (!ipHash || !deviceFp) {
    return { ok: false, error: '缺少设备信息' };
  }
  if (deviceFp.length < 8) {
    return { ok: false, error: '设备指纹不合法' };
  }

  // 先抓一次互动数(放事务外,降低锁持有时间)
  const taskRow = await getTaskBrief(taskId);
  if (!taskRow) return { ok: false, error: '任务不存在' };
  if (taskRow.status !== 'active') return { ok: false, error: '任务已不可接' };
  if (taskRow.publisher_id === userId) {
    return { ok: false, error: '不能接自己发布的任务' };
  }
  if (taskRow.quota_remaining <= 0) {
    return { ok: false, error: '任务名额已满' };
  }
  if (new Date(taskRow.expires_at) < new Date()) {
    return { ok: false, error: '任务已过期' };
  }

  // 信用分检查
  const creditCheck = await creditService.canClaim(userId);
  if (!creditCheck.ok) return creditCheck;

  // 同一用户同一任务只能接一次(无论什么状态,必须等任务重新发布)
  const [[existingClaim]] = await pool.query(
    `SELECT id, status FROM task_completions WHERE task_id = ? AND user_id = ? LIMIT 1`,
    [taskId, userId]
  );
  if (existingClaim) {
    const statusMsg = {
      claimed: '你已接过这个任务,请完成后提交',
      auto_passed: '你已完成过这个任务',
      auto_rejected: '你已接过这个任务(验证未通过)',
      manual_passed: '你已完成过这个任务',
      recheck_failed: '你已接过这个任务',
      timeout: '你已接过这个任务(已超时)'
    };
    return { ok: false, error: statusMsg[existingClaim.status] || '你已接过这个任务' };
  }

  // 每日接单限流:防止短时间大量互动触发平台风控
  const dailyLimit = taskRow.max_daily_claims || 10;
  const [[todayCount]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM task_completions
     WHERE task_id = ? AND DATE(claimed_at) = CURDATE()`,
    [taskId]
  );
  if (todayCount.cnt >= dailyLimit) {
    return {
      ok: false,
      error: `今日接单已达上限(${dailyLimit}单/天),明天再来吧`,
      dailyLimitReached: true
    };
  }

  // 接单冷却:两次接单之间必须间隔 N 秒
  const cooldown = taskRow.claim_cooldown_sec || 30;
  const [[lastClaim]] = await pool.query(
    `SELECT claimed_at FROM task_completions WHERE task_id = ? ORDER BY id DESC LIMIT 1`,
    [taskId]
  );
  if (lastClaim) {
    const elapsed = (Date.now() - new Date(lastClaim.claimed_at).getTime()) / 1000;
    if (elapsed < cooldown) {
      return {
        ok: false,
        error: `任务冷却中,请 ${Math.ceil(cooldown - elapsed)} 秒后再试`,
        cooldown: true
      };
    }
  }

  // 抓最新互动数作为 baseline
  let baseline;
  try {
    const fetched = await parser.fetchShareHtml(taskRow.share_link);
    if (!fetched.ok) {
      return { ok: false, error: `抓取分享页失败:${fetched.error}` };
    }
    baseline = parser.extractInteractions(fetched.html);
  } catch (err) {
    return { ok: false, error: '抓取互动数失败:' + err.message };
  }

  // 开事务:扣名额 + 创建 completion + 记快照
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 行锁读任务
    const [tasks] = await conn.query(
      `SELECT id, publisher_id, status, quota_remaining, expires_at, song_id, task_type
       FROM tasks WHERE id = ? FOR UPDATE`,
      [taskId]
    );
    if (tasks.length === 0) {
      await conn.rollback();
      return { ok: false, error: '任务不存在' };
    }
    const task = tasks[0];
    if (task.status !== 'active' || task.quota_remaining <= 0) {
      await conn.rollback();
      return { ok: false, error: '任务已不可接' };
    }
    if (new Date(task.expires_at) < new Date()) {
      await conn.rollback();
      return { ok: false, error: '任务已过期' };
    }

    // 扣名额
    await conn.query(
      `UPDATE tasks SET quota_remaining = quota_remaining - 1 WHERE id = ?`,
      [taskId]
    );

    // 创建 completion(claimed 状态)
    const [insertResult] = await conn.query(
      `INSERT INTO task_completions
         (task_id, user_id, ip_hash, device_fp, user_agent, status, claimed_at)
       VALUES (?, ?, ?, ?, ?, 'claimed', NOW())`,
      [taskId, userId, ipHash, deviceFp, userAgent || null]
    );
    const completionId = insertResult.insertId;

    // 记 baseline 快照(关联 task_id,后续 submit 时再查这个)
    await conn.query(
      `INSERT INTO interaction_snapshots
         (song_id, task_id, likes, comments, shares, plays, snapshot_type, source)
       VALUES (?, ?, ?, ?, ?, ?, 'task_create', 'scrape')`,
      [
        task.song_id, taskId,
        baseline.likes ?? null,
        baseline.comments ?? null,
        baseline.shares ?? null,
        baseline.plays ?? null
      ]
    );

    // 更新任务最后接单时间(触发冷却)
    await conn.query(
      `UPDATE tasks SET last_claimed_at = NOW() WHERE id = ?`,
      [taskId]
    );

    await conn.commit();
    // 通知发布者有人接单
    notify.send({
      userId: task.publisher_id,
      type: 'task_claimed',
      title: '有人接了你的任务',
      content: `你的${task.task_type === 'like' ? '点赞' : task.task_type}任务被接单了,剩余名额 ${task.quota_remaining - 1}`,
      refType: 'task',
      refId: taskId
    });

    return {
      ok: true,
      completionId,
      baseline,
      taskType: task.task_type,
      shareLink: taskRow.share_link,
      tip: getClaimTip(task.task_type)
    };
  } catch (err) {
    await conn.rollback();

    // 唯一约束冲突
    if (err.code === 'ER_DUP_ENTRY') {
      if (err.message.includes('uk_task_user')) {
        return { ok: false, error: '你已接过这个任务' };
      }
      if (err.message.includes('uk_task_ip_device')) {
        return { ok: false, error: '相同设备已接过这个任务' };
      }
      return { ok: false, error: '重复接单' };
    }

    console.error('[completions] 接单失败:', err);
    return { ok: false, error: '接单失败:' + err.message };
  } finally {
    conn.release();
  }
}

/**
 * 提交完成(自动验证)
 *
 * @returns {Object} { ok, status, delta?, awarded?, error? }
 */
async function submitCompletion({ userId, completionId, screenshotPath, screenshotHash }) {
  // 查 completion
  const [rows] = await pool.query(
    `SELECT c.id, c.task_id, c.user_id, c.status, c.claimed_at,
            t.task_type, t.reward_points, t.share_link, t.song_id, t.publisher_id
     FROM task_completions c
     JOIN tasks t ON t.id = c.task_id
     WHERE c.id = ?
     LIMIT 1`,
    [completionId]
  );
  if (rows.length === 0) return { ok: false, error: '接单记录不存在' };
  const c = rows[0];

  if (c.user_id !== userId) return { ok: false, error: '不能提交他人的接单' };
  if (c.status !== 'claimed') {
    return { ok: false, error: `当前状态不可提交,每个任务只能提交一次` };
  }

  // 防脚本秒过:接单后至少 10 秒才能提交
  const claimedAt = new Date(c.claimed_at).getTime();
  const elapsed = (Date.now() - claimedAt) / 1000;
  if (elapsed < MIN_SUBMIT_INTERVAL_SECONDS) {
    return {
      ok: false,
      error: `操作过快,请在汽水音乐完成动作后再提交(再等 ${Math.ceil(MIN_SUBMIT_INTERVAL_SECONDS - elapsed)} 秒)`
    };
  }

  // 取 baseline 快照(claim 时存的)
  const [baselines] = await pool.query(
    `SELECT likes, comments, shares, plays FROM interaction_snapshots
     WHERE task_id = ? AND snapshot_type = 'task_create'
     ORDER BY created_at DESC LIMIT 1`,
    [c.task_id]
  );
  if (baselines.length === 0) {
    return { ok: false, error: '基线快照丢失,请联系管理员' };
  }
  const baseline = baselines[0];

  // 抓当前互动数
  let current;
  try {
    const fetched = await parser.fetchShareHtml(c.share_link);
    if (!fetched.ok) {
      return { ok: false, error: `抓取分享页失败:${fetched.error}` };
    }
    current = parser.extractInteractions(fetched.html);
  } catch (err) {
    return { ok: false, error: '抓取互动数失败:' + err.message };
  }

  // 比对增量
  const field = TASK_TYPE_TO_FIELD[c.task_type];
  if (!field) {
    return { ok: false, error: `任务类型 ${c.task_type} 暂不支持自动验证` };
  }
  const baseVal = baseline[field];
  const currVal = current[field];
  const delta = (currVal != null && baseVal != null) ? currVal - baseVal : null;

  // 记当前快照
  await pool.query(
    `INSERT INTO interaction_snapshots
       (song_id, task_id, likes, comments, shares, plays, snapshot_type, source)
     VALUES (?, ?, ?, ?, ?, ?, 'task_complete', 'scrape')`,
    [c.song_id, c.task_id, current.likes ?? null, current.comments ?? null, current.shares ?? null, current.plays ?? null]
  );

  // 保存截图凭证到 task_proofs
  if (screenshotPath) {
    try {
      await pool.query(
        `INSERT INTO task_proofs (completion_id, file_path, file_sha256, file_size_kb, mime_type)
         VALUES (?, ?, ?, ?, 'image/webp')`,
        [completionId, screenshotPath, screenshotHash || '', 0]
      );
    } catch (proofErr) {
      // 截图存证失败不阻塞主流程,只记日志
      console.error(`[submit] 截图存证失败 completion#${completionId}:`, proofErr.message);
    }
  }

  // 增量 < 1 → 失败,返还名额
  if (delta == null || delta < 1) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE task_completions SET status = 'auto_rejected', submitted_at = NOW() WHERE id = ?`,
        [completionId]
      );
      // 返还名额
      await conn.query(
        `UPDATE tasks SET quota_remaining = quota_remaining + 1 WHERE id = ?`,
        [c.task_id]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    notify.send({
      userId,
      type: 'verify_failed',
      title: '验证未通过',
      content: getRejectMessage(c.task_type, baseVal, currVal),
      refType: 'completion',
      refId: completionId
    });

    return {
      ok: false,
      status: 'auto_rejected',
      error: getRejectMessage(c.task_type, baseVal, currVal),
      baseline: { [field]: baseVal },
      current: { [field]: currVal },
      delta
    };
  }

  // 增量 >= 1 → 通过自动验证,设 recheck_at = NOW + 24h
  // 注意:积分**先不发放**,等 24h 回查通过后再发
  await pool.query(
    `UPDATE task_completions
        SET status = 'auto_passed',
            submitted_at = NOW(),
            recheck_at = DATE_ADD(NOW(), INTERVAL ? HOUR)
      WHERE id = ?`,
    [RECHECK_HOURS, completionId]
  );

  notify.send({
    userId,
    type: 'verify_passed',
    title: '验证通过',
    content: `你的任务验证通过,${c.reward_points} 积分将在 ${RECHECK_HOURS}h 回查后发放`,
    refType: 'completion',
    refId: completionId
  });

  return {
    ok: true,
    status: 'auto_passed',
    message: `验证通过!积分将在 ${RECHECK_HOURS} 小时回查后发放`,
    baseline: { [field]: baseVal },
    current: { [field]: currVal },
    delta,
    rewardPoints: c.reward_points,
    recheckAt: new Date(Date.now() + RECHECK_HOURS * 3600 * 1000).toISOString()
  };
}

/**
 * 单条 completion 的 24h 回查
 *
 * @returns {Object} { ok, status, awarded?, error? }
 */
async function recheckCompletion(completionId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.task_id, c.user_id, c.status, c.recheck_at, c.recheck_done,
            t.task_type, t.reward_points, t.share_link, t.song_id, t.publisher_id
     FROM task_completions c
     JOIN tasks t ON t.id = c.task_id
     WHERE c.id = ?
     LIMIT 1`,
    [completionId]
  );
  if (rows.length === 0) return { ok: false, error: '记录不存在' };
  const c = rows[0];

  if (c.status !== 'auto_passed') {
    return { ok: false, error: `当前状态(${c.status})无需回查` };
  }
  if (c.recheck_done) {
    return { ok: false, error: '已回查过' };
  }

  // 取 task_complete 那次快照
  const [completeSnaps] = await pool.query(
    `SELECT likes, comments, shares, plays FROM interaction_snapshots
     WHERE task_id = ? AND snapshot_type = 'task_complete'
     ORDER BY created_at DESC LIMIT 1`,
    [c.task_id]
  );
  if (completeSnaps.length === 0) {
    return { ok: false, error: '完成快照丢失' };
  }
  const completeSnap = completeSnaps[0];

  // 再抓一次
  let current;
  try {
    const fetched = await parser.fetchShareHtml(c.share_link);
    if (!fetched.ok) return { ok: false, error: '抓取失败:' + fetched.error };
    current = parser.extractInteractions(fetched.html);
  } catch (err) {
    return { ok: false, error: '抓取失败:' + err.message };
  }

  // 记回查快照
  await pool.query(
    `INSERT INTO interaction_snapshots
       (song_id, task_id, likes, comments, shares, plays, snapshot_type, source)
     VALUES (?, ?, ?, ?, ?, ?, 'recheck', 'scrape')`,
    [c.song_id, c.task_id, current.likes ?? null, current.comments ?? null, current.shares ?? null, current.plays ?? null]
  );

  // 数没掉 → 发放积分;掉了 → recheck_failed
  const field = TASK_TYPE_TO_FIELD[c.task_type];
  const completedVal = completeSnap[field];
  const currVal = current[field];
  const stillUp = (completedVal != null && currVal != null && currVal >= completedVal);

  if (stillUp) {
    // 发放积分(给接单者)
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await pointsService.addInTx(conn, {
        userId: c.user_id,
        amount: c.reward_points,
        type: 'task_complete',
        refType: 'completion',
        refId: completionId,
        note: `完成任务 #${c.task_id} 奖励`
      });
      if (!result.ok) {
        await conn.rollback();
        return result;
      }
      await conn.query(
        `UPDATE task_completions
            SET status = 'manual_passed',
                recheck_done = 1,
                points_awarded = ?,
                awarded_at = NOW()
          WHERE id = ?`,
        [c.reward_points, completionId]
      );
      await conn.commit();

      notify.send({
        userId: c.user_id,
        type: 'points_awarded',
        title: '积分已到账',
        content: `回查通过,${c.reward_points} 积分已发放到你的账户`,
        refType: 'completion',
        refId: completionId
      });

      // 回查通过加信用分
      creditService.adjust(c.user_id, +3, '回查通过,积分发放', 'completion', completionId);

      return { ok: true, status: 'awarded', awarded: c.reward_points };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } else {
    // 互动撤回 → 回查失败
    await pool.query(
      `UPDATE task_completions
          SET status = 'recheck_failed',
              recheck_done = 1
        WHERE id = ?`,
      [completionId]
    );

    notify.send({
      userId: c.user_id,
      type: 'verify_failed',
      title: '回查未通过',
      content: '24h 回查发现互动已被撤回,积分不予发放',
      refType: 'completion',
      refId: completionId
    });

    // 扣信用分
    creditService.adjust(c.user_id, -20, '回查发现互动撤回', 'completion', completionId);

    return { ok: false, status: 'recheck_failed', error: '互动已被撤回' };
  }
}

/**
 * 批量回查到期的 completions(给定时任务用)
 */
async function recheckDueCompletions(limit = 50) {
  const [rows] = await pool.query(
    `SELECT id FROM task_completions
     WHERE status = 'auto_passed'
       AND recheck_done = 0
       AND recheck_at <= NOW()
     LIMIT ?`,
    [limit]
  );
  const results = [];
  for (const r of rows) {
    try {
      const result = await recheckCompletion(r.id);
      results.push({ completionId: r.id, ...result });
    } catch (err) {
      results.push({ completionId: r.id, ok: false, error: err.message });
    }
  }
  return results;
}

/**
 * 列出我接的任务
 */
async function listMyCompletions(userId, { limit = 20, offset = 0 } = {}) {
  const [rows] = await pool.query(
    `SELECT c.id, c.task_id, c.status, c.points_awarded,
            c.claimed_at, c.submitted_at, c.recheck_at, c.awarded_at,
            t.task_type, t.reward_points,
            s.song_name, s.artist_name, s.cover_url
     FROM task_completions c
     JOIN tasks t ON t.id = c.task_id
     JOIN songs s ON s.id = t.song_id
     WHERE c.user_id = ?
     ORDER BY c.claimed_at DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return rows;
}

/**
 * 查接单详情(供"完成"页面回显)
 */
async function getCompletionDetail(completionId, userId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.task_id, c.user_id, c.status, c.points_awarded,
            c.claimed_at, c.submitted_at, c.recheck_at, c.awarded_at,
            t.task_type, t.reward_points, t.share_link, t.min_listen_sec,
            s.song_name, s.artist_name, s.cover_url
     FROM task_completions c
     JOIN tasks t ON t.id = c.task_id
     JOIN songs s ON s.id = t.song_id
     WHERE c.id = ?
     LIMIT 1`,
    [completionId]
  );
  if (rows.length === 0) return null;
  if (rows[0].user_id !== userId) return null;
  return rows[0];
}

// ============================================================
// 辅助函数
// ============================================================

async function getTaskBrief(taskId) {
  const [rows] = await pool.query(
    `SELECT id, publisher_id, song_id, task_type, share_link,
            quota_remaining, expires_at, status, max_daily_claims, claim_cooldown_sec
     FROM tasks WHERE id = ? LIMIT 1`,
    [taskId]
  );
  return rows[0] || null;
}

function getClaimTip(taskType) {
  const tips = {
    like:    '请打开汽水音乐 App,点击该歌曲页右侧的 ❤️ 收藏(点赞)按钮,完成后回到本平台点击「我已完成」',
    comment: '请打开汽水音乐 App,在该歌曲下方发表评论(建议带正面评价 + 关键词),完成后回到本平台点击「我已完成」',
    share:   '请打开汽水音乐 App,点击该歌曲的分享按钮,完成后回到本平台点击「我已完成」',
    listen:  '请打开汽水音乐 App,播放该歌曲到指定秒数,完成后回到本平台点击「我已完成」'
  };
  return tips[taskType] || '请按任务要求完成对应动作';
}

function getRejectMessage(taskType, baseVal, currVal) {
  const fieldName = { like: '点赞', comment: '评论', share: '分享' }[taskType] || '互动';
  if (baseVal == null || currVal == null) {
    return `无法获取${fieldName}数,请稍后再试`;
  }
  if (currVal === baseVal) {
    return `${fieldName}数未变化(${baseVal}),请确认已在汽水完成${fieldName}`;
  }
  return `${fieldName}数变化异常(${baseVal} → ${currVal})`;
}

module.exports = {
  claimTask,
  submitCompletion,
  recheckCompletion,
  recheckDueCompletions,
  listMyCompletions,
  getCompletionDetail
};
