ALTER TABLE `employees` ADD `synced_at` text;
--> statement-breakpoint
-- Forzar re-push de empleados ya existentes hacia Firestore.
UPDATE `employees` SET `synced_at` = NULL;
