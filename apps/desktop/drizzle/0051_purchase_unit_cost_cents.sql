-- Precio unitario de compra: INTEGER → REAL (pesos con centavos).
-- Se copian los valores tal cual. 9000 sigue siendo $9000.
-- cost_total, paid_amount y debt_amount quedan en pesos enteros.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint

CREATE TABLE `merchandise_intake_lines_new` (
	`id` text PRIMARY KEY NOT NULL,
	`intake_id` text NOT NULL REFERENCES `merchandise_intakes`(`id`) ON DELETE CASCADE,
	`rubro_id` text NOT NULL,
	`rubro_name` text NOT NULL,
	`template` text NOT NULL,
	`sort_order` integer NOT NULL,
	`pack_label` text,
	`count` integer NOT NULL,
	`pack_contents` integer,
	`pack_tare_kg` real,
	`has_ice` integer DEFAULT false NOT NULL,
	`gross_kg` real,
	`net_kg` real,
	`unit_count` integer,
	`kg_per_unit` real,
	`weights_json` text,
	`product_id` text,
	`name_key` text,
	`cost_unit` text,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`cost_total` integer DEFAULT 0 NOT NULL,
	`pack_count` integer
);
--> statement-breakpoint

INSERT INTO `merchandise_intake_lines_new` (
	`id`, `intake_id`, `rubro_id`, `rubro_name`, `template`, `sort_order`, `pack_label`,
	`count`, `pack_contents`, `pack_tare_kg`, `has_ice`, `gross_kg`, `net_kg`,
	`unit_count`, `kg_per_unit`, `weights_json`, `product_id`, `name_key`, `cost_unit`,
	`unit_cost`, `cost_total`, `pack_count`
)
SELECT
	`id`, `intake_id`, `rubro_id`, `rubro_name`, `template`, `sort_order`, `pack_label`,
	`count`, `pack_contents`, `pack_tare_kg`, `has_ice`, `gross_kg`, `net_kg`,
	`unit_count`, `kg_per_unit`, `weights_json`, `product_id`, `name_key`, `cost_unit`,
	`unit_cost`, `cost_total`, `pack_count`
FROM `merchandise_intake_lines`;
--> statement-breakpoint

DROP TABLE `merchandise_intake_lines`;
--> statement-breakpoint

ALTER TABLE `merchandise_intake_lines_new` RENAME TO `merchandise_intake_lines`;
--> statement-breakpoint

CREATE INDEX `idx_merch_line_intake` ON `merchandise_intake_lines` (`intake_id`, `sort_order`);
--> statement-breakpoint

CREATE INDEX `idx_merch_line_rubro` ON `merchandise_intake_lines` (`rubro_id`);
--> statement-breakpoint

CREATE TABLE `provider_purchase_prices_new` (
	`provider_id` text NOT NULL REFERENCES `providers`(`id`),
	`product_key` text NOT NULL,
	`name` text NOT NULL,
	`cost_unit` text NOT NULL,
	`unit_cost` real NOT NULL,
	`updated_at` text NOT NULL,
	`synced_at` text,
	PRIMARY KEY (`provider_id`, `product_key`)
);
--> statement-breakpoint

INSERT INTO `provider_purchase_prices_new` (
	`provider_id`, `product_key`, `name`, `cost_unit`, `unit_cost`, `updated_at`, `synced_at`
)
SELECT
	`provider_id`, `product_key`, `name`, `cost_unit`, `unit_cost`, `updated_at`, `synced_at`
FROM `provider_purchase_prices`;
--> statement-breakpoint

DROP TABLE `provider_purchase_prices`;
--> statement-breakpoint

ALTER TABLE `provider_purchase_prices_new` RENAME TO `provider_purchase_prices`;
--> statement-breakpoint

CREATE INDEX `idx_purchase_price_provider` ON `provider_purchase_prices` (`provider_id`);
--> statement-breakpoint

PRAGMA foreign_keys=ON;
