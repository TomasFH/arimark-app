ALTER TABLE `shifts` ADD `debit_total` real;--> statement-breakpoint
ALTER TABLE `shifts` ADD `wallet_total` real;--> statement-breakpoint
ALTER TABLE `shifts` ADD `credit_total` real;--> statement-breakpoint
ALTER TABLE `summary_shift_cache` ADD `debit_total` real;--> statement-breakpoint
ALTER TABLE `summary_shift_cache` ADD `wallet_total` real;--> statement-breakpoint
ALTER TABLE `summary_shift_cache` ADD `credit_total` real;
