ALTER TABLE `debt_events` ADD `payment_method` text;--> statement-breakpoint
ALTER TABLE `debt_events` ADD `shift_id` text REFERENCES `shifts`(`id`);--> statement-breakpoint
CREATE INDEX `idx_debt_events_shift` ON `debt_events` (`shift_id`);--> statement-breakpoint
-- Clientes especiales son globales: ya no se asignan a un local.
UPDATE `special_customers` SET `store_id` = NULL WHERE `store_id` IS NOT NULL;
