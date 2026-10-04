CREATE TABLE `fish_spot_feedback` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`sample_id` int,
	`call_id` int,
	`rating` varchar(16) NOT NULL,
	`note` varchar(200),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fish_spot_feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fish_spot_sample_consents` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`scope` varchar(16) NOT NULL DEFAULT 'image',
	`granted_at` timestamp NOT NULL DEFAULT (now()),
	`revoked_at` timestamp,
	CONSTRAINT `fish_spot_sample_consents_id` PRIMARY KEY(`id`),
	CONSTRAINT `fish_spot_sample_consents_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `fish_spot_samples` (
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
--> statement-breakpoint
ALTER TABLE `fish_spot_calls` ADD `tier` varchar(8) DEFAULT 'basic' NOT NULL;--> statement-breakpoint
ALTER TABLE `fish_spot_calls` ADD `rule_hit` boolean;--> statement-breakpoint
ALTER TABLE `fish_spot_calls` ADD `rule_ids` varchar(128);--> statement-breakpoint
ALTER TABLE `fish_spot_calls` ADD `k3_steps` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_balance` ADD `expert_free_used` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_spot_feedback_user` ON `fish_spot_feedback` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_spot_feedback_rating` ON `fish_spot_feedback` (`rating`);--> statement-breakpoint
CREATE INDEX `idx_spot_consent_user` ON `fish_spot_sample_consents` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_spot_sample_user_created` ON `fish_spot_samples` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_spot_sample_status` ON `fish_spot_samples` (`status`);