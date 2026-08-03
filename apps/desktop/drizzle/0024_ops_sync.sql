ALTER TABLE `special_customers` ADD `synced_at` text;--> statement-breakpoint
ALTER TABLE `special_customer_prices` ADD `synced_at` text;--> statement-breakpoint
-- Re-push de datos ya existentes (outbox pendiente)
UPDATE `orders` SET `synced_at` = NULL;--> statement-breakpoint
UPDATE `customers` SET `synced_at` = NULL;--> statement-breakpoint
UPDATE `debt_events` SET `synced_at` = NULL;--> statement-breakpoint
UPDATE `special_customers` SET `synced_at` = NULL;--> statement-breakpoint
UPDATE `special_customer_prices` SET `synced_at` = NULL;
