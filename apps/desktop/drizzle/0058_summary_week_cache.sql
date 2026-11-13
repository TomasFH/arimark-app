CREATE TABLE `summary_week_pulls` (
	`store_id` text NOT NULL REFERENCES `stores`(`id`),
	`week_start_iso` text NOT NULL,
	`pulled_at` text NOT NULL,
	PRIMARY KEY (`store_id`, `week_start_iso`)
);
--> statement-breakpoint
CREATE TABLE `summary_shift_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL REFERENCES `stores`(`id`),
	`cashier_name` text NOT NULL,
	`shift_type` text NOT NULL,
	`started_at` text NOT NULL,
	`closed_at` text,
	`opening_cash` real NOT NULL,
	`cash_left` real,
	`delivered_amount` real,
	`sold_total` real,
	`cash_total` real,
	`card_wallet_total` real,
	`debt_total` real,
	`expense_total` real,
	`contribution_total` real,
	`wallet_cash_total` real,
	`money_snapshotted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_summary_shift_cache_store` ON `summary_shift_cache` (`store_id`, `started_at`);
