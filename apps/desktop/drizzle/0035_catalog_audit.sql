CREATE TABLE `catalog_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`store_id` text,
	`action` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_audit_product` ON `catalog_audit_events` (`product_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_catalog_audit_store` ON `catalog_audit_events` (`store_id`,`created_at`);
