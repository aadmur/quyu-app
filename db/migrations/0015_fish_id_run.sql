-- 识鱼 v15 · 生产直跑版（幂等，可重复执行）。
-- 沿用 0012 的幂等模式：IF EXISTS 查 information_schema → 拼出 SQL → PREPARE/EXECUTE。
-- 执行：mysql -uquyu -p<密码> quyu < 0015_fish_id_run.sql

-- ── 余额表：识鱼免费次数独立列（与钓点各档分列记账，互不挪用） ──
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_balance' AND COLUMN_NAME = 'fish_id_free_used'), 'SELECT ''skip: user_balance.fish_id_free_used 已存在''', 'ALTER TABLE `user_balance` ADD COLUMN `fish_id_free_used` int NOT NULL DEFAULT 0'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 识鱼台账（仅存元数据，不存图片/正文，合规最小化） ──
CREATE TABLE IF NOT EXISTS `fish_id_calls` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`status` varchar(16) NOT NULL,
	`billing` varchar(8) NOT NULL,
	`cost_cents` int NOT NULL DEFAULT 0,
	`top_fish_name` varchar(32),
	`top_confidence` double,
	`prompt_tokens` int NOT NULL DEFAULT 0,
	`completion_tokens` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fish_id_calls_id` PRIMARY KEY(`id`)
);

-- ── 索引（MySQL 无 CREATE INDEX IF NOT EXISTS，同样守卫） ──
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_id_calls' AND INDEX_NAME = 'idx_fishid_user_created'), 'SELECT ''skip: idx_fishid_user_created''', 'CREATE INDEX `idx_fishid_user_created` ON `fish_id_calls` (`user_id`,`created_at`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 识鱼样本表（QY-FISH-006，仅授权用户写入；默认不存图） ──
CREATE TABLE IF NOT EXISTS `fish_id_samples` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`call_id` int,
	`image_path` varchar(255),
	`result` json,
	`top_fish_name` varchar(32),
	`corrected_fish` varchar(32),
	`status` varchar(16) NOT NULL DEFAULT 'collected',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fish_id_samples_id` PRIMARY KEY(`id`)
);

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_id_samples' AND INDEX_NAME = 'idx_fishid_sample_user_created'), 'SELECT ''skip: idx_fishid_sample_user_created''', 'CREATE INDEX `idx_fishid_sample_user_created` ON `fish_id_samples` (`user_id`,`created_at`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_id_samples' AND INDEX_NAME = 'idx_fishid_sample_status'), 'SELECT ''skip: idx_fishid_sample_status''', 'CREATE INDEX `idx_fishid_sample_status` ON `fish_id_samples` (`status`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 结果核对：跑完应列出 2 行（1 个余额新列 + 1 个新表）
SELECT 'v15 迁移后新增' AS step, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME = 'user_balance' AND COLUMN_NAME = 'fish_id_free_used'
 UNION ALL
SELECT 'v15 新表', TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME = 'fish_id_calls'
 ORDER BY 1, 2, 3;
