ALTER TABLE `stores` ADD `cash_discount_min_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `cash_discount_percent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `discount_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `discount_percent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE `cash_discount_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`created_at` text NOT NULL,
	`previous_min_amount` integer NOT NULL,
	`previous_percent` integer NOT NULL,
	`next_min_amount` integer NOT NULL,
	`next_percent` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_cash_discount_audits_store` ON `cash_discount_audits` (`store_id`,`created_at`);
