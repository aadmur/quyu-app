CREATE TABLE `notifications` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`type` varchar(16) NOT NULL,
	`actor_name` varchar(64) NOT NULL,
	`ref_id` bigint unsigned NOT NULL,
	`preview` varchar(255) NOT NULL DEFAULT '',
	`is_read` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pond_marks` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`pond_id` bigint unsigned NOT NULL,
	`kind` varchar(8) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pond_marks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_pond_mark` UNIQUE(`user_id`,`pond_id`,`kind`)
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_read` ON `notifications` (`user_id`,`is_read`);--> statement-breakpoint
CREATE INDEX `idx_marks_user` ON `pond_marks` (`user_id`);