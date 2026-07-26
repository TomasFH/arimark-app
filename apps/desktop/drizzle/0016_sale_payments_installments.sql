-- Agrega columna installments a sale_payments para registrar cuotas en cobros con tarjeta de crédito.
-- NULL = método que no aplica cuotas (efectivo, débito, billetera virtual).
-- 1    = crédito en 1 pago (contado).
-- N>1  = N cuotas.

ALTER TABLE `sale_payments` ADD `installments` integer;
