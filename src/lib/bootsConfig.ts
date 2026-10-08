/**
 * Dirty-boots sequence rules (UG/piping before inside work).
 *
 * Same matching style as jobDurations.ts: case-insensitive substring
 * needles on activity codes / notes / template hints via jobTypeHaystacks.
 * Keep this file next to jobDurations.ts.
 */

export type BootsMatchRule = {
  /** Human label for this bucket (documentation / tests). */
  label: string
  /**
   * Case-insensitive substring needles. A job matches when any haystack
   * string contains any needle. More specific rules must come first.
   */
  contains: readonly string[]
}

/**
 * DIRTY = outdoor / trench work that leaves muddy boots.
 * UG tank install + piping / line runs.
 */
export const DIRTY_BOOTS_RULES: readonly BootsMatchRule[] = [
  {
    label: 'Underground tank install',
    contains: [
      'tank install (ug)',
      'tank install ug',
      'underground tank',
      'ug tank install',
      'install ug',
    ],
  },
  {
    label: 'Line / piping run',
    contains: [
      'pipe house',
      'piping',
      'line run',
      'gas line',
      'pipe run',
      'run line',
    ],
  },
]

/**
 * INSIDE = in-home work that should not follow dirty outdoor work
 * without a boots change / clean stop.
 */
export const INSIDE_BOOTS_RULES: readonly BootsMatchRule[] = [
  {
    label: 'Appliance connect / convert',
    contains: [
      'appliance (convert)',
      'appliance convert',
      'appliance (connect)',
      'appliance connect',
      'appliance (install)',
      'appliance install',
      'hook up appliance',
      'connect appliance',
    ],
  },
  {
    label: 'Appliance service / check',
    contains: [
      'appliance (service)',
      'appliance service',
      'appliance check',
      'service call',
      'gas check',
    ],
  },
  {
    label: 'Fireplace / gas log cleaning or service',
    contains: [
      'fireplace',
      'gas log',
      'gas logs',
      'fp clean',
      'fp cleaning',
      'fp service',
      'prev maint',
      'preventive maint',
    ],
  },
]
