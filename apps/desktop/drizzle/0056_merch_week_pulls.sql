CREATE TABLE `merch_week_pulls` (
	`store_id` text NOT NULL REFERENCES `stores`(`id`),
	`week_start_iso` text NOT NULL,
	`pulled_at` text NOT NULL,
	PRIMARY KEY (`store_id`, `week_start_iso`)
);
