CREATE TABLE `stock_counts` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`count_date` text NOT NULL,
	`recorded_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_stock_counts_store_date` ON `stock_counts` (`store_id`,`count_date`);
--> statement-breakpoint
CREATE TABLE `stock_count_items` (
	`id` text PRIMARY KEY NOT NULL,
	`stock_count_id` text NOT NULL,
	`product_id` integer NOT NULL,
	`product_name` text NOT NULL,
	`quantity_kg` integer,
	`quantity_units` integer,
	`notes` text,
	FOREIGN KEY (`stock_count_id`) REFERENCES `stock_counts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_stock_count_items_count` ON `stock_count_items` (`stock_count_id`);
