/**
 * Selector de local para vistas de admin.
 * Aparece solo cuando el usuario es administrador y permite filtrar
 * por local específico o ver datos de todos los locales.
 */
import type { StoreRow } from '../types/hw-api'

interface Props {
  stores: StoreRow[]
  value: string   // storeId específico o 'all'
  onChange: (storeId: string) => void
}

export default function StoreFilter({ stores, value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-zinc-500 shrink-0">Local:</span>
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => onChange('all')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            value === 'all'
              ? 'bg-indigo-600 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          Todos
        </button>
        {stores.map(s => (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            title={s.name}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors truncate max-w-[150px] ${
              value === s.id
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  )
}
