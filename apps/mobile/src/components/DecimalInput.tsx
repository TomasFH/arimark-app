import { forwardRef, type ChangeEvent, type InputHTMLAttributes } from 'react'
import { formatDecimalInputValue } from '../lib/numericInput'

type DecimalInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'inputMode' | 'onChange' | 'value'
> & {
  value: string
  onChange: (formattedValue: string) => void
  maxDecimals?: number
  weightMode?: boolean
}

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
  },
)

export default DecimalInput
