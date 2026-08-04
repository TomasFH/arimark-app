/**
 * Botón de navegación "Volver" — cuadrado, fondo transparente, hover sutil.
 * Reemplaza los distintos patrones de texto "← Volver" esparcidos por la app.
 */
interface BackButtonProps {
  onClick: () => void
  title?: string
}

export default function BackButton({ onClick, title = 'Volver' }: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100 active:scale-95"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  )
}
