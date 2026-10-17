-- La caja resta expenses.amount. Hasta acá ese monto era solo la visita:
-- la deuda vieja saldada en el mismo acto quedaba en provider_debt_events
-- (type payment) y nunca había salido de una caja el día que se generó.
-- Se suma una sola vez y se marca el gasto para re-sincronizar.
--
-- No toca pay-from-shift: amount ya es la suma de los payments, no hay
-- merchandise_intakes de ese expense y no hay evento type debt.
-- Una visita con intake sí se corrige aunque amount coincida con el payment.
UPDATE expenses
SET
  amount = amount + (
    SELECT COALESCE(SUM(p.amount), 0)
    FROM provider_debt_events AS p
    WHERE p.expense_id = expenses.id
      AND p.type = 'payment'
  ),
  synced_at = NULL
WHERE EXISTS (
  SELECT 1
  FROM provider_debt_events AS p
  WHERE p.expense_id = expenses.id
    AND p.type = 'payment'
)
AND NOT (
  expenses.amount = (
    SELECT COALESCE(SUM(p.amount), 0)
    FROM provider_debt_events AS p
    WHERE p.expense_id = expenses.id
      AND p.type = 'payment'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM merchandise_intakes AS mi
    WHERE mi.expense_id = expenses.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM provider_debt_events AS d
    WHERE d.expense_id = expenses.id
      AND d.type = 'debt'
  )
);
