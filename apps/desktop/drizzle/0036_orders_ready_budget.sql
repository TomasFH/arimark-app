-- Track B: campo readyAt/readyBy/readyByName para auditoría de Listo
--           campo budgetItems para carrito de presupuesto en pedidos
ALTER TABLE orders ADD COLUMN ready_at TEXT;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN ready_by TEXT;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN ready_by_name TEXT;
--> statement-breakpoint
-- JSON: Array<{productId,name,unit,pluNumber?,estimatedQty}>
ALTER TABLE orders ADD COLUMN budget_items TEXT;
