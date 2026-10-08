/**
 * Fredericksburg yard pin. Same coordinates as office `src/lib/yard.ts`
 * (CEO-confirmed GPS, 2026-09-14). Copied here so Local does not import office code.
 */
export const YARD = {
  id: 'tiger-fuel-yard',
  label: 'Yard',
  name: 'Tiger Fuel yard / office',
  address: '1600 Beulah Salisbury Dr, Fredericksburg, VA',
  lat: 38.284478,
  lng: -77.4529472,
  source: 'ceo-confirmed-gps' as const,
}
