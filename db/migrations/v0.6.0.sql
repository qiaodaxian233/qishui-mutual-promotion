-- v0.6.0 迁移:通知表 + 信用分日志表 + 用户角色 + 福利标记
-- 在 SSH 中执行,先替换 YOUR_DB 为实际数据库名

-- ========== 1. 用户角色(如果 v0.5.7 没跑过) ==========
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `role` ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER `status`;

-- ========== 2. 任务福利标记(如果 v0.5.7 没跑过) ==========
ALTER TABLE `tasks`
  ADD COLUMN IF NOT EXISTS `is_welfare` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`;

-- ========== 3. 站内通知表 ==========
CREATE TABLE IF NOT EXISTS `notifications` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `type`        VARCHAR(50)     NOT NULL DEFAULT 'system',
  `title`       VARCHAR(200)    NOT NULL,
  `content`     TEXT            DEFAULT NULL,
  `ref_type`    VARCHAR(50)     DEFAULT NULL COMMENT '关联类型(task/completion)',
  `ref_id`      BIGINT UNSIGNED DEFAULT NULL COMMENT '关联 ID',
  `is_read`     TINYINT(1)      NOT NULL DEFAULT 0,
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_read` (`user_id`, `is_read`, `created_at`),
  CONSTRAINT `fk_notify_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内通知';

-- ========== 4. 信用分日志表 ==========
CREATE TABLE IF NOT EXISTS `credit_log` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `delta`       INT             NOT NULL COMMENT '变动值(正加负扣)',
  `score_after` INT             NOT NULL COMMENT '变动后分数',
  `reason`      VARCHAR(200)    NOT NULL,
  `ref_type`    VARCHAR(50)     DEFAULT NULL,
  `ref_id`      BIGINT UNSIGNED DEFAULT NULL,
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`, `created_at`),
  CONSTRAINT `fk_credit_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='信用分变动日志';

-- ========== 5. 把你的账号设为管理员 ==========
-- UPDATE `users` SET `role` = 'admin' WHERE `email` = '你的邮箱';
