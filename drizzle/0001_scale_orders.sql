-- Migración 0001: pedidos de balanza (scale_orders + scale_order_items)
-- Reemplaza el modelo de tickets individuales por pedidos completos por canal.

CREATE TABLE `scale_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`channel` text NOT NULL,
	`total` real NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`synced_at` text,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_scale_orders_shift` ON `scale_orders` (`shift_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_scale_orders_store` ON `scale_orders` (`store_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `scale_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_code` text NOT NULL,
	`product_id` text,
	`weight_kg` real NOT NULL,
	`unit_price` real NOT NULL,
	`subtotal` real NOT NULL,
	`synced_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `scale_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_scale_order_items_order` ON `scale_order_items` (`order_id`);
--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `scale_order_id` text;
