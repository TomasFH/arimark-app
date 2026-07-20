ALTER TABLE `orders` ADD `deposit_amount` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `orders` ADD `deposit_method` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD `deposit_shift_id` text REFERENCES shifts(id);
--> statement-breakpoint
ALTER TABLE `orders` ADD `updated_at` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD `updated_by` text REFERENCES users(id);
--> statement-breakpoint
CREATE INDEX `idx_orders_store_pickup` ON `orders` (`store_id`, `pickup_date`);
--> statement-breakpoint
CREATE INDEX `idx_orders_shift` ON `orders` (`deposit_shift_id`);
