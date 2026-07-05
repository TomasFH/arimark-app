-- Migración 0003: agregar plu_number a products.
-- Vincula cada producto con su número de PLU en la balanza KRETZ (1–999, único).
-- Rangos acordados:
--   1–99   → Cortes vacunos
--   100–149 → Pollo y aves
--   150–199 → Cerdo
--   200–249 → Embutidos y chacinados
--   250–299 → Productos especiales (huevos, carbón, leña, etc.)
--   300+    → Reservado / uso libre

ALTER TABLE `products` ADD COLUMN `plu_number` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `products_plu_number_unique` ON `products` (`plu_number`);
