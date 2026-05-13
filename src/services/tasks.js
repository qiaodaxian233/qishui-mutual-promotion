/**
 * 任务发布与查询
 */
const pool = require('../config/db');
const songsService = require('./songs');
const pointsService = require('./points');
const parser = require('./qishui-parser');

// 任务类型配置
const TASK_TYPES = {
  like: {
    label: '点赞',
    minReward: 1,
    maxReward: 20,
    requiresMinListenSec: false
  },
  listen: {
    label: '播放',
    minReward: 1,
    maxReward: 30,
    requiresMinListenSec: true,
    minListenSecRange: [15, 600]   // 15 秒到 10 分钟
  },
  comment: {
    label: '评论',
    minReward: 3,
    maxReward: 50,
    requiresMinListenSec: false
  },
  share: {
    label: '分享',
    minReward: 2,
    maxReward: 30,
    requiresMinListenSec: false
  }
};

const PLATFORM_FEE_RATE = 0.10;   // 10% 抽成
const TASK_EXPIRE_DAYS = 7;       // 任务默认 7 天过期

/**
 * 校验发布参数
 */
function validatePublishParams(params) {
  const errors = [];
  const {
    taskType, reward, quota, minListenSec
  } = params;

  if (!TASK_TYPES[taskType]) {
    errors.push('任务类型不正确');
    return errors;
  }
  const cfg = TASK_TYPES[taskType];

  if (!Number.isInteger(reward) || reward < cfg.minReward || reward > cfg.maxReward) {
    errors.push(`单个积分应在 ${cfg.minReward}~${cfg.maxReward} 之间`);
  }
  if (!Number.isInteger(quota) || quota < 1 || quota > 1000) {
    errors.push('名额应在 1~1000 之间');
  }
  if (cfg.requiresMinListenSec) {
    const [min, max] = cfg.minListenSecRange;
    if (!Number.isInteger(minListenSec) || minListenSec < min || minListenSec > max) {
      errors.push(`播放秒数应在 ${min}~${max} 之间`);
    }
  }

  return errors;
}

/**
 * 计算成本
 * 发布者付:reward × quota + fee
 * 接单者拿:reward(单个)
 * 平台抽:10%(销毁)
 */
function calculateCost(reward, quota) {
  const subtotal = reward * quota;
  const fee = Math.ceil(subtotal * PLATFORM_FEE_RATE);
  return {
    subtotal,
    fee,
    total: subtotal + fee
  };
}

/**
 * 发布任务
 *
 * 流程:
 *   1. 解析分享文案(纯文本)
 *   2. HTTP 抓取分享页,提取 song_id 和互动数
 *   3. upsert songs 表
 *   4. 检查 24h 内是否有同歌活跃任务
 *   5. 开事务:扣发布者积分 → 创建任务 → 记互动快照
 */
