import { ICON_BODIES, type IconName } from '../lib/icon-paths.ts'

/**
 * Inline SVG icon. Bodies are static strings from icon-paths.ts, never user
 * input. Decorative unless a `label` is passed.
 */
export function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  label,
  className = '',
}: {
  name: IconName
  size?: number
  strokeWidth?: number
  label?: string
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: ICON_BODIES[name] }}
    />
  )
}
