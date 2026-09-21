CREATE TABLE `merchandise_intakes` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`category` text NOT NULL,
	`unit` text NOT NULL,
	`quantity` real NOT NULL,
	`notes` text,
	`payment_kind` text NOT NULL,
	`paid_amount` integer NOT NULL DEFAULT 0,
	`debt_amount` integer NOT NULL DEFAULT 0,
	`provider_id` text,
	`provider_name` text,
	`expense_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text,
	`updated_at` text,
	`synced_at` text
);--> statement-breakpoint
CREATE INDEX `idx_merch_intake_shift` ON `merchandise_intakes` (`shift_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_merch_intake_store_created` ON `merchandise_intakes` (`store_id`,`created_at`);
