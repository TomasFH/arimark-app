CREATE TABLE `summary_expense_cache` (
	`shift_id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL REFERENCES `stores`(`id`),
	`week_start_iso` text NOT NULL,
	`lines_json` text NOT NULL,
	`pulled_at` text NOT NULL
);
