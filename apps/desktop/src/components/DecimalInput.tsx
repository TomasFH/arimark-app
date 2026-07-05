import { forwardRef, type ChangeEvent, type InputHTMLAttributes } from 'react'
import { formatDecimalInputValue } from '../lib/numericInput'

type DecimalInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'inputMode' | 'onChange' | 'value'
> & {
  value: string
  onChange: (formattedValue: string) => void
  /** Máximo de decimales permitidos (default 2 para precios, 3 para pesos en kg). */
  maxDecimals?: number
  /**
   * Modo peso en kg: acepta punto como separador decimal (0.490 → 0,490)
   * y auto-inserta coma después del cero inicial (04 → 0,4).
   */
  weightMode?: boolean
}

/**
 * Input de monto con autoformateo es-AR: miles con punto, decimales con coma.
 * Ej: 17535,50 → 17.535,50 | 0,490 kg → usar maxDecimals={3} weightMode
 *
 * Validación al enviar: parseDecimalInput() en el contenedor padre.
 */
const DecimalInput = forwardRef<HTMLInputElement, DecimalInputProps>(
  function DecimalInput({ value, onChange, maxDecimals = 2, weightMode = false, ...rest }, ref) {
    function handleChange(e: ChangeEvent<HTMLInputElement>) {
      onChange(formatDecimalInputValue(e.target.value, maxDecimals, { weightMode }))
    }

    return (
      <input
        {...rest}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={handleChange}
      />
    )
  }
)

export default DecimalInput
