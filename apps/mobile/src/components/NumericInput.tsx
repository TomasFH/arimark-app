import { forwardRef, type ChangeEvent, type InputHTMLAttributes } from 'react'
import { formatNumericInputValue, calcCursorPosition } from '../lib/numericInput'

type NumericInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'inputMode' | 'onChange' | 'value'
> & {
  value: string
  onChange: (formattedValue: string) => void
}

const NumericInput = forwardRef<HTMLInputElement, NumericInputProps>(
  function NumericInput({ value, onChange, ...rest }, ref) {
    function handleChange(e: ChangeEvent<HTMLInputElement>) {
      const el = e.target
      const rawValue = el.value
      const rawCursor = el.selectionStart ?? rawValue.length
      const formatted = formatNumericInputValue(rawValue)
      const newCursor = calcCursorPosition(rawValue, rawCursor, formatted)

      onChange(formatted)

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
  },
)

export default NumericInput
