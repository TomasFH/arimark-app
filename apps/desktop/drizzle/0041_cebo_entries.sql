CREATE TABLE `cebo_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`quantity_kg` real NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text,
	`updated_at` text,
	`synced_at` text
);--> statement-breakpoint
CREATE INDEX `idx_cebo_shift` ON `cebo_entries` (`shift_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cebo_store_created` ON `cebo_entries` (`store_id`,`created_at`);
