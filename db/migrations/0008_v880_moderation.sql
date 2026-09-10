CREATE TABLE `reports` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`reporter_id` bigint unsigned NOT NULL,
	`post_id` bigint unsigned NOT NULL,
	`reason` varchar(255) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`handled_by` bigint unsigned,
	`handled_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_report` UNIQUE(`reporter_id`,`post_id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `cover` varchar(255);--> statement-breakpoint
CREATE INDEX `idx_reports_status` ON `reports` (`status`);