-- D1: redefinir empleados/asistencia/vales al modelo operativo acordado.
-- Las tablas preliminares de 0000 (employees / attendance / employee_advances)
-- nunca tuvieron UI ni datos de producción; se recrean limpias.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
DROP TABLE IF EXISTS `attendance`;
--> statement-breakpoint
DROP TABLE IF EXISTS `employee_advances`;
--> statement-breakpoint
DROP TABLE IF EXISTS `employees`;
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`weekly_wage` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_name_unique` ON `employees` (`name`);
--> statement-breakpoint
CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`recorded_by` text NOT NULL,
	`created_at` text NOT NULL,
	`synced_at` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_attendance_employee_date` ON `attendance` (`employee_id`,`date`);
--> statement-breakpoint
CREATE INDEX `idx_attendance_date` ON `attendance` (`date`);
--> statement-breakpoint
CREATE TABLE `employee_vales` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`shift_id` text,
	`amount` integer NOT NULL,
	`description` text,
	`paid_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`created_at` text NOT NULL,
	`synced_at` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_employee_vales_employee` ON `employee_vales` (`employee_id`,`paid_at`);
--> statement-breakpoint
CREATE TABLE `salary_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`shift_id` text,
	`amount` integer NOT NULL,
	`week_start` text NOT NULL,
	`vales_deducted` integer DEFAULT 0 NOT NULL,
	`net_paid` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`paid_at` text NOT NULL,
	`synced_at` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_salary_payments_employee_week` ON `salary_payments` (`employee_id`,`week_start`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
