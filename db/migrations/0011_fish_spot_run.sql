-- 哪钓 · 生产直跑版（幂等）。drizzle 生成的 0011_fish_spot.sql 含内部标记
-- `--> statement-breakpoint`，MySQL 不识别（`--` 后需空格才为注释），故本文件
-- 去掉标记并加 IF NOT EXISTS，供 `mysql < 0011_fish_spot_run.sql` 直接执行。
CREATE TABLE IF NOT EXISTS `fish_spot_calls` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`status` varchar(16) NOT NULL,
	`billing` varchar(8) NOT NULL,
	`cost_cents` int NOT NULL DEFAULT 0,
	`score` int,
	`water_type` varchar(32),
	`prompt_tokens` int NOT NULL DEFAULT 0,
	`completion_tokens` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fish_spot_calls_id` PRIMARY KEY(`id`)
);
CREATE TABLE IF NOT EXISTS `recharge_orders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`amount_cents` int NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`provider` varchar(16) NOT NULL DEFAULT 'mock',
	`out_trade_no` varchar(64) NOT NULL,
	`paid_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recharge_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `recharge_orders_out_trade_no_unique` UNIQUE(`out_trade_no`)
);
CREATE TABLE IF NOT EXISTS `user_balance` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`balance_cents` int NOT NULL DEFAULT 0,
	`free_used` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_balance_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_balance_user_id_unique` UNIQUE(`user_id`)
);
-- v14 补守卫：原三行裸 CREATE INDEX 让本文件**不可重跑**（第二次报 Duplicate key name），
-- 与文件头声明的"幂等，可重复执行"矛盾。平时没人碰它所以没暴露，直到 v14 迁移验证脚本
-- 按"生产真实路径"重放 0011→0014 时才炸出来。恢复演练若依赖本文件会在第 38 行中断。
-- 现在统一改用与 0012/0013/0014 相同的 information_schema + PREPARE 惯用法。
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fish_spot_calls' AND INDEX_NAME = 'idx_fishspot_user_created'), 'SELECT ''skip: idx_fishspot_user_created''', 'CREATE INDEX `idx_fishspot_user_created` ON `fish_spot_calls` (`user_id`,`created_at`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recharge_orders' AND INDEX_NAME = 'idx_recharge_user'), 'SELECT ''skip: idx_recharge_user''', 'CREATE INDEX `idx_recharge_user` ON `recharge_orders` (`user_id`,`created_at`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_balance' AND INDEX_NAME = 'idx_user_balance_user'), 'SELECT ''skip: idx_user_balance_user''', 'CREATE INDEX `idx_user_balance_user` ON `user_balance` (`user_id`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
