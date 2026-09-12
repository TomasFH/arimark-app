# DESIGN.md — App desktop (POS)

Identidad Operate: mostrador, no marketing. El **claro** es la fuente de verdad; el oscuro es el mismo sistema invertido.

## Tokens

`:root` = light. `[data-theme="dark"]` = par. Clases Tailwind: `bg-app`, `bg-panel`, `bg-raised`, `bg-input`, `bg-hover`, `bg-accent-soft`, `text-ink`, `text-muted`, `text-subtle`, `border-line`, `border-line-strong`, `border-line-accent`, `bg-accent`, `text-accent`, `text-accent-fg`, `danger`, `success`, `bg-overlay`.

### Claro

| Rol | Hex |
|---|---|
| Canvas | `#F4F5F7` |
| Panel / card | `#FFFFFF` |
| Texto | `#1C1C1E` |
| Muted | `#8A8A93` |
| Borde | `#E6E6EB` |
| Acento (coral-rojo) | `#E85D4C` |
| Wash selección | `#FDE8E3` |
| Peligro | `#C0362C` |
| Éxito | `#1F7A38` |

### Oscuro

| Rol | Hex |
|---|---|
| App | `#171412` |
| Panel | `#221E1C` |
| Raised | `#2B2624` |
| Texto | `#F5F2F0` |
| Muted | `#A39C98` |
| Borde | `#3A3432` |
| Acento | el mismo `#E85D4C` |

No cablear `business.json.theme.accent` desde este archivo: un accent por cliente rompería el par claro/oscuro.

## Primitivos

`src/components/ui/`: `Button` (primary coral / secondary / ghost / danger), `Modal` (portal, Escape, overlay), `ScreenHeader`, `ActionMenu`, `ListRow`, `SectionLabel`, `BrandMark` (hexágono, sin emoji de cliente).

Campos enteros: `NumericInput` (`type="text"` + `inputMode="numeric"`, sin `pattern`). Texto de usuario: `min-w-0 truncate` + `title`.

## Agrupación

Una acción primaria por contexto; el resto en hamburguesa o `ActionMenu`.

Caja — riel: Menú, Venta, Vales, Gastos, Turno. Hamburguesa: Ingreso, Cebo, Saldar + consultas/operación/apariencia/sesión.

Tema: `UiSettings.colorScheme` (`light` default), `applyColorScheme` al boot.
