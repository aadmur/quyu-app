CREATE TABLE `product_orders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`items` json NOT NULL,
	`total_amount` int NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`idempotency_key` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_orders_idempotency_key_unique` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_porders_user` ON `product_orders` (`user_id`,`created_at`);
