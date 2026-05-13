-- v0.5.7 迁移:管理员角色 + 福利任务标记
-- 在宝塔 phpMyAdmin 中执行(先选对数据库)

-- 1. 给 users 表加 role 字段
ALTER TABLE `users`
  ADD COLUMN `role` ENUM('user','admin') NOT NULL DEFAULT 'user' COMMENT '角色'
  AFTER `status`;

-- 2. 给 tasks 表加 is_welfare 字段
ALTER TABLE `tasks`
  ADD COLUMN `is_welfare` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否福利任务(系统发布,不扣积分)'
  AFTER `status`;

-- 3. 把你自己的账号设为管理员(把 YOUR_EMAIL 替换成你的注册邮箱)
-- UPDATE `users` SET `role` = 'admin' WHERE `email` = 'YOUR_EMAIL';
