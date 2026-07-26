import { forwardRef, type ChangeEvent, type InputHTMLAttributes } from 'react'
import { formatNumericInputValue, calcCursorPosition } from '../lib/numericInput'

type NumericInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'inputMode' | 'onChange' | 'value'
> & {
  value: string
  onChange: (formattedValue: string) => void
}

/**
 * Input numérico entero con autoformateo de miles (es-AR: 1.000).
 *
 * Reglas del proyecto (AGENTS.md — UI campos numéricos):
 * - type="text" + inputMode="numeric" (nunca type="number")
 * - NO usar pattern: rompe el submit con valores formateados (ej. 1.250.000)
 * - Validación al enviar: parseNumericInput() en el contenedor padre
 *
 * Preservación del cursor: tras cada reformateo se restaura el cursor a la
 * posición equivalente en dígitos, evitando que salte al final cuando la
 * edición cambia la cantidad de separadores de miles.
 */
const NumericInput = forwardRef<HTMLInputElement, NumericInputProps>(
  function NumericInput({ value, onChange, ...rest }, ref) {
    function handleChange(e: ChangeEvent<HTMLInputElement>) {
      const el = e.target
      const rawValue = el.value
      const rawCursor = el.selectionStart ?? rawValue.length
      const formatted = formatNumericInputValue(rawValue)
      const newCursor = calcCursorPosition(rawValue, rawCursor, formatted)

      onChange(formatted)

      // Restaurar el cursor después de que React aplique el nuevo valor al DOM.
      requestAnimationFrame(() => {
        el.setSelectionRange(newCursor, newCursor)
      })
    }

    return (
      <input
        {...rest}
        ref={ref}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={handleChange}
      />
    )
  }
)

export default NumericInput
