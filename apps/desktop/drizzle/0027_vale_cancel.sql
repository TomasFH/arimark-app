ALTER TABLE `employee_vales` ADD `cancelled_at` text;--> statement-breakpoint
ALTER TABLE `employee_vales` ADD `cancelled_by` text REFERENCES `users`(`id`);
