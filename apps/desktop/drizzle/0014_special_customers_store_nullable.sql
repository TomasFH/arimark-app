PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `special_customers_new` (
  `id` text PRIMARY KEY NOT NULL,
  `store_id` text REFERENCES `stores`(`id`),
  `name` text NOT NULL,
  `notes` text,
  `created_at` text NOT NULL,
  `created_by` text NOT NULL REFERENCES `users`(`id`),
  `updated_at` text,
  `updated_by` text REFERENCES `users`(`id`)
);
--> statement-breakpoint
INSERT INTO `special_customers_new`
  SELECT `id`, `store_id`, `name`, `notes`, `created_at`, `created_by`, `updated_at`, `updated_by`
  FROM `special_customers`;
--> statement-breakpoint
DROP TABLE `special_customers`;
--> statement-breakpoint
ALTER TABLE `special_customers_new` RENAME TO `special_customers`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
