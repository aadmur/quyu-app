ALTER TABLE `reports` DROP INDEX `uq_report`;--> statement-breakpoint
ALTER TABLE `reports` ADD `comment_id` bigint unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reports` ADD CONSTRAINT `uq_report` UNIQUE(`reporter_id`,`post_id`,`comment_id`);