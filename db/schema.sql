-- ============================================================
-- 汽水音乐独立音乐人互推平台 - 数据库表结构
-- Database: MySQL 8.0+
-- Charset:  utf8mb4 (支持 emoji 和生僻字)
-- Engine:   InnoDB (外键约束 + 事务)
-- ============================================================

CREATE DATABASE IF NOT EXISTS `qishui_mutual_promotion`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `qishui_mutual_promotion`;


-- ============================================================
-- 1. 用户表
-- ============================================================
CREATE TABLE `users` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`             VARCHAR(255)    NOT NULL                COMMENT '邮箱(唯一)',
  `password_hash`     VARCHAR(255)    NOT NULL                COMMENT 'bcrypt hash,绝不存明文',
  `nickname`          VARCHAR(50)     NOT NULL                COMMENT '昵称(展示用)',
  `avatar_url`        VARCHAR(500)    DEFAULT NULL            COMMENT '头像 URL',

  -- 邮箱认证
  `email_verified`    TINYINT(1)      NOT NULL DEFAULT 0      COMMENT '0=未认证 1=已认证',
  `email_verified_at` DATETIME        DEFAULT NULL,

  -- 积分(缓存字段,真实来源是 points_log)
  `points`            INT             NOT NULL DEFAULT 100    COMMENT '当前积分,初始 100',

  -- 信用分(缓存字段,真实来源是 credit_log)
  `credit_score`      INT             NOT NULL DEFAULT 600    COMMENT '信用分,初始 600(可发任务)',

  -- 账号状态
  `status`            ENUM('active','frozen','banned') NOT NULL DEFAULT 'active'
                                                              COMMENT '账号状态',
  `banned_reason`     VARCHAR(200)    DEFAULT NULL,
  `banned_at`         DATETIME        DEFAULT NULL,

  -- 反作弊
  `register_ip`       VARCHAR(45)     DEFAULT NULL            COMMENT '注册 IP(支持 IPv6)',
  `register_ua`       VARCHAR(500)    DEFAULT NULL            COMMENT '注册 User-Agent',
  `last_login_at`     DATETIME        DEFAULT NULL,
  `last_login_ip`     VARCHAR(45)     DEFAULT NULL,

  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_email` (`email`),
  KEY `idx_credit_score` (`credit_score`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';


-- ============================================================
-- 2. 临时邮箱黑名单
-- 数据来源:https://github.com/disposable-email-domains/disposable-email-domains
-- 每月用脚本同步一次
-- ============================================================
CREATE TABLE `disposable_domains` (
  `domain`     VARCHAR(255) NOT NULL                COMMENT '小写域名',
  `source`     VARCHAR(100) DEFAULT 'github'        COMMENT '来源标记',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='临时邮箱域名黑名单';


-- ============================================================
-- 3. 邮箱验证码
-- 注册、改密码、改绑邮箱都用这张表
-- ============================================================
CREATE TABLE `email_verifications` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`      VARCHAR(255)    NOT NULL,
  `code`       VARCHAR(10)     NOT NULL              COMMENT '6 位数字验证码',
  `purpose`    ENUM('register','reset_password','change_email') NOT NULL,
  `expires_at` DATETIME        NOT NULL              COMMENT '30 分钟后过期',
  `used_at`    DATETIME        DEFAULT NULL          COMMENT '使用时间(null=未使用)',
  `ip`         VARCHAR(45)     DEFAULT NULL          COMMENT '请求 IP(防刷)',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_email_code` (`email`, `code`),
  KEY `idx_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邮箱验证码';


-- ============================================================
-- 4. 歌曲表(独立于任务,实现平台级去重)
-- 同一首歌不同发布者分享生成的短码可能不同,
-- 但底层 song_id 是字节内部唯一,以此为准
-- ============================================================
CREATE TABLE `songs` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `qishui_song_id`  VARCHAR(64)     NOT NULL              COMMENT '汽水内部歌曲 ID(从分享页 HTML 解析)',
  `song_name`       VARCHAR(200)    NOT NULL,
  `artist_name`     VARCHAR(200)    NOT NULL,
  `cover_url`       VARCHAR(500)    DEFAULT NULL,
  `duration_sec`    INT             DEFAULT NULL          COMMENT '歌曲总时长(秒)',

  -- 首次被添加时的状态快照(用于差值校验的初始值)
  `first_seen_likes`    INT DEFAULT NULL,
  `first_seen_comments` INT DEFAULT NULL,
  `first_seen_shares`   INT DEFAULT NULL,

  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_qishui_song_id` (`qishui_song_id`),
  KEY `idx_song_name` (`song_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='歌曲元数据(平台级)';


-- ============================================================
-- 5. 任务表
-- ============================================================
CREATE TABLE `tasks` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `publisher_id`    BIGINT UNSIGNED NOT NULL              COMMENT '发布者 user_id',
  `song_id`         BIGINT UNSIGNED NOT NULL              COMMENT '关联 songs.id',

  -- 分享链接相关
  `share_link`      VARCHAR(500)    NOT NULL              COMMENT '完整分享链接',
  `share_code`      VARCHAR(20)     NOT NULL              COMMENT '8 位短码,如 iQeg2PpD',
  `share_text_raw`  TEXT            DEFAULT NULL          COMMENT '原始分享文案(留存佐证)',

  -- 任务类型 & 配置
  `task_type`       ENUM('like','listen','comment','share') NOT NULL,
  `min_listen_sec`  INT             DEFAULT NULL          COMMENT 'listen 任务最短播放秒数',
  `comment_rule`    JSON            DEFAULT NULL          COMMENT 'comment 任务文案规则(关键词/字数等)',

  -- 经济
  `reward_points`   INT             NOT NULL              COMMENT '单个接单者获得积分(已扣平台抽成)',
  `platform_fee`    INT             NOT NULL DEFAULT 0    COMMENT '平台抽成总额',
  `total_cost`      INT             NOT NULL              COMMENT '发布者总消耗 = reward × quota + fee',
  `quota_total`     INT             NOT NULL              COMMENT '总名额',
  `quota_remaining` INT             NOT NULL              COMMENT '剩余名额',

  -- 时间
  `expires_at`      DATETIME        NOT NULL              COMMENT '任务过期时间',

  -- 状态
  `status`          ENUM('active','paused','completed','expired','cancelled','link_invalid')
                    NOT NULL DEFAULT 'active',

  -- 反作弊回查
  `last_link_check_at`   DATETIME DEFAULT NULL            COMMENT '上次链接有效性检查时间',
  `link_check_failed`    TINYINT(1) NOT NULL DEFAULT 0    COMMENT '链接是否失效',

  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_publisher_status` (`publisher_id`, `status`),
  KEY `idx_song_status` (`song_id`, `status`),
  KEY `idx_status_expires` (`status`, `expires_at`),
  KEY `idx_share_code` (`share_code`),

  CONSTRAINT `fk_tasks_publisher` FOREIGN KEY (`publisher_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_tasks_song`      FOREIGN KEY (`song_id`)      REFERENCES `songs` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务发布表';


-- ============================================================
-- 6. 任务完成记录(接单)
-- ⚠️ 反作弊核心:同 task + 同 IP + 同设备 唯一约束
-- ============================================================
CREATE TABLE `task_completions` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id`        BIGINT UNSIGNED NOT NULL,
  `user_id`        BIGINT UNSIGNED NOT NULL              COMMENT '接单者',

  -- 反作弊三件套
  `ip_hash`        CHAR(64)        NOT NULL              COMMENT 'SHA256(IP),不存原始 IP 更合规',
  `device_fp`      VARCHAR(128)    NOT NULL              COMMENT 'FingerprintJS 设备指纹',
  `user_agent`     VARCHAR(500)    DEFAULT NULL,

  -- 状态机
  `status`         ENUM('claimed','submitted','auto_passed','auto_rejected','manual_pending','manual_passed','manual_rejected','recheck_failed','disputed')
                   NOT NULL DEFAULT 'claimed'
                                                          COMMENT 'claimed=领取 submitted=提交凭证 auto_*=自动审 manual_*=人工审 recheck_failed=回查不过',

  -- 积分发放
  `points_awarded` INT             DEFAULT NULL          COMMENT '实际发放积分(可能小于任务标定)',
  `awarded_at`     DATETIME        DEFAULT NULL,

  -- 回查相关
  `recheck_at`     DATETIME        DEFAULT NULL          COMMENT '24h 或 48h 后回查时间',
  `recheck_done`   TINYINT(1)      NOT NULL DEFAULT 0,

  `claimed_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `submitted_at`   DATETIME        DEFAULT NULL,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),

  -- 核心反作弊唯一约束:
  -- 同一任务,同一 IP + 设备 只能完成一次
  UNIQUE KEY `uk_task_ip_device` (`task_id`, `ip_hash`, `device_fp`),

  -- 同一用户不能接同一任务两次
  UNIQUE KEY `uk_task_user` (`task_id`, `user_id`),

  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_recheck` (`recheck_done`, `recheck_at`),
  KEY `idx_status_claimed` (`status`, `claimed_at`),

  CONSTRAINT `fk_completions_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`),
  CONSTRAINT `fk_completions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务完成记录';


-- ============================================================
-- 7. 凭证截图
-- 图片本体在 OSS / 本地文件系统,7 天后删
-- 数据库永久保留 OCR 结果 + SHA256(查重)
-- ============================================================
CREATE TABLE `task_proofs` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `completion_id`   BIGINT UNSIGNED NOT NULL,

  -- 文件信息
  `file_path`       VARCHAR(500)    DEFAULT NULL          COMMENT '存储路径(7 天后清空)',
  `file_sha256`     CHAR(64)        NOT NULL              COMMENT '文件 SHA256(查重,永久保留)',
  `file_phash`      VARCHAR(64)     DEFAULT NULL          COMMENT '感知哈希(查相似图)',
  `file_size_kb`    INT             DEFAULT NULL,
  `mime_type`       VARCHAR(50)     DEFAULT NULL,

  -- OCR 结果(JSON,字段灵活,UI 改版好适配)
  `ocr_raw`         JSON            DEFAULT NULL          COMMENT 'OCR 原始返回',
  `ocr_extracted`   JSON            DEFAULT NULL          COMMENT '结构化提取结果',
  --   示例:
  --   {
  --     "song_name": "Summer Haze",
  --     "artist": "渡微",
  --     "likes": 48,
  --     "comments": 26,
  --     "progress": "0:45/3:42",
  --     "progress_sec": 45,
  --     "status_bar_time": "16:35",
  --     "is_liked": true
  --   }

  -- 验证结果
  `verify_result`   ENUM('pass','fail','manual_needed') DEFAULT NULL,
  `verify_reason`   VARCHAR(500)    DEFAULT NULL          COMMENT '失败原因/人工标记',

  -- 生命周期
  `file_deleted`    TINYINT(1)      NOT NULL DEFAULT 0    COMMENT '7 天后置 1,file_path 清空',
  `archived_at`     DATETIME        DEFAULT NULL          COMMENT '归档时间',

  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_completion` (`completion_id`),
  KEY `idx_sha256` (`file_sha256`),
  KEY `idx_phash` (`file_phash`),
  KEY `idx_file_deleted_created` (`file_deleted`, `created_at`),

  CONSTRAINT `fk_proofs_completion` FOREIGN KEY (`completion_id`) REFERENCES `task_completions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务凭证(截图)';


-- ============================================================
-- 8. 互动数快照
-- 任务发布时记一份(初始),回查时再记一份,做差值校验
-- ============================================================
CREATE TABLE `interaction_snapshots` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `song_id`         BIGINT UNSIGNED NOT NULL,
  `task_id`         BIGINT UNSIGNED DEFAULT NULL          COMMENT '关联任务(可为空,song 级快照)',

  `likes`           INT             DEFAULT NULL,
  `comments`        INT             DEFAULT NULL,
  `shares`          INT             DEFAULT NULL,
  `plays`           INT             DEFAULT NULL          COMMENT '播放数(如果能抓到)',

  `snapshot_type`   ENUM('task_create','task_complete','recheck','periodic') NOT NULL,
  `source`          ENUM('scrape','api','manual') NOT NULL DEFAULT 'scrape',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_song_created` (`song_id`, `created_at`),
  KEY `idx_task_type` (`task_id`, `snapshot_type`),

  CONSTRAINT `fk_snapshots_song` FOREIGN KEY (`song_id`) REFERENCES `songs` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='歌曲互动数快照';


-- ============================================================
-- 9. 积分流水(审计 + 真实余额来源)
-- users.points 是缓存,可以从这张表 SUM 算出来
-- ============================================================
CREATE TABLE `points_log` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT UNSIGNED NOT NULL,

  `delta`           INT             NOT NULL              COMMENT '变动量(正=加,负=减)',
  `balance_after`   INT             NOT NULL              COMMENT '变动后余额(冗余,便于审计)',

  `type`            ENUM(
                      'register_bonus',     -- 注册赠送 +100
                      'task_publish',       -- 发布任务 -X
                      'task_complete',      -- 完成任务 +X
                      'task_refund',        -- 任务退款 +X(发布者撤销/链接失效)
                      'pin_bid',            -- 置顶竞价 -X
                      'pin_refund',         -- 被顶下来退款 +X
                      'penalty',            -- 违规扣分 -X
                      'expire',             -- 积分过期销毁 -X
                      'admin_adjust',       -- 管理员手动调整
                      'reward'              -- 活动奖励 +X
                    ) NOT NULL,

  `ref_type`        VARCHAR(50)     DEFAULT NULL          COMMENT '关联对象类型(task / pinned_slot / completion)',
  `ref_id`          BIGINT UNSIGNED DEFAULT NULL          COMMENT '关联对象 ID',
  `note`            VARCHAR(500)    DEFAULT NULL          COMMENT '备注(管理员可见)',

  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`, `created_at`),
  KEY `idx_type_created` (`type`, `created_at`),
  KEY `idx_ref` (`ref_type`, `ref_id`),

  CONSTRAINT `fk_points_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分流水';


-- ============================================================
-- 10. 信用分流水
-- ============================================================
CREATE TABLE `credit_log` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT UNSIGNED NOT NULL,

  `delta`           INT             NOT NULL,
  `score_after`     INT             NOT NULL,

  `reason`          ENUM(
                      'task_complete_on_time',  -- 按时完成 +1
                      'task_timeout',           -- 超时未完成 -3
                      'continuous_active',      -- 连续 7 天 +5
                      'appeal_lost',            -- 申诉败诉 -10
                      'cheat_confirmed',        -- 作弊核实 -50
                      'manual_adjust'           -- 人工调整
                    ) NOT NULL,
  `ref_type`        VARCHAR(50)     DEFAULT NULL,
  `ref_id`          BIGINT UNSIGNED DEFAULT NULL,
  `note`            VARCHAR(500)    DEFAULT NULL,

  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`, `created_at`),
  KEY `idx_reason` (`reason`),

  CONSTRAINT `fk_credit_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='信用分流水';


-- ============================================================
-- 11. 置顶位竞价
-- 3 个位 + 24h + 出价高者顶下出价低者(被顶退积分)
-- ============================================================
CREATE TABLE `pinned_slots` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slot_position`   TINYINT         NOT NULL              COMMENT '1 / 2 / 3 号位',
  `task_id`         BIGINT UNSIGNED NOT NULL,
  `user_id`         BIGINT UNSIGNED NOT NULL              COMMENT '出价者(=任务发布者)',
  `bid_points`      INT             NOT NULL,

  `status`          ENUM('active','outbid','expired','cancelled') NOT NULL DEFAULT 'active',
  `expires_at`      DATETIME        NOT NULL              COMMENT '24h 后过期',
  `outbid_at`       DATETIME        DEFAULT NULL          COMMENT '被顶下来的时间',

  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_status_expires` (`status`, `expires_at`),
  KEY `idx_position_status` (`slot_position`, `status`),

  CONSTRAINT `fk_pinned_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`),
  CONSTRAINT `fk_pinned_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='置顶位竞价记录';


-- ============================================================
-- 12. IP + 设备指纹记录
-- 用于反作弊的双因子分析
-- ============================================================
CREATE TABLE `ip_device_records` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `ip_hash`         CHAR(64)        NOT NULL,
  `device_fp`       VARCHAR(128)    NOT NULL,

  `action_type`     ENUM('register','login','complete_task','publish_task') NOT NULL,
  `user_agent`      VARCHAR(500)    DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_user_action` (`user_id`, `action_type`),
  KEY `idx_ip_device` (`ip_hash`, `device_fp`),
  KEY `idx_device` (`device_fp`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='IP + 设备指纹记录';


-- ============================================================
-- 13. 举报
-- 社区自治的兜底:被举报 3+ 次自动进人工审核
-- ============================================================
CREATE TABLE `reports` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reporter_id`     BIGINT UNSIGNED NOT NULL,
  `target_type`     ENUM('user','task','completion','comment') NOT NULL,
  `target_id`       BIGINT UNSIGNED NOT NULL,
  `reason`          VARCHAR(100)    NOT NULL              COMMENT '举报理由分类',
  `detail`          TEXT            DEFAULT NULL,

  `status`          ENUM('pending','reviewing','upheld','dismissed') NOT NULL DEFAULT 'pending',
  `admin_note`      VARCHAR(500)    DEFAULT NULL,
  `handled_by`      BIGINT UNSIGNED DEFAULT NULL,
  `handled_at`      DATETIME        DEFAULT NULL,

  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_target` (`target_type`, `target_id`),
  KEY `idx_reporter` (`reporter_id`),
  KEY `idx_status` (`status`),

  CONSTRAINT `fk_reports_reporter` FOREIGN KEY (`reporter_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='举报记录';


-- ============================================================
-- 初始化数据(可选)
-- ============================================================

-- 临时邮箱黑名单种子数据(用户提到的 + 几个常见的)
-- 实际部署时用脚本从 disposable-email-domains 仓库全量导入(6000+)
INSERT IGNORE INTO `disposable_domains` (`domain`, `source`) VALUES
  ('2925.com',           'manual'),
  ('24mail.top',         'manual'),
  ('mailinator.com',     'manual'),
  ('10minutemail.com',   'manual'),
  ('guerrillamail.com',  'manual'),
  ('tempmail.io',        'manual'),
  ('throwawaymail.com',  'manual'),
  ('yopmail.com',        'manual'),
  ('getnada.com',        'manual'),
  ('sharklasers.com',    'manual'),
  ('mailnesia.com',      'manual'),
  ('inboxbear.com',      'manual');


-- ============================================================
-- 结束
-- ============================================================
