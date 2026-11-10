// Google Search ranking updates as listed on the Google Search Status Dashboard
// (status.search.google.com, Ranking history). Start date and rollout length in days, checked 2026-11-09.
export const UPDATES_CHECKED = '2026-11-09'

export interface Update { name: string; kind: 'core' | 'spam' | 'other'; start: string; days: number }

const raw: [string, string, number][] = [
  ['September 2026 spam update', '2026-09-24', 14],
  ['August 2026 spam update', '2026-08-18', 3],
  ['June 2026 spam update', '2026-06-24', 2],
  ['May 2026 core update', '2026-05-21', 12],
  ['March 2026 core update', '2026-03-27', 12],
  ['March 2026 spam update', '2026-03-24', 1],
  ['February 2026 Discover update', '2026-02-05', 22],
  ['December 2025 core update', '2025-12-11', 18],
  ['August 2025 spam update', '2025-08-26', 27],
  ['June 2025 core update', '2025-06-30', 17],
  ['March 2025 core update', '2025-03-13', 14],
  ['December 2024 spam update', '2024-12-19', 7],
  ['December 2024 core update', '2024-12-12', 6],
  ['November 2024 core update', '2024-11-11', 24],
  ['August 2024 core update', '2024-08-15', 19],
  ['June 2024 spam update', '2024-06-20', 7],
  ['March 2024 spam update', '2024-03-05', 15],
  ['March 2024 core update', '2024-03-05', 45],
  ['November 2023 reviews update', '2023-11-08', 29],
  ['November 2023 core update', '2023-11-02', 26],
  ['October 2023 core update', '2023-10-05', 14],
  ['October 2023 spam update', '2023-10-04', 16],
  ['September 2023 helpful content update', '2023-09-14', 14],
  ['August 2023 core update', '2023-08-22', 16],
  ['March 2023 core update', '2023-03-15', 13],
]

export const UPDATES: Update[] = raw.map(([name, start, days]) => ({ name, start, days, kind: /core/.test(name) ? 'core' : /spam/.test(name) ? 'spam' : 'other' }))

export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
export const updateEnd = (u: Update) => addDays(u.start, u.days)

/** Updates whose rollout (plus a week of settling) overlaps [from, to]. */
export function updatesNear(from: string, to: string, list = UPDATES): Update[] {
  return list.filter(u => u.start <= to && addDays(updateEnd(u), 7) >= from)
}
