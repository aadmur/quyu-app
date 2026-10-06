CREATE TABLE `comment_likes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`comment_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `comment_likes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_comment_like` UNIQUE(`user_id`,`comment_id`)
);
--> statement-breakpoint
CREATE TABLE `post_favorites` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`post_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `post_favorites_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_post_favorite` UNIQUE(`user_id`,`post_id`)
);
--> statement-breakpoint
ALTER TABLE `comments` ADD `author_avatar` varchar(255) DEFAULT '/avatar-1.png' NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `images` json NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `like_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `deleted_at` timestamp;--> statement-breakpoint
CREATE INDEX `idx_comment_like_comment` ON `comment_likes` (`comment_id`);--> statement-breakpoint
CREATE INDEX `idx_favorite_user_created` ON `post_favorites` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_comments_post_like` ON `comments` (`post_id`,`like_count`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_comments_parent` ON `comments` (`parent_id`,`created_at`);