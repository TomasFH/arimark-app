interface Props {
  checked: boolean
  onChange: () => void
  disabled?: boolean
}

export default function CatalogToggle({ checked, onChange, disabled }: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'bg-green-600' : 'bg-zinc-600'}`}
      role="switch"
      aria-checked={checked}
      aria-busy={disabled || undefined}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}
