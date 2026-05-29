import type { ChangeEvent, InputHTMLAttributes } from 'react'
import { formatNumericInputValue } from '../lib/numericInput'

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
 */
export default function NumericInput({ value, onChange, ...rest }: NumericInputProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(formatNumericInputValue(e.target.value))
  }

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={handleChange}
    />
  )
}
