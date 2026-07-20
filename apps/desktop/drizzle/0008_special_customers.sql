-- Fase 6 (addendum): Clientes especiales con precios por producto.
-- Entidad separada de la tabla 'customers' usada para fiados.
-- Los admins crean/gestionan estos registros; las cajeras solo leen.

CREATE TABLE special_customers (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  notes text,
  created_at text NOT NULL,
  created_by text NOT NULL REFERENCES users(id),
  updated_at text,
  updated_by text REFERENCES users(id)
);
--> statement-breakpoint
CREATE TABLE special_customer_prices (
  id text PRIMARY KEY,
  special_customer_id text NOT NULL REFERENCES special_customers(id),
  product_id text NOT NULL REFERENCES products(id),
  price real NOT NULL,
  notes text,
  updated_at text NOT NULL,
  updated_by text NOT NULL REFERENCES users(id)
);
--> statement-breakpoint
CREATE INDEX idx_sc_prices_customer ON special_customer_prices(special_customer_id);
