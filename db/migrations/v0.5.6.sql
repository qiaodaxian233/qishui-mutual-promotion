-- v0.5.6 迁移:截图凭证表 + 接单超时状态
-- 执行方式:在宝塔 phpMyAdmin 或命令行中运行

-- 1. 凭证截图表(如果不存在)
CREATE TABLE IF NOT EXISTS `task_proofs` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `completion_id`   BIGINT UNSIGNED NOT NULL,

  `file_path`       VARCHAR(500)    DEFAULT NULL          COMMENT '存储路径(7天后清空)',
  `file_sha256`     CHAR(64)        NOT NULL              COMMENT '文件SHA256(查重)',
  `file_phash`      VARCHAR(64)     DEFAULT NULL          COMMENT '感知哈希(查相似图)',
  `file_size_kb`    INT             DEFAULT NULL,
  `mime_type`       VARCHAR(50)     DEFAULT NULL,

  `ocr_raw`         JSON            DEFAULT NULL          COMMENT 'OCR原始返回',
  `ocr_extracted`   JSON            DEFAULT NULL          COMMENT '结构化提取结果',

  `verify_result`   ENUM('pass','fail','manual_needed') DEFAULT NULL,
  `verify_reason`   VARCHAR(500)    DEFAULT NULL,

  `file_deleted`    TINYINT(1)      NOT NULL DEFAULT 0,
  `archived_at`     DATETIME        DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_completion` (`completion_id`),
  KEY `idx_sha256` (`file_sha256`),
  KEY `idx_phash` (`file_phash`),
  KEY `idx_file_deleted_created` (`file_deleted`, `created_at`),

  CONSTRAINT `fk_proofs_completion` FOREIGN KEY (`completion_id`) REFERENCES `task_completions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务凭证(截图)';

-- 2. 给 task_completions.status 加 timeout 枚举值
ALTER TABLE `task_completions`
  MODIFY COLUMN `status`
    ENUM('claimed','submitted','auto_passed','auto_rejected','manual_pending','manual_passed','manual_rejected','recheck_failed','disputed','timeout')
    NOT NULL DEFAULT 'claimed';
