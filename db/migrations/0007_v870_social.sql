CREATE TABLE `follows` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`follower_id` bigint unsigned NOT NULL,
	`followee_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `follows_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_follow` UNIQUE(`follower_id`,`followee_id`)
);
--> statement-breakpoint
ALTER TABLE `comments` ADD `parent_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `posts` ADD `deleted_at` timestamp;--> statement-breakpoint
CREATE INDEX `idx_follow_followee` ON `follows` (`followee_id`);