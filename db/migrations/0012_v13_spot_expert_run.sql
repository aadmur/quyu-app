-- 哪钓专业化 v13 · 生产直跑版（幂等，可重复执行）。
-- drizzle 生成的 0012_v13_spot_expert.sql 含 `--> statement-breakpoint` 内部标记，
-- 且 ALTER TABLE ADD COLUMN 在 MySQL 8 不支持 IF NOT EXISTS，故此处用 information_schema
-- 守卫 + 临时存储过程，保证「重复执行不报错、缺列才加」。
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

DROP PROCEDURE IF EXISTS `qy_v13_migrate`;
CREATE PROCEDURE `qy_v13_migrate`()
BEGIN
  -- 台账档位列：历史行按 basic 回填（老 APK 语义即基础档）
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fish_spot_calls' AND COLUMN_NAME = 'tier') THEN
    ALTER TABLE `fish_spot_calls` ADD COLUMN `tier` varchar(8) NOT NULL DEFAULT 'basic';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fish_spot_calls' AND COLUMN_NAME = 'rule_hit') THEN
    ALTER TABLE `fish_spot_calls` ADD COLUMN `rule_hit` boolean;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fish_spot_calls' AND COLUMN_NAME = 'rule_ids') THEN
    ALTER TABLE `fish_spot_calls` ADD COLUMN `rule_ids` varchar(128);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fish_spot_calls' AND COLUMN_NAME = 'k3_steps') THEN
    ALTER TABLE `fish_spot_calls` ADD COLUMN `k3_steps` int NOT NULL DEFAULT 1;
  END IF;
  -- 余额表：专家档免费次数独立列
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user_balance' AND COLUMN_NAME = 'expert_free_used') THEN
    ALTER TABLE `user_balance` ADD COLUMN `expert_free_used` int NOT NULL DEFAULT 0;
  END IF;
END;
CALL `qy_v13_migrate`();
DROP PROCEDURE `qy_v13_migrate`;

-- 索引同样做存在性守卫（MySQL 无 CREATE INDEX IF NOT EXISTS）
DROP PROCEDURE IF EXISTS `qy_v13_indexes`;
CREATE PROCEDURE `qy_v13_indexes`()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fish_spot_samples' AND INDEX_NAME = 'idx_spot_sample_user_created') THEN
    CREATE INDEX `idx_spot_sample_user_created` ON `fish_spot_samples` (`user_id`,`created_at`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fish_spot_samples' AND INDEX_NAME = 'idx_spot_sample_status') THEN
    CREATE INDEX `idx_spot_sample_status` ON `fish_spot_samples` (`status`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fish_spot_sample_consents' AND INDEX_NAME = 'idx_spot_consent_user') THEN
    CREATE INDEX `idx_spot_consent_user` ON `fish_spot_sample_consents` (`user_id`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fish_spot_feedback' AND INDEX_NAME = 'idx_spot_feedback_user') THEN
    CREATE INDEX `idx_spot_feedback_user` ON `fish_spot_feedback` (`user_id`,`created_at`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fish_spot_feedback' AND INDEX_NAME = 'idx_spot_feedback_rating') THEN
    CREATE INDEX `idx_spot_feedback_rating` ON `fish_spot_feedback` (`rating`);
  END IF;
END;
CALL `qy_v13_indexes`();
DROP PROCEDURE `qy_v13_indexes`;
