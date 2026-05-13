/**
 * 歌曲表(songs)操作
 *
 * 关键职责:平台级去重 —— 同一首歌不同发布者分享生成的短码可能不同,
 * 但 qishui_song_id(从分享页解析的底层 ID)是唯一的
 */
const pool = require('../config/db');

/**
 * upsert 一首歌:存在就返回,不存在就插入
 * @param {Object} song - { qishuiSongId, songName, artistName, coverUrl, durationSec, interactions }
 * @returns {Object} { id, isNew }
 */
async function upsertSong(song) {
  // 先查
  const [existing] = await pool.query(
    `SELECT id FROM songs WHERE qishui_song_id = ? LIMIT 1`,
    [song.qishuiSongId]
  );

  if (existing.length > 0) {
    // 已有,顺便更新更详细的元数据(如果之前是 null 的话)
    await pool.query(
      `UPDATE songs
         SET song_name   = COALESCE(NULLIF(song_name,''), ?),
             artist_name = COALESCE(NULLIF(artist_name,''), ?),
             cover_url   = COALESCE(NULLIF(cover_url,''), ?),
             duration_sec = COALESCE(duration_sec, ?)
       WHERE id = ?`,
      [
        song.songName || null,
        song.artistName || null,
        song.coverUrl || null,
        song.durationSec || null,
        existing[0].id
      ]
    );
    return { id: existing[0].id, isNew: false };
  }

  // 插入新歌
  const [result] = await pool.query(
    `INSERT INTO songs
       (qishui_song_id, song_name, artist_name, cover_url, duration_sec,
        first_seen_likes, first_seen_comments, first_seen_shares)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      song.qishuiSongId,
      song.songName || '',
      song.artistName || '',
      song.coverUrl || null,
      song.durationSec || null,
      song.interactions?.likes ?? null,
      song.interactions?.comments ?? null,
      song.interactions?.shares ?? null
    ]
  );

  return { id: result.insertId, isNew: true };
}

/**
 * 检查歌曲是否在 24h 内已有活跃任务
 */
async function hasActiveTaskWithinHours(songId, hours = 24) {
  const [rows] = await pool.query(
    `SELECT id FROM tasks
     WHERE song_id = ?
       AND status = 'active'
       AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
     LIMIT 1`,
    [songId, hours]
  );
  return rows.length > 0;
}

/**
 * 记录互动数快照
 */
async function recordInteractionSnapshot({ songId, taskId, interactions, type, source }) {
  await pool.query(
    `INSERT INTO interaction_snapshots
       (song_id, task_id, likes, comments, shares, plays, snapshot_type, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      songId,
      taskId || null,
      interactions.likes ?? null,
      interactions.comments ?? null,
      interactions.shares ?? null,
      interactions.plays ?? null,
      type || 'task_create',
      source || 'scrape'
    ]
  );
}

module.exports = {
  upsertSong,
  hasActiveTaskWithinHours,
  recordInteractionSnapshot
};
