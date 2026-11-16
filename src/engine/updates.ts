// Google Search ranking updates as listed on the Google Search Status Dashboard
// (status.search.google.com, Ranking history). Start date and rollout length in days, checked 2026-11-13.
// The app also reads the dashboard's public feed at load, so newer updates appear without a release.
export const UPDATES_CHECKED = '2026-11-13'
export const UPDATES_FEED = 'https://status.search.google.com/incidents.json'

export interface Update { name: string; kind: 'core' | 'spam' | 'other'; start: string; days: number; ongoing?: boolean }

const raw: [string, string, number][] = [
  // Still rolling out when checked; Google said up to 2 weeks.
  ['November 2026 core update', '2026-11-10', 14],
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

const kindOf = (name: string): Update['kind'] => /core/i.test(name) && !/discover/i.test(name) ? 'core' : /spam/i.test(name) ? 'spam' : 'other'
export const BUILT_IN: Update[] = raw.map(([name, start, days]) => ({ name, start, days, kind: kindOf(name), ...(name === 'November 2026 core update' ? { ongoing: true } : {}) }))

/** The list every timeline and diagnosis reads: the built-in table until the live feed has been merged in. */
export let UPDATES: Update[] = BUILT_IN
export let updatesLive = false

/**
 * Ranking incidents from the Search Status Dashboard feed. An incident with no end date is still rolling out:
 * its length runs to today, or to the "up to N weeks" Google announced if that is longer.
 */
export function fromIncidents(json: unknown, today: string): Update[] {
  if (!Array.isArray(json)) return []
  const out: Update[] = []
  for (const i of json as { begin?: string; end?: string; external_desc?: string; service_name?: string; updates?: { text?: string }[] }[]) {
    if (i?.service_name !== 'Ranking' || typeof i.begin !== 'string' || typeof i.external_desc !== 'string' || !/update/i.test(i.external_desc)) continue
    const start = i.begin.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue
    const span = (to: string) => Math.max(1, Math.round((Date.parse(to) - Date.parse(start)) / 86400000))
    if (typeof i.end === 'string') { out.push({ name: i.external_desc, start, days: span(i.end.slice(0, 10)), kind: kindOf(i.external_desc) }); continue }
    const said = (i.updates ?? []).map(u => u.text?.match(/up to (\d+|a|one|two|three|four) weeks?/i)?.[1].toLowerCase()).find(Boolean)
    const weeks = said ? ({ a: 1, one: 1, two: 2, three: 3, four: 4 } as Record<string, number>)[said] ?? +said : 0
    out.push({ name: i.external_desc, start, days: Math.max(span(today), weeks * 7), kind: kindOf(i.external_desc), ongoing: true })
  }
  return out
}

/** Feed entries replace built-in ones of the same name; everything is kept newest first. */
export function mergeUpdates(base: Update[], live: Update[]): Update[] {
  const m = new Map(base.map(u => [u.name, u]))
  for (const u of live) m.set(u.name, u)
  return [...m.values()].sort((a, b) => b.start.localeCompare(a.start) || a.name.localeCompare(b.name))
}

const listeners = new Set<() => void>()
let loading: Promise<void> | null = null
/** Fetches the public feed once per page load. Any failure leaves the built-in table in place. */
export function loadLiveUpdates(): Promise<void> {
  return loading ??= fetch(UPDATES_FEED).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status)))).then(json => {
    const live = fromIncidents(json, new Date().toISOString().slice(0, 10))
    if (!live.length) return
    UPDATES = mergeUpdates(BUILT_IN, live)
    updatesLive = true
    for (const l of listeners) l()
  }).catch(() => {})
}
export const subscribeUpdates = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
export const updateEnd = (u: Update) => addDays(u.start, u.days)

/** Updates whose rollout (plus a week of settling) overlaps [from, to]. */
export function updatesNear(from: string, to: string, list = UPDATES): Update[] {
  return list.filter(u => u.start <= to && addDays(updateEnd(u), 7) >= from)
}
