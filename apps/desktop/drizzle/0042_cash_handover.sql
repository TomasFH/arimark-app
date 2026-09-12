ALTER TABLE `shifts` ADD `opening_counted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `shifts` ADD `closing_counted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `shifts` ADD `handover_from_shift_id` text;--> statement-breakpoint
ALTER TABLE `shifts` ADD `handover_from_cashier_name` text;--> statement-breakpoint
ALTER TABLE `shifts` ADD `handover_from_closed_at` text;--> statement-breakpoint
ALTER TABLE `bill_denominations` ADD `kind` text DEFAULT 'closing' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_bill_denoms_shift_kind` ON `bill_denominations` (`shift_id`,`kind`);
