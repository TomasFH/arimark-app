PRAGMA foreign_keys=OFF;
--> statement-breakpoint

-- 1. Crear tabla providers (caché local sincronizable)
--    id = lower(hex(nameKey)) → determinístico, consistente con providerIdFromName() en TS
CREATE TABLE `providers` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `name_key` text NOT NULL,
  `phone` text,
  `notes` text,
  `archived_at` text,
  `created_at` text NOT NULL,
  `created_by` text REFERENCES `users`(`id`),
  `updated_at` text,
  `updated_by` text REFERENCES `users`(`id`),
  `synced_at` text
);
--> statement-breakpoint

-- 2. Backfill providers desde nombres distintos en expenses + provider_debt_events
--    GROUP BY lower(trim()) deduplica case-insensitive; min() elige variante canónica
INSERT OR IGNORE INTO `providers` (`id`, `name`, `name_key`, `created_at`)
SELECT
  lower(hex(lower(trim(p.pname)))),
  min(p.pname),
  lower(trim(p.pname)),
  datetime('now')
FROM (
  SELECT provider AS pname FROM `expenses`
    WHERE provider IS NOT NULL AND trim(provider) != ''
  UNION ALL
  SELECT provider AS pname FROM `provider_debt_events`
    WHERE provider IS NOT NULL AND trim(provider) != ''
) p
GROUP BY lower(trim(p.pname));
--> statement-breakpoint

-- 3. Recrear expenses: category → concept (nullable), eliminar provider text, agregar provider_id FK
CREATE TABLE `expenses_new` (
  `id` text PRIMARY KEY NOT NULL,
  `store_id` text NOT NULL REFERENCES `stores`(`id`),
  `shift_id` text NOT NULL REFERENCES `shifts`(`id`),
  `concept` text,
  `provider_id` text REFERENCES `providers`(`id`),
  `amount` real NOT NULL,
  `notes` text,
  `created_at` text NOT NULL,
  `created_by` text NOT NULL REFERENCES `users`(`id`),
  `synced_at` text
);
--> statement-breakpoint
INSERT INTO `expenses_new`
  SELECT
    e.`id`,
    e.`store_id`,
    e.`shift_id`,
    e.`category`,
    CASE
      WHEN e.`provider` IS NOT NULL AND trim(e.`provider`) != ''
        THEN lower(hex(lower(trim(e.`provider`))))
      ELSE NULL
    END,
    e.`amount`,
    e.`notes`,
    e.`created_at`,
    e.`created_by`,
    e.`synced_at`
  FROM `expenses` e;
--> statement-breakpoint
DROP TABLE `expenses`;
--> statement-breakpoint
ALTER TABLE `expenses_new` RENAME TO `expenses`;
--> statement-breakpoint

-- 4. Reconstruir índices de expenses
CREATE INDEX `idx_expenses_shift` ON `expenses` (`shift_id`);
--> statement-breakpoint
CREATE INDEX `idx_expenses_provider` ON `expenses` (`provider_id`);
--> statement-breakpoint

-- 5. Agregar provider_id y synced_at a provider_debt_events
ALTER TABLE `provider_debt_events` ADD COLUMN `provider_id` text REFERENCES `providers`(`id`);
--> statement-breakpoint
ALTER TABLE `provider_debt_events` ADD COLUMN `synced_at` text;
--> statement-breakpoint

-- 6. Backfill provider_id en provider_debt_events resolviendo por nombre
UPDATE `provider_debt_events`
SET `provider_id` = lower(hex(lower(trim(`provider`))))
WHERE `provider` IS NOT NULL AND trim(`provider`) != '';
--> statement-breakpoint

-- 7. Índice compuesto (provider_id, store_id) para queries de deuda por proveedor+local
CREATE INDEX `idx_provider_debt_provider_id` ON `provider_debt_events` (`provider_id`, `store_id`);
--> statement-breakpoint

PRAGMA foreign_keys=ON;
