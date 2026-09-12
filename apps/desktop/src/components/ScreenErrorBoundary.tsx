import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Al cambiar de pantalla se limpia el error para no bloquear la siguiente. */
  resetKey: string
  onReset?: () => void
}

interface State {
  error: Error | null
}

/**
 * Evita que un crash de una pantalla deje la ventana en blanco.
 * El resto de la app sigue; se puede volver o reintentar.
 */
export default class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] pantalla crasheó', error, info.componentStack)
  }

  override componentDidUpdate(prevProps: Props): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  private retry = (): void => {
    this.setState({ error: null })
  }

  private goBack = (): void => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  override render(): ReactNode {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        {this.state.error ? (
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center bg-app px-6 py-10 text-center">
            <p className="text-base font-semibold text-white">Esta pantalla no se pudo mostrar.</p>
            <p className="mt-2 max-w-md text-sm text-muted">
              El resto de la app sigue funcionando. Volvé atrás o reintentá.
            </p>
            <p className="mt-3 max-w-md truncate text-xs text-subtle" title={this.state.error.message}>
              {this.state.error.message}
            </p>
            <div className="mt-6 flex gap-3">
              {this.props.onReset && (
                <button
                  type="button"
                  onClick={this.goBack}
                  className="rounded-xl border border-line px-4 py-2.5 text-sm text-ink hover:bg-hover"
                >
                  Volver
                </button>
              )}
              <button
                type="button"
                onClick={this.retry}
                className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent"
              >
                Reintentar
              </button>
            </div>
          </div>
        ) : (
          this.props.children
        )}
      </div>
    )
  }
}
