ALTER TABLE `expenses` ADD `provider` text;
--> statement-breakpoint
CREATE TABLE `provider_debt_events` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`provider` text NOT NULL,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`expense_id` text,
	`shift_id` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_provider_debt_store_provider` ON `provider_debt_events` (`store_id`, `provider`);
