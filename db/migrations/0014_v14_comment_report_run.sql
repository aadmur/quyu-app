-- 评论级举报 v14 · 生产直跑版（幂等，可重复执行）。
-- drizzle 生成的 0014_v14_comment_report.sql 含 `--> statement-breakpoint`，MySQL 不识别，
-- 且 ADD COLUMN 没有 IF NOT EXISTS。详见 0012/0013 直跑版注释里的 PREPARE 惯用法。
-- 执行：mysql -uquyu -p<密码> quyu < 0014_v14_comment_report_run.sql
--
-- 顺序是刻意的：**先加列（默认 0）再重建唯一索引**。
-- 存量行的 comment_id 全部落 0 = 整帖举报，(reporter_id, post_id) 原本就唯一，
-- 加上 comment_id=0 后新索引必然可建，不会有 duplicate key 中断。
-- 若中途失败重跑本文件即可恢复到完成态。

-- ── 1. 加列 ──
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'comment_id'), 'SELECT ''skip: reports.comment_id 已存在''', 'ALTER TABLE `reports` ADD COLUMN `comment_id` bigint unsigned NOT NULL DEFAULT 0'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 兜底：万一列是后来补的且历史行填了 NULL，统一归到 0（整帖举报）
UPDATE `reports` SET `comment_id` = 0 WHERE `comment_id` IS NULL;

-- ── 2. 删旧唯一索引（reporter_id, post_id） ──
-- 新索引是它的超集语义（comment_id=0 时等价），必须先删旧的否则同名冲突。
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'uq_report' AND COLUMN_NAME = 'comment_id'), 'SELECT ''skip: uq_report 已含 comment_id''', 'ALTER TABLE `reports` DROP INDEX `uq_report`'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 3. 建新唯一索引（reporter_id, post_id, comment_id） ──
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'uq_report' AND COLUMN_NAME = 'comment_id'), 'SELECT ''skip: uq_report(3列) 已存在''', 'ALTER TABLE `reports` ADD CONSTRAINT `uq_report` UNIQUE(`reporter_id`,`post_id`,`comment_id`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