async function publishTask({ publisherId, shareText, taskType, reward, quota, minListenSec, commentRule }) {
  // 1. 校验参数
  const errs = validatePublishParams({ taskType, reward, quota, minListenSec });
  if (errs.length > 0) {
    return { ok: false, error: errs.join(';') };
  }

  // 2. 解析 + 抓取
  const parseResult = await parser.parseShareLink(shareText);
  if (!parseResult.ok) {
    return { ok: false, error: parseResult.error, stage: parseResult.stage };
  }
  const { parsed, meta, interactions, nameWarning } = parseResult;

  // 3. upsert songs
  const songRow = await songsService.upsertSong({
    qishuiSongId: meta.qishuiSongId,
    songName: meta.songName,
    artistName: meta.artistName,
    coverUrl: meta.coverUrl,
    durationSec: meta.durationSec,
    interactions
  });

  // 3.5. listen 任务的播放秒数不能超过歌曲时长
  if (taskType === 'listen' && meta.durationSec && minListenSec > meta.durationSec) {
    return {
      ok: false,
      error: `要求播放秒数(${minListenSec})超过歌曲总时长(${meta.durationSec})`
    };
  }

  // 4. 24h 同歌去重
  const dup = await songsService.hasActiveTaskWithinHours(songRow.id, 24);
  if (dup) {
    return {
      ok: false,
      error: '这首歌 24 小时内已有活跃任务,请先等待该任务结束或撤销'
    };
  }

  // 5. 算成本
  const cost = calculateCost(reward, quota);

  // 6. 开事务:扣积分 + 建任务 + 记快照
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 扣发布者积分
    const deductResult = await pointsService.deductInTx(conn, {
      userId: publisherId,
      amount: cost.total,
      type: 'task_publish',
      note: `发布${TASK_TYPES[taskType].label}任务:${meta.songName}`
    });
    if (!deductResult.ok) {
      await conn.rollback();
      return { ok: false, error: deductResult.error, balance: deductResult.balance };
    }

    // 创建任务
    const [taskResult] = await conn.query(
      `INSERT INTO tasks
         (publisher_id, song_id, share_link, share_code, share_text_raw,
          task_type, min_listen_sec, comment_rule,
          reward_points, platform_fee, total_cost,
          quota_total, quota_remaining,
          expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), 'active')`,
      [
        publisherId,
        songRow.id,
        parsed.shareLink,
        parsed.shareCode,
        shareText.slice(0, 1000),
        taskType,
        minListenSec || null,
        commentRule ? JSON.stringify(commentRule) : null,
        reward,
        cost.fee,
        cost.total,
        quota,
        quota,
        TASK_EXPIRE_DAYS
      ]
    );
    const taskId = taskResult.insertId;

    // 更新积分流水的 ref
    await conn.query(
      `UPDATE points_log SET ref_type = 'task', ref_id = ?
       WHERE user_id = ? AND type = 'task_publish'
       ORDER BY id DESC LIMIT 1`,
      [taskId, publisherId]
    );

    // 记互动快照
    if (interactions.likes != null || interactions.comments != null) {
      await conn.query(
        `INSERT INTO interaction_snapshots
           (song_id, task_id, likes, comments, shares, plays, snapshot_type, source)
         VALUES (?, ?, ?, ?, ?, ?, 'task_create', 'scrape')`,
        [
          songRow.id, taskId,
          interactions.likes ?? null,
          interactions.comments ?? null,
          interactions.shares ?? null,
          interactions.plays ?? null
        ]
      );
    }

    await conn.commit();

    return {
      ok: true,
      taskId,
      cost,
      song: {
        id: songRow.id,
        name: meta.songName,
        artist: meta.artistName,
        cover: meta.coverUrl
      },
      warnings: nameWarning ? [nameWarning] : [],
      songIdFallback: meta.songIdFallback
    };
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return { ok: false, error: '任务重复' };
    }
    console.error('[tasks] 发布失败:', err);
    return { ok: false, error: '发布失败:' + err.message };
  } finally {
    conn.release();
  }
}

/**
 * 获取任务列表(广场)
 */
