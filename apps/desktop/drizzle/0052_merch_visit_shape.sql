ALTER TABLE `provider_purchase_prices` ADD `pack_contents` integer;
--> statement-breakpoint
ALTER TABLE `provider_purchase_prices` ADD `weigh_mode` text;
--> statement-breakpoint
ALTER TABLE `merchandise_intake_lines` ADD `weigh_mode` text;
--> statement-breakpoint
ALTER TABLE `merchandise_intake_lines` ADD `money_role` text;
--> statement-breakpoint
ALTER TABLE `merchandise_intake_lines` ADD `not_for_sale` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `merchandise_intakes` ADD `client_request_id` text;
--> statement-breakpoint
ALTER TABLE `merchandise_intakes` ADD `payment_channel` text DEFAULT 'cash' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_merch_intake_client_request` ON `merchandise_intakes` (`client_request_id`);
