/**
 * 互动数刷新服务
 *
 * 给定一首歌的 share_link,实时抓取最新的互动数,并写入 interaction_snapshots
 * 用于接单时记 S1、完成时记 S2、24h 后回查记 S3
 */
const parser = require('./qishui-parser');
const pool = require('../config/db');

/**
 * 刷新一个任务关联歌曲的互动数,返回 { likes, comments, shares, plays } 和新快照 id
 *
 * @param {Object} params
 * @param {number} params.taskId - 关联任务 ID(可为 null,表示全局抓取)
 * @param {number} params.songId - songs.id
 * @param {string} params.shareLink - 分享链接
 * @param {string} params.snapshotType - 'task_claim' | 'task_complete' | 'recheck' | 'periodic'
 */
async function refreshAndSnapshot({ taskId, songId, shareLink, snapshotType }) {
  // 抓页
  const fetched = await parser.fetchShareHtml(shareLink);
  if (!fetched.ok) {
    return { ok: false, error: `抓取失败:${fetched.error}` };
  }

  // 提取互动数
  const interactions = parser.extractInteractions(fetched.html);

  // 写入快照表
  const [result] = await pool.query(
    `INSERT INTO interaction_snapshots
       (song_id, task_id, likes, comments, shares, plays, snapshot_type, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'scrape')`,
    [
      songId,
      taskId || null,
      interactions.likes ?? null,
      interactions.comments ?? null,
      interactions.shares ?? null,
      interactions.plays ?? null,
      snapshotType
    ]
  );

  return {
    ok: true,
    snapshotId: result.insertId,
    interactions
  };
}

/**
 * 获取一个任务最近的某类型快照
 */
async function getLatestSnapshot({ taskId, snapshotType }) {
  const [rows] = await pool.query(
    `SELECT id, likes, comments, shares, plays, created_at
     FROM interaction_snapshots
     WHERE task_id = ? AND snapshot_type = ?
     ORDER BY id DESC LIMIT 1`,
    [taskId, snapshotType]
  );
  return rows[0] || null;
}

module.exports = { refreshAndSnapshot, getLatestSnapshot };