async function listTasks({ taskType, status = 'active', limit = 20, offset = 0 }) {
  const conditions = [`t.status = ?`];
  const params = [status];

  if (taskType && TASK_TYPES[taskType]) {
    conditions.push(`t.task_type = ?`);
    params.push(taskType);
  }

  // 还有名额
  conditions.push(`t.quota_remaining > 0`);
  // 未过期
  conditions.push(`t.expires_at > NOW()`);
  // 链接没失效
  conditions.push(`t.link_check_failed = 0`);

  params.push(limit, offset);

  const [rows] = await pool.query(
    `SELECT
       t.id, t.task_type, t.reward_points, t.quota_total, t.quota_remaining,
       t.min_listen_sec, t.share_link, t.expires_at, t.created_at,
       t.is_welfare, t.is_pinned, t.pinned_at,
       s.song_name, s.artist_name, s.cover_url,
       COALESCE(snap.likes, s.first_seen_likes) AS likes,
       COALESCE(snap.comments, s.first_seen_comments) AS comments,
       COALESCE(snap.shares, s.first_seen_shares) AS shares,
       u.nickname AS publisher_nickname
     FROM tasks t
     JOIN songs s ON s.id = t.song_id
     JOIN users u ON u.id = t.publisher_id
     LEFT JOIN (
       SELECT task_id, likes, comments, shares
       FROM interaction_snapshots i1
       WHERE i1.id = (
         SELECT MAX(i2.id) FROM interaction_snapshots i2 WHERE i2.task_id = i1.task_id
       )
     ) snap ON snap.task_id = t.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.is_pinned DESC, t.is_welfare DESC, t.created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );

  return rows;
}

/**
 * 获取单个任务详情
 */
async function getTaskById(taskId) {
  const [rows] = await pool.query(
    `SELECT
       t.*,
       s.song_name, s.artist_name, s.cover_url, s.duration_sec,
       u.nickname AS publisher_nickname
     FROM tasks t
     JOIN songs s ON s.id = t.song_id
     JOIN users u ON u.id = t.publisher_id
     WHERE t.id = ?
     LIMIT 1`,
    [taskId]
  );
  return rows[0] || null;
}

/**
 * 获取用户自己发布的任务列表
 */
async function listMyTasks(publisherId, { limit = 20, offset = 0 } = {}) {
  const [rows] = await pool.query(
    `SELECT
       t.id, t.task_type, t.status,
       t.reward_points, t.quota_total, t.quota_remaining, t.total_cost,
       t.created_at, t.expires_at,
       s.song_name, s.artist_name, s.cover_url
     FROM tasks t
     JOIN songs s ON s.id = t.song_id
     WHERE t.publisher_id = ?
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`,
    [publisherId, limit, offset]
  );
  return rows;
}

/**
 * 撤销任务(只能撤销自己的、还没人接的)
 * 退还剩余积分
 */
async function cancelTask(publisherId, taskId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [tasks] = await conn.query(
      `SELECT id, publisher_id, status, reward_points, platform_fee,
              quota_total, quota_remaining
       FROM tasks WHERE id = ? FOR UPDATE`,
      [taskId]
    );
    if (tasks.length === 0) {
      await conn.rollback();
      return { ok: false, error: '任务不存在' };
    }
    const task = tasks[0];
    if (task.publisher_id !== publisherId) {
      await conn.rollback();
      return { ok: false, error: '无权撤销他人的任务' };
    }
    if (task.status !== 'active') {
      await conn.rollback();
      return { ok: false, error: '任务当前状态不可撤销' };
    }

    // 退款:按剩余名额比例 + 按比例退手续费
    const completedCount = task.quota_total - task.quota_remaining;
    const usedReward = completedCount * task.reward_points;
    const usedFee = Math.ceil(usedReward * PLATFORM_FEE_RATE);
    const refund = (task.reward_points * task.quota_remaining) +
                   (task.platform_fee - usedFee);

    if (refund > 0) {
      const addResult = await pointsService.addInTx(conn, {
        userId: publisherId,
        amount: refund,
        type: 'task_refund',
        refType: 'task',
        refId: taskId,
        note: `撤销任务退款,剩余名额 ${task.quota_remaining}`
      });
      if (!addResult.ok) {
        await conn.rollback();
        return addResult;
      }
    }

    // 状态置 cancelled
    await conn.query(
      `UPDATE tasks SET status = 'cancelled' WHERE id = ?`,
      [taskId]
    );

    await conn.commit();
    return { ok: true, refund };
  } catch (err) {
    await conn.rollback();
    console.error('[tasks] 撤销失败:', err);
    return { ok: false, error: '撤销失败:' + err.message };
  } finally {
    conn.release();
  }
}

module.exports = {
  TASK_TYPES,
  PLATFORM_FEE_RATE,
  calculateCost,
  validatePublishParams,
  publishTask,
  publishWelfareTask,
  pinTask,
  listTasks,
  getTaskById,
  listMyTasks,
  cancelTask
};

const PIN_COST = 50;

/**
 * 置顶任务(扣 50 积分,置顶 7 天)
 */
async function pinTask({ taskId, userId }) {
  // 查任务
  const [[task]] = await pool.query(
    `SELECT id, publisher_id, status, is_pinned FROM tasks WHERE id = ?`,
    [taskId]
  );
  if (!task) return { ok: false, error: '任务不存在' };
  if (task.publisher_id !== userId) return { ok: false, error: '只能置顶自己的任务' };
  if (task.status !== 'active') return { ok: false, error: '只有进行中的任务可以置顶' };
  if (task.is_pinned) return { ok: false, error: '任务已经置顶了' };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 扣积分
    const deductResult = await pointsService.deductInTx(conn, {
      userId,
      amount: PIN_COST,
      type: 'task_pin',
      refType: 'task',
      refId: taskId,
      note: `置顶任务 #${taskId}`
    });
    if (!deductResult.ok) {
      await conn.rollback();
      return { ok: false, error: deductResult.error || '积分不足' };
    }

    // 置顶
    await conn.query(
      `UPDATE tasks SET is_pinned = 1, pinned_at = NOW() WHERE id = ?`,
      [taskId]
    );

    await conn.commit();
    return { ok: true, message: '置顶成功！歌名将以金色流光显示' };
  } catch (err) {
    await conn.rollback();
    return { ok: false, error: '置顶失败：' + err.message };
  } finally {
    conn.release();
  }
}

