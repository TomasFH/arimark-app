ALTER TABLE `products` ADD `purchase_pack_label` text;--> statement-breakpoint
ALTER TABLE `products` ADD `purchase_pack_contents` integer;--> statement-breakpoint
UPDATE `products` SET `purchase_pack_label` = 'Cajón', `purchase_pack_contents` = 12
WHERE lower(trim(`name`)) = 'maple';--> statement-breakpoint
ALTER TABLE `merchandise_intakes` ADD `status` text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `merchandise_intakes` ADD `draft_json` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_merch_intake_shift_draft` ON `merchandise_intakes` (`shift_id`) WHERE `status` = 'draft';--> statement-breakpoint
ALTER TABLE `merchandise_intake_lines` ADD `product_id` text;--> statement-breakpoint
ALTER TABLE `merchandise_intake_lines` ADD `name_key` text;--> statement-breakpoint
ALTER TABLE `merchandise_intake_lines` ADD `cost_unit` text;--> statement-breakpoint
ALTER TABLE `merchandise_intake_lines` ADD `unit_cost` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `merchandise_intake_lines` ADD `cost_total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `merchandise_intake_lines` ADD `pack_count` integer;--> statement-breakpoint
CREATE TABLE `provider_purchase_prices` (
	`provider_id` text NOT NULL REFERENCES `providers`(`id`),
	`product_key` text NOT NULL,
	`name` text NOT NULL,
	`cost_unit` text NOT NULL,
	`unit_cost` integer NOT NULL,
	`updated_at` text NOT NULL,
	`synced_at` text,
	PRIMARY KEY (`provider_id`, `product_key`)
);--> statement-breakpoint
CREATE INDEX `idx_purchase_price_provider` ON `provider_purchase_prices` (`provider_id`);
