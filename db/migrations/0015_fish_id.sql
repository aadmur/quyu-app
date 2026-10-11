CREATE TABLE `fish_id_calls` (
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
--> statement-breakpoint
CREATE TABLE `fish_id_samples` (
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
--> statement-breakpoint
ALTER TABLE `user_balance` ADD `fish_id_free_used` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_fishid_user_created` ON `fish_id_calls` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_fishid_sample_user_created` ON `fish_id_samples` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_fishid_sample_status` ON `fish_id_samples` (`status`);