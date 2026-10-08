/**
 * Crow-flies drive estimate constants (Step 1 — no Google calls).
 *
 * Leg hours = (haversine miles × DRIVE_ROAD_FACTOR) / DRIVE_SPEED_MPH.
 * Step 2 can swap Google Routes API times behind the same DriveHoursProvider
 * without changing Calendar / Best days UI.
 */
export const DRIVE_ROAD_FACTOR = 1.3
export const DRIVE_SPEED_MPH = 35
