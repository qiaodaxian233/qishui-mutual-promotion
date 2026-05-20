-- ==========================================================
-- 一次性重置：所有非管理员账号积分 → 100
-- 写入 points_log 流水（type=admin_adjust），保留审计轨迹
--
-- 使用方法：
--   mysql -u root -p <数据库名> < scripts/reset-points-to-100.sql
--
-- 安全机制：
--   - 跳过 role='admin'
--   - 跳过已经是 100 分的用户（避免无意义流水）
--   - 全过程事务，出错自动回滚
-- ==========================================================

START TRANSACTION;

-- 1. 先预览影响范围
SELECT
  COUNT(*)                              AS affected_users,
  SUM(CASE WHEN points > 100 THEN points - 100 ELSE 0 END) AS total_to_deduct,
  SUM(CASE WHEN points < 100 THEN 100 - points ELSE 0 END) AS total_to_grant,
  MIN(points) AS min_points,
  MAX(points) AS max_points,
  AVG(points) AS avg_points
FROM users
WHERE role != 'admin' AND points != 100;

-- 2. 写流水（每个用户一条 admin_adjust 记录）
INSERT INTO points_log (user_id, delta, balance_after, type, note)
SELECT
  id,
  100 - points                          AS delta,
  100                                   AS balance_after,
  'admin_adjust',
  CONCAT('经济系统重置：', points, ' → 100')
FROM users
WHERE role != 'admin' AND points != 100;

-- 3. 同步 users.points 缓存
UPDATE users
SET points = 100
WHERE role != 'admin' AND points != 100;

-- 4. 验证：所有非管理员都应该是 100 了
SELECT
  COUNT(*)                                                          AS total_non_admin,
  SUM(CASE WHEN points = 100 THEN 1 ELSE 0 END)                     AS reset_to_100,
  SUM(CASE WHEN points != 100 THEN 1 ELSE 0 END)                    AS NOT_reset
FROM users
WHERE role != 'admin';

COMMIT;
