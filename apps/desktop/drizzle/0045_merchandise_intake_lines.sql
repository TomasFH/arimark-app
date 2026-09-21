CREATE TABLE `merchandise_intake_rubros` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`template` text NOT NULL,
	`pack_contents` integer,
	`pack_tare_kg` real,
	`pack_label` text,
	`sort_order` integer NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text,
	`updated_by` text,
	`synced_at` text
);--> statement-breakpoint
CREATE INDEX `idx_merch_rubro_sort` ON `merchandise_intake_rubros` (`sort_order`,`name`);--> statement-breakpoint
INSERT OR IGNORE INTO `merchandise_intake_rubros` (`id`, `name`, `template`, `pack_contents`, `pack_tare_kg`, `pack_label`, `sort_order`, `archived_at`, `created_at`, `created_by`, `updated_at`, `updated_by`, `synced_at`) VALUES
	('rubro_media_res', 'Media res', 'pieces_weight', NULL, NULL, NULL, 10, NULL, '2026-09-17T00:00:00.000Z', NULL, NULL, NULL, NULL),
	('rubro_pollo_entero', 'Pollo entero', 'packs', NULL, NULL, 'Cajón', 20, NULL, '2026-09-17T00:00:00.000Z', NULL, NULL, NULL, NULL),
	('rubro_maple', 'Maple', 'packs', NULL, NULL, 'Maple', 30, NULL, '2026-09-17T00:00:00.000Z', NULL, NULL, NULL, NULL),
	('rubro_cerdo', 'Cerdo', 'weight', NULL, NULL, NULL, 40, NULL, '2026-09-17T00:00:00.000Z', NULL, NULL, NULL, NULL),
	('rubro_bondiola', 'Bondiola', 'weight', NULL, NULL, NULL, 50, NULL, '2026-09-17T00:00:00.000Z', NULL, NULL, NULL, NULL),
	('rubro_costilla_cerdo', 'Costilla de cerdo', 'weight', NULL, NULL, NULL, 60, NULL, '2026-09-17T00:00:00.000Z', NULL, NULL, NULL, NULL),
	('rubro_chinchulin', 'Chinchulín', 'weight', NULL, NULL, NULL, 70, NULL, '2026-09-17T00:00:00.000Z', NULL, NULL, NULL, NULL),
	('rubro_chorizo', 'Chorizo', 'weight', NULL, NULL, NULL, 80, NULL, '2026-09-17T00:00:00.000Z', NULL, NULL, NULL, NULL),
	('rubro_morcilla', 'Morcilla', 'weight', NULL, NULL, NULL, 90, NULL, '2026-09-17T00:00:00.000Z', NULL, NULL, NULL, NULL),
	('rubro_carbon', 'Carbón', 'count', NULL, NULL, NULL, 100, NULL, '2026-09-17T00:00:00.000Z', NULL, NULL, NULL, NULL),
	('rubro_lenia', 'Leña', 'count', NULL, NULL, NULL, 110, NULL, '2026-09-17T00:00:00.000Z', NULL, NULL, NULL, NULL),
	('rubro_limpieza', 'Limpieza', 'count', NULL, NULL, NULL, 120, NULL, '2026-09-17T00:00:00.000Z', NULL, NULL, NULL, NULL);--> statement-breakpoint
CREATE TABLE `merchandise_intake_lines` (
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
	`weights_json` text
);--> statement-breakpoint
CREATE INDEX `idx_merch_line_intake` ON `merchandise_intake_lines` (`intake_id`, `sort_order`);--> statement-breakpoint
CREATE INDEX `idx_merch_line_rubro` ON `merchandise_intake_lines` (`rubro_id`);--> statement-breakpoint
INSERT INTO `merchandise_intake_lines` (
	`id`, `intake_id`, `rubro_id`, `rubro_name`, `template`, `sort_order`, `pack_label`,
	`count`, `pack_contents`, `pack_tare_kg`, `has_ice`, `gross_kg`, `net_kg`, `unit_count`, `kg_per_unit`, `weights_json`
)
SELECT
	id || '-l1',
	id,
	CASE lower(trim(category))
		WHEN 'media res' THEN 'rubro_media_res'
		WHEN 'pollo entero' THEN 'rubro_pollo_entero'
		WHEN 'maple' THEN 'rubro_maple'
		WHEN 'cerdo' THEN 'rubro_cerdo'
		WHEN 'bondiola' THEN 'rubro_bondiola'
		WHEN 'costilla de cerdo' THEN 'rubro_costilla_cerdo'
		WHEN 'chinchulín' THEN 'rubro_chinchulin'
		WHEN 'chinchulin' THEN 'rubro_chinchulin'
		WHEN 'chorizo' THEN 'rubro_chorizo'
		WHEN 'morcilla' THEN 'rubro_morcilla'
		WHEN 'carbón' THEN 'rubro_carbon'
		WHEN 'carbon' THEN 'rubro_carbon'
		WHEN 'leña' THEN 'rubro_lenia'
		WHEN 'lenia' THEN 'rubro_lenia'
		WHEN 'limpieza' THEN 'rubro_limpieza'
		ELSE 'legacy_' || id
	END,
	category,
	CASE unit WHEN 'kg' THEN 'weight' ELSE 'count' END,
	0,
	NULL,
	CASE unit WHEN 'kg' THEN 1 ELSE CAST(quantity AS INTEGER) END,
	NULL,
	NULL,
	0,
	CASE unit WHEN 'kg' THEN quantity ELSE NULL END,
	CASE unit WHEN 'kg' THEN quantity ELSE NULL END,
	CASE unit WHEN 'u' THEN CAST(quantity AS INTEGER) ELSE NULL END,
	NULL,
	CASE unit WHEN 'kg' THEN json_array(quantity) ELSE '[]' END
FROM `merchandise_intakes`;--> statement-breakpoint
ALTER TABLE `merchandise_intakes` DROP COLUMN `category`;--> statement-breakpoint
ALTER TABLE `merchandise_intakes` DROP COLUMN `unit`;--> statement-breakpoint
ALTER TABLE `merchandise_intakes` DROP COLUMN `quantity`;
