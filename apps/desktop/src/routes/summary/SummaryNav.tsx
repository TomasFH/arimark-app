import { cx } from '../../components/ui'

export type SummarySectionId = 'resumen' | 'ventas' | 'gastos' | 'mercaderia' | 'fiados'

const SECTIONS: { id: SummarySectionId; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'ventas', label: 'Ventas' },
  { id: 'gastos', label: 'Gastos' },
  { id: 'mercaderia', label: 'Mercadería' },
  { id: 'fiados', label: 'Fiados' },
]

export function SummaryNav({
  section,
  onChange,
}: {
  section: SummarySectionId
  onChange: (id: SummarySectionId) => void
}) {
  return (
    <nav aria-label="Secciones del resumen" className="lg:w-44 lg:shrink-0">
      <div role="tablist" aria-label="Secciones del resumen" className="flex gap-1 overflow-x-auto lg:flex-col">
        {SECTIONS.map(item => {
          const selected = item.id === section
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`summary-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`summary-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
              className={cx(
                'shrink-0 rounded-lg px-3 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                selected ? 'bg-panel font-semibold text-ink' : 'text-muted hover:bg-hover hover:text-ink',
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
