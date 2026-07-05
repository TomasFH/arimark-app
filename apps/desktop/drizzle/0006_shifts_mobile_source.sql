-- Migración 0006: columna `source` en shifts para distinguir turnos del desktop
-- de los turnos importados desde la PWA móvil.
-- Los turnos móviles (source='mobile') NO participan de la lógica "un turno
-- abierto por local" del desktop, y tampoco activan el turno activo en sesión.
ALTER TABLE `shifts` ADD COLUMN `source` text NOT NULL DEFAULT 'desktop';
