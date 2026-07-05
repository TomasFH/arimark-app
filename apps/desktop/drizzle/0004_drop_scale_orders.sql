-- Migración 0004: eliminar tablas scale_orders / scale_order_items y columna scale_order_id.
-- Estas tablas modelaban el push de pedidos en tiempo real desde la balanza KRETZ,
-- modelo descartado en jun 2026. Las ventas se modelan con sales + sale_items.
-- Ver PLAN.md → "Modelo de flujo de datos".
DROP INDEX IF EXISTS `idx_scale_order_items_order`;
--> statement-breakpoint
DROP TABLE `scale_order_items`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_scale_orders_shift`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_scale_orders_store`;
--> statement-breakpoint
DROP TABLE `scale_orders`;
--> statement-breakpoint
ALTER TABLE `sales` DROP COLUMN `scale_order_id`;
