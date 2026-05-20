-- v0.7.2 迁移:credit_log.reason 字段统一
--
-- 背景:
--   schema.sql 主表里 reason 是 ENUM(6 个英文值),
--   但 migration v0.6.0.sql 建表用的是 VARCHAR(200),
--   实际代码 src/services/credit.js 传的是中文自由文本('接单超时未提交' 等)。
--   导致用 schema.sql 建表的服务器报 "Data truncated for column 'reason'"。
--
-- 修复:统一改成 VARCHAR(500)
-- 影响:旧表如果有 ENUM 列,这个 ALTER 会无损转换成 VARCHAR(原 ENUM 值作为字符串保留)

ALTER TABLE `credit_log` MODIFY COLUMN `reason` VARCHAR(500) NOT NULL;

-- 索引重建(VARCHAR(500) 完整索引会超 utf8mb4 索引长度限制,改前缀索引)
-- 如果之前没建索引,DROP 会报错可忽略
ALTER TABLE `credit_log` DROP INDEX `idx_reason`;
ALTER TABLE `credit_log` ADD INDEX `idx_reason` (`reason`(64));
