/**
 * Standing work that ADD import never writes.
 * Types match the office backlog: tank pickup, lockout, monitor swap, meter site.
 */

export const BACKLOG_TYPES = ['tank_pickup', 'lockout', 'monitor_swap', 'meter_site'] as const
export type BacklogType = (typeof BACKLOG_TYPES)[number]

export const BACKLOG_STATUSES = ['open', 'promoted', 'complete', 'cancelled'] as const
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number]

export const BACKLOG_PRIORITIES = ['low', 'normal', 'high'] as const
export type BacklogPriority = (typeof BACKLOG_PRIORITIES)[number]

/** ADD Call Reason used when promoting a backlog item to a tentative job. Same codes as office. */
export const BACKLOG_ACTIVITY_CODES: Record<BacklogType, string> = {
  tank_pickup: 'TANK PICK UP',
  lockout: 'LOCK TANK',
  monitor_swap: 'INSTALL TANK MONITOR',
  meter_site: 'LAWN GROUNDS MAINT',
}

export const BACKLOG_TYPE_LABELS: Record<BacklogType, string> = {
  tank_pickup: 'Tank pickup',
  lockout: 'Lockout',
  monitor_swap: 'Monitor swap',
  meter_site: 'Meter site',
}

export const BACKLOG_STATUS_LABELS: Record<BacklogStatus, string> = {
  open: 'Open',
  promoted: 'Promoted',
  complete: 'Complete',
  cancelled: 'Cancelled',
}

export type BacklogItem = {
  id: number
  backlog_type: BacklogType
  campaign: string | null
  customer_number: string | null
  customer_name: string | null
  address_raw: string | null
  address_street: string | null
  address_city_state_zip: string | null
  lat: number | null
  lng: number | null
  geocode_source: string
  zone_code: string | null
  priority: BacklogPriority
  status: BacklogStatus
  promoted_job_id: number | null
  notes: string | null
  source_list: string | null
  last_verified_at: string | null
}

export type BacklogDraft = {
  id: number | null
  backlog_type: BacklogType
  campaign: string
  customer_number: string
  customer_name: string
  address_raw: string
  address_street: string
  address_city_state_zip: string
  lat: string
  lng: string
  zone_code: string
  priority: BacklogPriority
  status: BacklogStatus
  notes: string
}

export function isBacklogType(value: string): value is BacklogType {
  return (BACKLOG_TYPES as readonly string[]).includes(value)
}

export function isBacklogStatus(value: string): value is BacklogStatus {
  return (BACKLOG_STATUSES as readonly string[]).includes(value)
}

export function isBacklogPriority(value: string): value is BacklogPriority {
  return (BACKLOG_PRIORITIES as readonly string[]).includes(value)
}

export function canPromoteBacklog(item: Pick<BacklogItem, 'status' | 'promoted_job_id'>): boolean {
  return item.status === 'open' && item.promoted_job_id == null
}

export function promoteActivityCode(type: BacklogType): string {
  return BACKLOG_ACTIVITY_CODES[type]
}

export function blankBacklogDraft(): BacklogDraft {
  return {
    id: null,
    backlog_type: 'tank_pickup',
    campaign: '',
    customer_number: '',
    customer_name: '',
    address_raw: '',
    address_street: '',
    address_city_state_zip: '',
    lat: '',
    lng: '',
    zone_code: '',
    priority: 'normal',
    status: 'open',
    notes: '',
  }
}

export function draftFromBacklog(item: BacklogItem): BacklogDraft {
  return {
    id: item.id,
    backlog_type: item.backlog_type,
    campaign: item.campaign ?? '',
    customer_number: item.customer_number ?? '',
    customer_name: item.customer_name ?? '',
    address_raw: item.address_raw ?? '',
    address_street: item.address_street ?? '',
    address_city_state_zip: item.address_city_state_zip ?? '',
    lat: item.lat == null ? '' : String(item.lat),
    lng: item.lng == null ? '' : String(item.lng),
    zone_code: item.zone_code ?? '',
    priority: item.priority,
    status: item.status,
    notes: item.notes ?? '',
  }
}
