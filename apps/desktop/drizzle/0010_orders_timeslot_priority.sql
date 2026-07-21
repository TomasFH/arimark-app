ALTER TABLE `orders` ADD `time_slot` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD `pickup_time` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD `priority` integer DEFAULT 0 NOT NULL;
