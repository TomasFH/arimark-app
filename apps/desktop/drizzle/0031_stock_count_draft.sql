ALTER TABLE `stock_counts` ADD `status` text DEFAULT 'final' NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_counts` ADD `updated_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_stock_counts_one_draft` ON `stock_counts` (`store_id`) WHERE `status` = 'draft';
