ALTER TABLE `products` ADD `updated_at` text;--> statement-breakpoint
UPDATE `products` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;
