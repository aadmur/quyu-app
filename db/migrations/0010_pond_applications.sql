CREATE TABLE `pond_applications` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`pond_name` varchar(128) NOT NULL,
	`region` varchar(128) NOT NULL,
	`address` varchar(255) NOT NULL,
	`contact_phone` varchar(32) NOT NULL,
	`ticket_desc` varchar(255) NOT NULL,
	`photos` json NOT NULL,
	`note` varchar(500),
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`review_note` varchar(255),
	`reviewed_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`reviewed_at` timestamp,
	CONSTRAINT `pond_applications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_pond_apps_user_status` ON `pond_applications` (`user_id`,`status`);