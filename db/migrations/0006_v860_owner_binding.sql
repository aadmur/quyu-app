CREATE TABLE `pond_admins` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`pond_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pond_admins_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_pond_admin` UNIQUE(`user_id`,`pond_id`)
);
--> statement-breakpoint
ALTER TABLE `ponds` ADD `claim_code` varchar(32);--> statement-breakpoint
ALTER TABLE `posts` ADD `location_text` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `bio` varchar(200);--> statement-breakpoint
CREATE INDEX `idx_pond_admin_pond` ON `pond_admins` (`pond_id`);