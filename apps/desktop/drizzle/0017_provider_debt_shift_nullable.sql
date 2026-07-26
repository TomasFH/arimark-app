PRAGMA foreign_keys=OFF;
--> statement-breakpoint

-- Hacer shift_id nullable en provider_debt_events.
-- El admin puede registrar pagos a proveedores fuera del turno de caja
-- (SETTLE_PROVIDER_DEBT). En ese caso shiftId = null.
-- SQLite no soporta ALTER COLUMN, por lo que se recrea la tabla.
CREATE TABLE `provider_debt_events_new` (
  `id` text PRIMARY KEY NOT NULL,
  `store_id` text NOT NULL,
  `provider_id` text,
  `provider` text NOT NULL,
  `type` text NOT NULL,
  `amount` real NOT NULL,
  `expense_id` text,
  `shift_id` text,
  `created_at` text NOT NULL,
  `created_by` text NOT NULL,
  `synced_at` text,
  FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint

INSERT INTO `provider_debt_events_new`
  SELECT `id`, `store_id`, `provider_id`, `provider`, `type`, `amount`,
         `expense_id`, `shift_id`, `created_at`, `created_by`, `synced_at`
  FROM `provider_debt_events`;
--> statement-breakpoint

DROP TABLE `provider_debt_events`;
--> statement-breakpoint

ALTER TABLE `provider_debt_events_new` RENAME TO `provider_debt_events`;
--> statement-breakpoint

CREATE INDEX `idx_provider_debt_store_provider` ON `provider_debt_events` (`store_id`, `provider`);
--> statement-breakpoint

CREATE INDEX `idx_provider_debt_provider_id` ON `provider_debt_events` (`provider_id`, `store_id`);
--> statement-breakpoint

PRAGMA foreign_keys=ON;
