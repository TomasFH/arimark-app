import { forwardRef, type ChangeEvent, type InputHTMLAttributes } from 'react'
import { formatDecimalInputValue } from '../lib/numericInput'

type DecimalInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'inputMode' | 'onChange' | 'value'
> & {
  value: string
  onChange: (formattedValue: string) => void
}

/**
 * Input de monto con autoformateo es-AR: miles con punto, centavos con coma.
 * Ej: 17535,50 → 17.535,50
 *
 * Validación al enviar: parseDecimalInput() en el contenedor padre.
 */
const DecimalInput = forwardRef<HTMLInputElement, DecimalInputProps>(
  function DecimalInput({ value, onChange, ...rest }, ref) {
    function handleChange(e: ChangeEvent<HTMLInputElement>) {
      onChange(formatDecimalInputValue(e.target.value))
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
