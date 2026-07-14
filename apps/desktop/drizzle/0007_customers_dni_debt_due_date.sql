-- Fase 6: clientes especiales y deudas
-- Agrega DNI a customers y due_date a debt_events.

ALTER TABLE customers ADD COLUMN dni text;
--> statement-breakpoint
ALTER TABLE debt_events ADD COLUMN due_date text;
