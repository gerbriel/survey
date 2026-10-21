/**
 * Small-cell suppression for shared reports (doc 04 section 5.4): any count
 * under 3 renders as "<3" so a viewer cannot single out a respondent.
 * Decision: inside the app counts are shown as is (owner question 11.3 open).
 */
export const MIN_CELL = 3

export type MaybeSuppressed = number | '<3'

export function suppressCount(n: number | null | undefined, suppressed?: boolean): MaybeSuppressed {
  if (suppressed || n === null || n === undefined || n < MIN_CELL) return '<3'
  return n
}

export function formatCount(n: MaybeSuppressed): string {
  return typeof n === 'number' ? n.toLocaleString('en-US') : n
}
