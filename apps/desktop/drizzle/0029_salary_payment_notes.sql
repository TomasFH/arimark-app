ALTER TABLE `salary_payments` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `salary_payments` ADD `vales_snapshot` text;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_salary_payments_employee_week`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_salary_payments_employee_week` ON `salary_payments` (`employee_id`,`week_start`);
