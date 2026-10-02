import type { ImgHTMLAttributes } from 'react'
import brandMarkUrl from '../../assets/brand-mark.jpg'
import { cx } from './cx'

export interface BrandMarkProps extends ImgHTMLAttributes<HTMLImageElement> {
  size?: number
}

/**
 * Marca cuadrada de los lugares chicos (login, riel del POS, cabecera).
 * El archivo es la imagen elegida; no se redibuja.
 */
export function BrandMark({ size = 32, className, ...rest }: BrandMarkProps) {
  return (
    <img
      src={brandMarkUrl}
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
      className={cx('shrink-0 rounded-[25%] object-cover', className)}
      {...rest}
    />
  )
}
