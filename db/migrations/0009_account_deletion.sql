ALTER TABLE `users` ADD `deletion_requested_at` timestamp;--> statement-breakpoint
CREATE INDEX `idx_users_deletion` ON `users` (`deletion_requested_at`);