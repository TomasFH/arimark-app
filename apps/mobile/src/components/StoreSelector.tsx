import { useBackLayer } from '../lib/backStack'

interface Props {
  stores: Array<{ id: string; name: string }>
  onSelect: (storeId: string) => void
  onBack?: () => void
}

export function StoreSelector({ stores, onSelect, onBack }: Props) {
  useBackLayer(Boolean(onBack), onBack ?? (() => {}))
  return (
    <div className="h-full min-h-0 bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h2 className="text-white text-xl font-bold">Seleccioná tu local</h2>
          <p className="text-gray-400 text-sm mt-1">¿Desde qué sucursal estás trabajando hoy?</p>
        </div>

        {stores.length === 0 ? (
          <p className="text-sm text-amber-300 text-center">
            No hay locales para elegir. Conectate a internet una vez para descargar la lista.
          </p>
        ) : (
          <div className="space-y-3">
            {stores.map(store => (
              <button
                key={store.id}
                type="button"
                onClick={() => onSelect(store.id)}
                className="w-full bg-gray-800 hover:bg-emerald-950/40 hover:border-emerald-500 border border-gray-700 text-white text-left rounded-xl px-5 py-4 font-semibold text-base transition-colors flex items-center gap-3 min-w-0"
              >
                <span className="text-2xl shrink-0">🏪</span>
                <span className="min-w-0 flex-1 truncate" title={store.name}>{store.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
