-- Migración 0005: migrar autenticación de cajeras de SQLite+bcrypt a Firebase Auth.
-- La tabla `users` deja de guardar credenciales (username/password) y pasa a ser
-- un caché local de perfil (id = firebaseUid) para que los FK de shifts/sales/
-- product_prices resuelvan sin depender de internet. La identidad y la contraseña
-- viven en Firebase Auth; el rol y los locales autorizados en Firestore
-- (licenses/{key}/users/{uid}). Ver PLAN.md / AGENTS.md → "Autenticación".
DROP INDEX IF EXISTS `users_username_unique`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `username`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `password`;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `firebase_uid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_firebase_uid_unique` ON `users` (`firebase_uid`);
