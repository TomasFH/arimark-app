interface Props {
  stores: string[]
  onSelect: (storeId: string) => void
}

export function StoreSelector({ stores, onSelect }: Props) {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h2 className="text-white text-xl font-bold">Seleccioná tu local</h2>
          <p className="text-gray-400 text-sm mt-1">¿Desde qué sucursal estás trabajando hoy?</p>
        </div>

        <div className="space-y-3">
          {stores.map(storeId => (
            <button
              key={storeId}
              onClick={() => onSelect(storeId)}
              className="w-full bg-gray-800 hover:bg-gray-700 text-white text-left rounded-xl px-5 py-4 font-semibold text-base transition-colors flex items-center gap-3"
            >
              <span className="text-2xl">🏪</span>
              <span>{storeId}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
