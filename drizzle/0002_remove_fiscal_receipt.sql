-- Migración 0002: eliminar artefactos de caja registradora.
-- La app ya no interactúa con caja registradora; las cajeras la operan por fuera.

ALTER TABLE `sales` DROP COLUMN `fiscal_receipt_issued`;
--> statement-breakpoint
DROP TABLE `pending_fiscal_payments`;
