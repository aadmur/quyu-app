-- 哪钓专业化 v13 · 生产直跑版（幂等，可重复执行）。
-- drizzle 生成的 0012_v13_spot_expert.sql 含 `--> statement-breakpoint` 内部标记，MySQL 不识别
-- （`--` 后需空格才为注释），且 ALTER TABLE ADD COLUMN / CREATE INDEX 在 MySQL 8 没有 IF NOT EXISTS。
--
-- 为什么不用存储过程：`mysql < 本文件` 是客户端按 `;` 逐条切分的，BEGIN...END 体内的分号
-- 会把过程截断（除非额外写 DELIMITER，而 DELIMITER 只对 CLI 有效、其它驱动会报错）。
-- 因此这里全部用「IF EXISTS 查 information_schema → 拼出 SQL → PREPARE/EXECUTE」的**单行语句**形式，
-- 既不截断、又幂等，CLI 与脚本驱动都能整文件直跑。
-- 执行：mysql -uquyu -p<密码> quyu < 0012_v13_spot_expert_run.sql

CREATE TABLE IF NOT EXISTS `fish_spot_samples` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`call_id` int,
	`tier` varchar(8) NOT NULL DEFAULT 'basic',
	`image_path` varchar(255),
	`inputs` json,
	`features` json,
	`rule_ids` varchar(128),
	`report` json,
	`status` varchar(16) NOT NULL DEFAULT 'collected',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fish_spot_samples_id` PRIMARY KEY(`id`)
);
CREATE TABLE IF NOT EXISTS `fish_spot_sample_consents` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`scope` varchar(16) NOT NULL DEFAULT 'image',
	`granted_at` timestamp NOT NULL DEFAULT (now()),
	`revoked_at` timestamp,
	CONSTRAINT `fish_spot_sample_consents_id` PRIMARY KEY(`id`),
	CONSTRAINT `fish_spot_sample_consents_user_id_unique` UNIQUE(`user_id`)
);
CREATE TABLE IF NOT EXISTS `fish_spot_feedback` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`sample_id` int,
	`call_id` int,
	`rating` varchar(16) NOT NULL,
	`note` varchar(200),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fish_spot_feedback_id` PRIMARY KEY(`id`)
);

-- ── 台账档位列（历史行按 basic 回填：老 APK 语义即基础档） ──
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_spot_calls' AND COLUMN_NAME = 'tier'), 'SELECT ''skip: fish_spot_calls.tier 已存在''', 'ALTER TABLE `fish_spot_calls` ADD COLUMN `tier` varchar(8) NOT NULL DEFAULT ''basic'''));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_spot_calls' AND COLUMN_NAME = 'rule_hit'), 'SELECT ''skip: fish_spot_calls.rule_hit 已存在''', 'ALTER TABLE `fish_spot_calls` ADD COLUMN `rule_hit` boolean'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_spot_calls' AND COLUMN_NAME = 'rule_ids'), 'SELECT ''skip: fish_spot_calls.rule_ids 已存在''', 'ALTER TABLE `fish_spot_calls` ADD COLUMN `rule_ids` varchar(128)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_spot_calls' AND COLUMN_NAME = 'k3_steps'), 'SELECT ''skip: fish_spot_calls.k3_steps 已存在''', 'ALTER TABLE `fish_spot_calls` ADD COLUMN `k3_steps` int NOT NULL DEFAULT 1'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 余额表：专家档免费次数独立列（与基础档分列记账） ──
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_balance' AND COLUMN_NAME = 'expert_free_used'), 'SELECT ''skip: user_balance.expert_free_used 已存在''', 'ALTER TABLE `user_balance` ADD COLUMN `expert_free_used` int NOT NULL DEFAULT 0'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 索引（MySQL 无 CREATE INDEX IF NOT EXISTS，同样守卫） ──
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_spot_samples' AND INDEX_NAME = 'idx_spot_sample_user_created'), 'SELECT ''skip: idx_spot_sample_user_created''', 'CREATE INDEX `idx_spot_sample_user_created` ON `fish_spot_samples` (`user_id`,`created_at`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_spot_samples' AND INDEX_NAME = 'idx_spot_sample_status'), 'SELECT ''skip: idx_spot_sample_status''', 'CREATE INDEX `idx_spot_sample_status` ON `fish_spot_samples` (`status`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_spot_sample_consents' AND INDEX_NAME = 'idx_spot_consent_user'), 'SELECT ''skip: idx_spot_consent_user''', 'CREATE INDEX `idx_spot_consent_user` ON `fish_spot_sample_consents` (`user_id`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_spot_feedback' AND INDEX_NAME = 'idx_spot_feedback_user'), 'SELECT ''skip: idx_spot_feedback_user''', 'CREATE INDEX `idx_spot_feedback_user` ON `fish_spot_feedback` (`user_id`,`created_at`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_spot_feedback' AND INDEX_NAME = 'idx_spot_feedback_rating'), 'SELECT ''skip: idx_spot_feedback_rating''', 'CREATE INDEX `idx_spot_feedback_rating` ON `fish_spot_feedback` (`rating`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 结果核对：跑完应列出 5 行（4 个台账新列 + 1 个余额新列）
SELECT 'v13 迁移后新增列' AS step, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME = 'fish_spot_calls' AND COLUMN_NAME IN ('tier','rule_hit','rule_ids','k3_steps'))
     OR (TABLE_NAME = 'user_balance' AND COLUMN_NAME = 'expert_free_used'))
 ORDER BY TABLE_NAME, COLUMN_NAME;
