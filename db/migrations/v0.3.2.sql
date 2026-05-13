-- ============================================================
-- v0.3.1 → v0.3.2 升级脚本
-- 修复:IP 字段 VARCHAR(45) 装不下 SHA256(64 字符)
--
-- 用法:
--   mysql -u qishui -p qishui_mutual_promotion < db/migrations/v0.3.2.sql
-- ============================================================

USE `qishui_mutual_promotion`;

-- users 表:register_ip / last_login_ip
ALTER TABLE `users`
  MODIFY COLUMN `register_ip`   CHAR(64) DEFAULT NULL COMMENT 'SHA256 哈希后的注册 IP',
  MODIFY COLUMN `last_login_ip` CHAR(64) DEFAULT NULL COMMENT 'SHA256 哈希后的登录 IP';

-- email_verifications 表:ip 字段也统一改成 hash
ALTER TABLE `email_verifications`
  MODIFY COLUMN `ip` CHAR(64) DEFAULT NULL COMMENT 'SHA256 哈希后的请求 IP(防刷)';

SELECT 'v0.3.2 migration completed' AS status;
