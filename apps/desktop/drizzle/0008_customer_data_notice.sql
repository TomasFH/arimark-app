-- Privacidad simplificada para cuentas corrientes.
-- Guarda la constancia operativa de que se entregó el aviso físico.
ALTER TABLE customers ADD COLUMN data_notice_confirmed_at text;
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN data_notice_confirmed_by text REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN data_notice_version text;
