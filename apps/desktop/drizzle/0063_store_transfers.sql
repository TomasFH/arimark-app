CREATE TABLE `store_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`product_name` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`from_store_id` text NOT NULL,
	`to_store_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`notes` text,
	`estimated_value` integer,
	`status` text NOT NULL,
	`received_quantity` real,
	`has_difference` integer DEFAULT false NOT NULL,
	`confirmed_at` text,
	`confirmed_by` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text,
	`updated_by` text,
	`synced_at` text,
	FOREIGN KEY (`from_store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_store_transfers_status_occurred` ON `store_transfers` (`status`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `idx_store_transfers_from_occurred` ON `store_transfers` (`from_store_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `idx_store_transfers_to_occurred` ON `store_transfers` (`to_store_id`,`occurred_at`);
