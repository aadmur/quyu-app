CREATE TABLE `outbox_events` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`event_id` varchar(64) NOT NULL,
	`topic` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`processed_at` timestamp,
	CONSTRAINT `outbox_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `owner_stats_daily` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`pond_id` bigint unsigned NOT NULL,
	`day` varchar(10) NOT NULL,
	`orders` int NOT NULL DEFAULT 0,
	`gmv` int NOT NULL DEFAULT 0,
	`used_cnt` int NOT NULL DEFAULT 0,
	`refreshed_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `owner_stats_daily_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stats` UNIQUE(`pond_id`,`day`)
);
--> statement-breakpoint
CREATE TABLE `processed_events` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`event_id` varchar(64) NOT NULL,
	`topic` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `processed_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `processed_events_event_id_unique` UNIQUE(`event_id`)
);
--> statement-breakpoint
DROP INDEX `idx_comments_post` ON `comments`;
--> statement-breakpoint
DROP INDEX `idx_news_pond` ON `fish_news`;
--> statement-breakpoint
DROP INDEX `idx_orders_user` ON `orders`;
--> statement-breakpoint
DROP INDEX `idx_reviews_pond` ON `reviews`;
--> statement-breakpoint
DROP INDEX `idx_events_post` ON `user_events`;
--> statement-breakpoint
ALTER TABLE `orders` ADD `idempotency_key` varchar(64);
--> statement-breakpoint
ALTER TABLE `posts` ADD `pond_slug` varchar(64);
--> statement-breakpoint
ALTER TABLE `posts` ADD `impression_count` int DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_idempotency_key_unique` UNIQUE(`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_outbox_status` ON `outbox_events` (`status`,`id`);
--> statement-breakpoint
CREATE INDEX `idx_comments_post_created` ON `comments` (`post_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_news_pond_created` ON `fish_news` (`pond_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_likes_post` ON `likes` (`post_id`);
--> statement-breakpoint
CREATE INDEX `idx_orders_user_created` ON `orders` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_orders_status_pond` ON `orders` (`status`,`pond_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_ponds_region_rating` ON `ponds` (`region`,`rating`);
--> statement-breakpoint
CREATE INDEX `idx_products_category` ON `products` (`category`,`sales`);
--> statement-breakpoint
CREATE INDEX `idx_reviews_pond_created` ON `reviews` (`pond_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_seats_pond_sold` ON `seats` (`pond_id`,`is_sold`);
--> statement-breakpoint
CREATE INDEX `idx_events_post_action` ON `user_events` (`post_id`,`action`);
--> statement-breakpoint
CREATE INDEX `idx_events_created` ON `user_events` (`created_at`);
