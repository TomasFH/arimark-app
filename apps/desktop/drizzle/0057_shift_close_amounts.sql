ALTER TABLE `shifts` ADD `cash_left` real;--> statement-breakpoint
ALTER TABLE `shifts` ADD `closed_by_user_id` text;--> statement-breakpoint
ALTER TABLE `shifts` ADD `closed_by_name` text;--> statement-breakpoint
ALTER TABLE `shifts` ADD `opened_locally` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `shifts` ADD `sold_total` real;--> statement-breakpoint
ALTER TABLE `shifts` ADD `cash_total` real;--> statement-breakpoint
ALTER TABLE `shifts` ADD `card_wallet_total` real;--> statement-breakpoint
ALTER TABLE `shifts` ADD `debt_total` real;--> statement-breakpoint
ALTER TABLE `shifts` ADD `expense_total` real;--> statement-breakpoint
ALTER TABLE `shifts` ADD `contribution_total` real;--> statement-breakpoint
ALTER TABLE `shifts` ADD `wallet_cash_total` real;--> statement-breakpoint
ALTER TABLE `shifts` ADD `money_snapshotted_at` text;
