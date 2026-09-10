CREATE TABLE `comments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`post_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned,
	`author_name` varchar(64) NOT NULL,
	`content` varchar(500) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fish_news` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`pond_id` bigint unsigned NOT NULL,
	`content` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fish_news_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `likes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`post_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `likes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_like` UNIQUE(`user_id`,`post_id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`pond_id` bigint unsigned NOT NULL,
	`ticket_type_id` bigint unsigned NOT NULL,
	`visit_date` varchar(10) NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`seat_nos` json NOT NULL,
	`total_amount` int NOT NULL,
	`verify_code` varchar(6) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`used_at` timestamp,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_verify_code_unique` UNIQUE(`verify_code`)
);
--> statement-breakpoint
CREATE TABLE `ponds` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`slug` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`region` varchar(128) NOT NULL,
	`distance_km` decimal(5,1) NOT NULL DEFAULT '0',
	`rating` decimal(2,1) NOT NULL DEFAULT '4.5',
	`review_count` int NOT NULL DEFAULT 0,
	`price_from` int NOT NULL DEFAULT 68,
	`cover` varchar(255) NOT NULL,
	`album` json NOT NULL,
	`tags` json NOT NULL,
	`fish_species` json NOT NULL,
	`intro` text,
	`open_hours` varchar(64) NOT NULL DEFAULT '06:00–22:00',
	`is_open` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ponds_id` PRIMARY KEY(`id`),
	CONSTRAINT `ponds_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`author_id` bigint unsigned,
	`author_name` varchar(64) NOT NULL,
	`author_avatar` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`images` json NOT NULL,
	`pond_id` bigint unsigned,
	`fish_species` varchar(32),
	`weight_jin` decimal(5,1),
	`like_count` int NOT NULL DEFAULT 0,
	`comment_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`category` varchar(32) NOT NULL,
	`price` int NOT NULL,
	`image` varchar(255) NOT NULL,
	`desc` varchar(255),
	`sales` int NOT NULL DEFAULT 0,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`pond_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`author_name` varchar(64) NOT NULL,
	`author_avatar` varchar(255) NOT NULL DEFAULT '/avatar-1.png',
	`rating` int NOT NULL,
	`content` varchar(500),
	`tags` json NOT NULL,
	`images` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `reviews_order_id_unique` UNIQUE(`order_id`)
);
--> statement-breakpoint
CREATE TABLE `seats` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`pond_id` bigint unsigned NOT NULL,
	`seat_no` int NOT NULL,
	`is_vip` boolean NOT NULL DEFAULT false,
	`is_sold` boolean NOT NULL DEFAULT false,
	CONSTRAINT `seats_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_seat` UNIQUE(`pond_id`,`seat_no`)
);
--> statement-breakpoint
CREATE TABLE `ticket_types` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`pond_id` bigint unsigned NOT NULL,
	`name` varchar(64) NOT NULL,
	`price` int NOT NULL,
	`duration_desc` varchar(64),
	`is_hot` boolean NOT NULL DEFAULT false,
	CONSTRAINT `ticket_types_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_events` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`post_id` bigint unsigned NOT NULL,
	`action` varchar(16) NOT NULL,
	`duration_ms` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` bigint unsigned NOT NULL,
	`fish_prefs` json NOT NULL,
	`pond_prefs` json NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_profiles_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`unionId` varchar(255) NOT NULL,
	`name` varchar(255),
	`email` varchar(320),
	`avatar` text,
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_unionId_unique` UNIQUE(`unionId`)
);
--> statement-breakpoint
CREATE INDEX `idx_comments_post` ON `comments` (`post_id`);
--> statement-breakpoint
CREATE INDEX `idx_news_pond` ON `fish_news` (`pond_id`);
--> statement-breakpoint
CREATE INDEX `idx_orders_user` ON `orders` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_orders_pond` ON `orders` (`pond_id`);
--> statement-breakpoint
CREATE INDEX `idx_posts_created` ON `posts` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_posts_pond` ON `posts` (`pond_id`);
--> statement-breakpoint
CREATE INDEX `idx_reviews_pond` ON `reviews` (`pond_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_pond` ON `ticket_types` (`pond_id`);
--> statement-breakpoint
CREATE INDEX `idx_events_user` ON `user_events` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_events_post` ON `user_events` (`post_id`);