/**
 * 系统发布福利任务(不扣积分、跳过 24h 去重)
 *
 * @param {Object} opts
 * @param {number} opts.publisherId  - 管理员用户 ID(作为发布者)
 * @param {string} opts.shareText    - 汽水分享文案
 * @param {string} opts.taskType     - like/listen/comment/share
 * @param {number} opts.reward       - 单次奖励积分
 * @param {number} opts.quota        - 名额
 * @param {number} [opts.minListenSec]
 * @returns {Object} { ok, taskId, song, ... }
 */
async function publishWelfareTask({ publisherId, shareText, taskType, reward, quota, minListenSec }) {
  // 基本校验
  const errs = validatePublishParams({ taskType, reward, quota, minListenSec });
  if (errs.length > 0) {
    return { ok: false, error: errs.join(';') };
  }

  // 解析分享文案
  const parseResult = await parser.parseShareLink(shareText);
  if (!parseResult.ok) {
    return { ok: false, error: parseResult.error, stage: parseResult.stage };
  }
  const { parsed, meta, interactions } = parseResult;

  // upsert 歌曲
  const songRow = await songsService.upsertSong({
    qishuiSongId: meta.qishuiSongId,
    songName: meta.songName,
    artistName: meta.artistName,
    coverUrl: meta.coverUrl,
    durationSec: meta.durationSec,
    interactions
  });

  if (taskType === 'listen' && meta.durationSec && minListenSec > meta.durationSec) {
    return { ok: false, error: `播放秒数(${minListenSec})超过歌曲时长(${meta.durationSec})` };
  }

  // 算费用(记录用,但不实际扣)
  const cost = calculateCost(reward, quota);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 直接建任务,不扣积分
    const [taskResult] = await conn.query(
      `INSERT INTO tasks
         (publisher_id, song_id, share_link, share_code, share_text_raw,
          task_type, min_listen_sec,
          reward_points, platform_fee, total_cost,
          quota_total, quota_remaining,
          is_welfare,
          expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, DATE_ADD(NOW(), INTERVAL ? DAY), 'active')`,
      [
        publisherId,
        songRow.id,
        parsed.shareLink,
        parsed.shareCode,
        shareText.slice(0, 1000),
        taskType,
        minListenSec || null,
        reward,
        0,          // 福利任务不收手续费
        cost.total, // 记录但不扣
        quota,
        quota,
        TASK_EXPIRE_DAYS
      ]
    );
    const taskId = taskResult.insertId;

    // 记互动快照
    if (interactions.likes != null || interactions.comments != null) {
      await conn.query(
        `INSERT INTO interaction_snapshots
           (song_id, task_id, likes, comments, shares, plays, snapshot_type, source)
         VALUES (?, ?, ?, ?, ?, ?, 'task_create', 'scrape')`,
        [
          songRow.id, taskId,
          interactions.likes ?? null,
          interactions.comments ?? null,
          interactions.shares ?? null,
          interactions.plays ?? null
        ]
      );
    }

    await conn.commit();

    return {
      ok: true,
      taskId,
      song: { id: songRow.id, name: meta.songName, artist: meta.artistName }
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
