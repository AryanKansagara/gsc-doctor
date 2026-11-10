import { ctr, DIMS, pos, type Agg, type Dim, type Fact, type Settings } from './types.ts'
import { addDays, updatesNear, type Update } from './updates.ts'

// ---------- Windows ----------

export interface Win { key: string; label: string; cur: [string, string] | null; prev: [string, string] | null; days: number }

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
const monthEnd = (m: string) => addDays(`${nextMonth(m)}-01`, -1)
export const nextMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}` }
export const prevMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}` }
export const fmtMonth = (m: string) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export function dateBounds(ds: Fact[]): [string, string] | null {
  let lo = '', hi = ''
  for (const f of ds) if (f.date) { if (!lo || f.date < lo) lo = f.date; if (!hi || f.date > hi) hi = f.date }
  return lo ? [lo, hi] : null
}

/** Window choices: rolling 28 days / 3 months, each complete calendar month, or the undated export as-is. */
export function windowOptions(ds: Fact[]): string[] {
  const b = dateBounds(ds)
  const out: string[] = []
  if (b) {
    out.push('l28')
    if (dayDiff(b[0], b[1]) >= 90) out.push('l3m')
    let m = b[1].slice(0, 7)
    if (monthEnd(m) > b[1]) m = prevMonth(m)
    while (`${m}-01` >= b[0]) { out.push(m); m = prevMonth(m) }
  }
  if (ds.some(f => !f.date)) out.push('export')
  return out.length ? out : ['export']
}

export function resolveWindow(ds: Fact[], key: string): Win {
  const b = dateBounds(ds)
  if (key === 'export' || !b) {
    // Undated exports: the Dates table (if any) tells how long the period was; Search Console defaults to 3 months.
    const dated = ds.filter(f => f.g === '' && f.date && f.period !== 'prev')
    const days = dated.length ? new Set(dated.map(f => f.date)).size : 90
    return { key: 'export', label: 'Imported export period', cur: null, prev: null, days }
  }
  const roll = (n: number, label: string): Win => {
    const cur: [string, string] = [addDays(b[1], -(n - 1)), b[1]]
    return { key, label, cur, prev: [addDays(cur[0], -n), addDays(cur[0], -1)], days: n }
  }
  if (key === 'l28') return roll(28, 'Last 28 days')
  if (key === 'l3m') return roll(91, 'Last 3 months')
  const cur: [string, string] = [`${key}-01`, monthEnd(key)]
  const p = prevMonth(key)
  return { key, label: fmtMonth(key), cur, prev: [`${p}-01`, monthEnd(p)], days: dayDiff(cur[0], cur[1]) + 1 }
}

/** Month (YYYY-MM) a window belongs to, used to key monthly snapshots. */
export const windowMonth = (w: Win, ds: Fact[]) => w.cur ? w.cur[1].slice(0, 7) : (dateBounds(ds)?.[1] ?? new Date().toISOString()).slice(0, 7)

// ---------- Slicing and aggregation ----------

const GRAIN_PREF = ['', 'device', 'country', 'page', 'query']
const grainDims = (g: string) => g ? g.split('|') as Dim[] : []

/** Picks the coarsest grain that has every requested dimension. */
export function pickGrain(ds: Fact[], dims: Dim[]): string | null {
  const grains = [...new Set(ds.map(f => f.g))].filter(g => dims.every(d => grainDims(g).includes(d)))
  if (!grains.length) return null
  const rank = (g: string) => grainDims(g).length * 10 + (GRAIN_PREF.includes(g) ? GRAIN_PREF.indexOf(g) : 9)
  return grains.sort((a, b) => rank(a) - rank(b))[0]
}

export interface Slice { cur: Map<string, Agg>; prev: Map<string, Agg>; grain: string | null; dated: boolean }

export const keyOf = (f: Partial<Record<Dim, string>>, dims: Dim[]) => dims.map(d => f[d] ?? '').join('\u0001')

function add(m: Map<string, Agg>, f: Fact, dims: Dim[]) {
  const key = keyOf(f, dims)
  let a = m.get(key)
  if (!a) { a = { key, dims: Object.fromEntries(dims.map(d => [d, f[d]])), clicks: 0, impressions: 0, posSum: 0 }; m.set(key, a) }
  a.clicks += f.clicks
  a.impressions += f.impressions
  a.posSum += f.position * f.impressions
}

export function slice(ds: Fact[], dims: Dim[], w: Win, filter?: (f: Fact) => boolean): Slice {
  const grain = pickGrain(ds, dims)
  const cur = new Map<string, Agg>(), prev = new Map<string, Agg>()
  if (grain === null) return { cur, prev, grain, dated: false }
  const rows = ds.filter(f => f.g === grain && (!filter || filter(f)))
  const dated = !!w.cur && rows.some(f => f.date)
  for (const f of rows) {
    if (dated) {
      if (!f.date) continue
      if (f.date >= w.cur![0] && f.date <= w.cur![1]) add(cur, f, dims)
      else if (f.date >= w.prev![0] && f.date <= w.prev![1]) add(prev, f, dims)
    } else if (f.date && w.cur === null && f.period !== 'prev') {
      // Undated window on dated rows (e.g. the Dates table next to a UI export): use everything.
      add(cur, f, dims)
    } else if (!f.date) add(f.period === 'prev' ? prev : cur, f, dims)
  }
  return { cur, prev, grain, dated }
}

export const total = (m: Map<string, Agg>) => {
  let clicks = 0, impressions = 0, posSum = 0
  for (const a of m.values()) { clicks += a.clicks; impressions += a.impressions; posSum += a.posSum }
  return { clicks, impressions, posSum }
}

// ---------- Brand and page groups ----------

export function brandMatcher(terms: string[]) {
  const t = terms.map(x => x.trim().toLowerCase()).filter(Boolean)
  if (!t.length) return () => false
  const squashed = t.map(x => x.replace(/[\s\-_.&']/g, ''))
  return (q: string) => { const l = q.toLowerCase(); const s = l.replace(/[\s\-_.&']/g, ''); return t.some(x => l.includes(x)) || squashed.some(x => x && s.includes(x)) }
}

/** /blog/how-to-x/ at depth 1 -> /blog/. Pages directly under the root share one "top level" group. */
export function pageGroup(url: string, depth = 1): string {
  const path = url.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '') || '/'
  const segs = path.split('/').filter(Boolean)
  if (!segs.length) return '/'
  const dirs = path.endsWith('/') ? segs.slice(0, -1) : segs.slice(0, -1)
  if (!dirs.length) return '/* (top level)'
  return '/' + dirs.slice(0, depth).join('/') + '/'
}

export const shortUrl = (u: string) => u.replace(/^https?:\/\/[^/]+/i, '') || '/'

// ---------- Expected CTR curve ----------

export interface Curve { kind: 'isotonic' | 'log' | 'prior'; knots: { pos: number; ctr: number; imp: number }[] }

const EDGES = [1, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 13.5, 16.5, 20.5, 30.5, 50.5, 101]
const PRIOR: [number, number][] = [[1, .28], [2, .155], [3, .1], [4, .07], [5, .052], [6, .04], [7, .032], [8, .026], [9, .021], [10, .018], [15, .009], [20, .006], [40, .003]]

/** Pool-adjacent-violators: weighted non-increasing fit. */
export function isotonicDecreasing(y: number[], w: number[]): number[] {
  const blocks: { v: number; w: number; n: number }[] = []
  for (let i = 0; i < y.length; i++) {
    blocks.push({ v: y[i], w: w[i], n: 1 })
    while (blocks.length > 1 && blocks[blocks.length - 2].v < blocks[blocks.length - 1].v) {
      const b = blocks.pop()!, a = blocks.pop()!
      blocks.push({ v: (a.v * a.w + b.v * b.w) / (a.w + b.w), w: a.w + b.w, n: a.n + b.n })
    }
  }
  return blocks.flatMap(b => Array(b.n).fill(b.v))
}

/** Fits the site's own CTR-by-position curve from (position, clicks, impressions) points, impression weighted. */
export function fitCurve(points: { pos: number; clicks: number; imp: number }[], minBinImp = 50): Curve {
  // Each query's CTR is weighted by sqrt(impressions) so one huge query (or one page with a bad title) cannot define a bin.
  const bins = EDGES.slice(0, -1).map(() => ({ cw: 0, w: 0, i: 0, ps: 0 }))
  for (const p of points) {
    if (!(p.imp > 0) || !(p.pos >= 1)) continue
    let k = EDGES.findIndex((e, j) => p.pos >= e && p.pos < EDGES[j + 1])
    if (k < 0) k = bins.length - 1
    const w = Math.sqrt(p.imp)
    bins[k].cw += (p.clicks / p.imp) * w; bins[k].w += w; bins[k].i += p.imp; bins[k].ps += p.pos * w
  }
  const good = bins.filter(b => b.i >= minBinImp)
  if (good.length >= 4) {
    const fit = isotonicDecreasing(good.map(b => b.cw / b.w), good.map(b => b.w))
    return { kind: 'isotonic', knots: good.map((b, j) => ({ pos: b.ps / b.w, ctr: fit[j], imp: b.i })) }
  }
  // Sparse data: weighted least squares of CTR on ln(position).
  const pts = points.filter(p => p.imp > 0 && p.pos >= 1)
  const W = pts.reduce((s, p) => s + p.imp, 0)
  if (pts.length >= 3 && W >= 100) {
    const mx = pts.reduce((s, p) => s + Math.log(p.pos) * p.imp, 0) / W
    const my = pts.reduce((s, p) => s + p.clicks, 0) / W
    let sxy = 0, sxx = 0
    for (const p of pts) { const dx = Math.log(p.pos) - mx; sxy += dx * (p.clicks / p.imp - my) * p.imp; sxx += dx * dx * p.imp }
    const b = sxx ? Math.min(0, sxy / sxx) : 0
    if (b < 0) return { kind: 'log', knots: [1, 2, 3, 5, 7, 10, 15, 20, 30, 50].map(x => ({ pos: x, ctr: Math.max(0.001, Math.min(1, my + b * (Math.log(x) - mx))), imp: 0 })) }
  }
  return { kind: 'prior', knots: PRIOR.map(([p, c]) => ({ pos: p, ctr: c, imp: 0 })) }
}

/** Expected CTR at a position: interpolated on log(position) between knots, flat beyond the ends. */
export function expectedCtr(c: Curve, p: number): number {
  const k = c.knots
  if (!k.length || !Number.isFinite(p)) return 0
  if (p <= k[0].pos) return k[0].ctr
  if (p >= k[k.length - 1].pos) return k[k.length - 1].ctr
  for (let i = 1; i < k.length; i++) if (p <= k[i].pos) {
    const t = (Math.log(p) - Math.log(k[i - 1].pos)) / (Math.log(k[i].pos) - Math.log(k[i - 1].pos) || 1)
    return k[i - 1].ctr + t * (k[i].ctr - k[i - 1].ctr)
  }
  return k[k.length - 1].ctr
}

// ---------- Robust trend ----------

/** Theil–Sen slope: median of all pairwise slopes. Robust to a single spike month. */
export function theilSen(y: number[]): number {
  const s: number[] = []
  for (let i = 0; i < y.length; i++) for (let j = i + 1; j < y.length; j++) s.push((y[j] - y[i]) / (j - i))
  return median(s)
}
export const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

// ---------- Query points, CTR gaps, striking distance ----------

export interface QueryPoint { query: string; page?: string; clicks: number; impressions: number; position: number; ctr: number; expected: number; gap: number; branded: boolean; pages: number }

/** One point per query (its top page attached when the data has query + page). Monthly-normalised gap = clicks lost to a low CTR. */
export function queryPoints(ds: Fact[], w: Win, curve: Curve | null, isBrand: (q: string) => boolean): QueryPoint[] {
  const qp = pickGrain(ds, ['query', 'page'])
  const perMonth = 30.44 / w.days
  const top = new Map<string, { page: string; imp: number; n: number }>()
  if (qp) for (const a of slice(ds, ['query', 'page'], w).cur.values()) {
    const t = top.get(a.dims.query!)
    if (!t) top.set(a.dims.query!, { page: a.dims.page!, imp: a.impressions, n: 1 })
    else { t.n++; if (a.impressions > t.imp) { t.page = a.dims.page!; t.imp = a.impressions } }
  }
  return [...slice(ds, ['query'], w).cur.values()].map(a => {
    const p = pos(a), c = ctr(a), e = curve ? expectedCtr(curve, p) : 0
    const t = top.get(a.dims.query!)
    return { query: a.dims.query!, page: t?.page, pages: t?.n ?? 0, clicks: a.clicks * perMonth, impressions: a.impressions * perMonth, position: p, ctr: c, expected: e, gap: Math.max(0, e - c) * a.impressions * perMonth, branded: isBrand(a.dims.query!) }
  })
}

/** The site's curve, fitted on up to 6 months ending with the window (one bad month or one drop cannot flatten it). Brand queries excluded. */
export function siteCurve(ds: Fact[], w: Win, isBrand: (q: string) => boolean, months = 6): Curve {
  const fitWin: Win = w.cur ? { ...w, cur: [addDays(w.cur[1], -Math.round(months * 30.44) + 1), w.cur[1]], prev: ['0000-00-00', '0000-00-00'] } : w
  // One point per query per month, so a query that moved from position 3 to 9 counts as two points, not one at 6.
  const grain = pickGrain(ds, ['query'])
  const m = new Map<string, { pos: number; clicks: number; imp: number }>()
  const sl = slice(ds, ['query'], fitWin)
  if (!sl.dated) for (const a of sl.cur.values()) m.set(a.key, { pos: pos(a), clicks: a.clicks, imp: a.impressions })
  else for (const f of ds) {
    if (f.g !== grain || !f.date || f.date < fitWin.cur![0] || f.date > fitWin.cur![1] || isBrand(f.query!)) continue
    const k = f.query + '\u0001' + f.date.slice(0, 7)
    const r = m.get(k) ?? { pos: 0, clicks: 0, imp: 0 }
    r.pos += f.position * f.impressions; r.clicks += f.clicks; r.imp += f.impressions
    m.set(k, r)
  }
  const pts = [...m.entries()].filter(([k]) => !isBrand(k.split('\u0001')[0])).map(([, r]) => sl.dated ? { ...r, pos: r.imp ? r.pos / r.imp : NaN } : r)
  return fitCurve(pts)
}

export const strikingDistance = (pts: QueryPoint[], curve: Curve, minImp: number) =>
  pts.filter(p => p.position >= 8 && p.position <= 20 && p.impressions >= minImp && !p.branded)
    .map(p => ({ ...p, target: 5, potential: Math.max(0, expectedCtr(curve, 5) - p.ctr) * p.impressions }))
    .sort((a, b) => b.potential - a.potential)

export const ctrGaps = (pts: QueryPoint[], minImp: number) =>
  pts.filter(p => p.position < 8 && p.impressions >= minImp * 2 && p.ctr < 0.75 * p.expected && !p.branded).sort((a, b) => b.gap - a.gap)

// ---------- Cannibalisation ----------

export interface Cannibal {
  query: string
  pages: { page: string; clicks: number; impressions: number; position: number; share: number; topWeeks: number }[]
  canonical: string
  split: number
  flipRate: number
  score: number
  clicks: number
  impressions: number
  gain: number
  weeks: number
}

const weekOf = (iso: string) => { const t = Date.parse(iso + 'T00:00:00Z'); const d = (new Date(t).getUTCDay() + 6) % 7; return new Date(t - d * 86400000).toISOString().slice(0, 10) }

/**
 * A query where several pages split impressions, and which page Google shows keeps changing week to week.
 * Score 0-100 = 60% how evenly impressions are split (normalised 1 - HHI) + 40% weekly flip rate of the leading page.
 */
export function cannibalisation(ds: Fact[], w: Win, curve: Curve, opts: { minImp: number; isBrand: (q: string) => boolean; lookbackDays?: number }): Cannibal[] {
  const grain = pickGrain(ds, ['query', 'page'])
  if (!grain) return []
  const perMonth = 30.44 / w.days
  const cur = slice(ds, ['query', 'page'], w).cur
  const byQuery = new Map<string, Agg[]>()
  for (const a of cur.values()) { const l = byQuery.get(a.dims.query!) ?? []; l.push(a); byQuery.set(a.dims.query!, l) }
  // Weekly leader per query over the lookback window (default 12 weeks), for flip-flops.
  const end = w.cur?.[1]
  const from = end ? addDays(end, -(opts.lookbackDays ?? 84) + 1) : ''
  const weekly = new Map<string, Map<string, Map<string, number>>>()
  if (end) for (const f of ds) {
    if (f.g !== grain || !f.date || f.date < from || f.date > end || !byQuery.has(f.query!)) continue
    const q = weekly.get(f.query!) ?? new Map(); weekly.set(f.query!, q)
    const wk = weekOf(f.date)
    const m = q.get(wk) ?? new Map<string, number>(); q.set(wk, m)
    m.set(f.page!, (m.get(f.page!) ?? 0) + f.impressions)
  }
  const out: Cannibal[] = []
  for (const [query, list] of byQuery) {
    if (opts.isBrand(query)) continue
    const imp = list.reduce((s, a) => s + a.impressions, 0)
    if (imp * perMonth < opts.minImp) continue
    const pages = list.filter(a => a.impressions / imp >= 0.1).sort((a, b) => b.clicks - a.clicks || pos(a) - pos(b))
    if (pages.length < 2) continue
    const pImp = pages.reduce((s, a) => s + a.impressions, 0)
    const shares = pages.map(a => a.impressions / pImp)
    const hhi = shares.reduce((s, x) => s + x * x, 0)
    const split = (1 - hhi) / (1 - 1 / pages.length)
    const weeks = [...(weekly.get(query) ?? new Map()).entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const leaders = weeks.map(([, m]) => [...m.entries()].sort((a, b) => b[1] - a[1])[0][0])
    let flips = 0
    for (let i = 1; i < leaders.length; i++) if (leaders[i] !== leaders[i - 1]) flips++
    const flipRate = leaders.length > 1 ? flips / (leaders.length - 1) : 0
    const score = Math.round(100 * (0.6 * split + 0.4 * flipRate))
    if (score < 35) continue
    const clicks = list.reduce((s, a) => s + a.clicks, 0)
    const best = Math.min(...pages.map(a => pos(a)))
    out.push({
      query, canonical: pages[0].dims.page!, split, flipRate, score, weeks: leaders.length,
      clicks: clicks * perMonth, impressions: imp * perMonth,
      gain: Math.max(0, imp * expectedCtr(curve, best) - clicks) * perMonth,
      pages: pages.map((a, i) => ({ page: a.dims.page!, clicks: a.clicks * perMonth, impressions: a.impressions * perMonth, position: pos(a), share: shares[i], topWeeks: leaders.filter(l => l === a.dims.page).length })),
    })
  }
  return out.sort((a, b) => b.gain - a.gain || b.score - a.score)
}

export interface Redirect { from: string; to: string; action: '301' | 'canonical'; reason: string; queries: string[] }
export interface CannibalCluster { canonical: string; pages: string[]; queries: string[]; gain: number; items: Cannibal[] }

/** Pages linked by any contested query form one cluster; its canonical is the page with the most clicks on those queries. */
export function cannibalClusters(cans: Cannibal[]): CannibalCluster[] {
  const parent = new Map<string, string>()
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r }
  for (const c of cans) for (const p of c.pages) { if (!parent.has(p.page)) parent.set(p.page, p.page); parent.set(find(p.page), find(c.pages[0].page)) }
  const groups = new Map<string, Cannibal[]>()
  for (const c of cans) { const r = find(c.pages[0].page); groups.set(r, [...(groups.get(r) ?? []), c]) }
  return [...groups.values()].map(items => {
    const clicks = new Map<string, { c: number; p: number }>()
    for (const c of items) for (const p of c.pages) { const r = clicks.get(p.page) ?? { c: 0, p: 99 }; r.c += p.clicks; r.p = Math.min(r.p, p.position); clicks.set(p.page, r) }
    const pages = [...clicks.entries()].sort((a, b) => b[1].c - a[1].c || a[1].p - b[1].p).map(x => x[0])
    return { canonical: pages[0], pages, queries: items.map(c => c.query), gain: items.reduce((s, c) => s + c.gain, 0), items }
  }).sort((a, b) => b.gain - a.gain)
}

/**
 * Losing pages -> the cluster canonical. A 301 when most of the losing page's clicks come from the contested queries
 * (it has little traffic of its own); otherwise keep it, point a canonical or internal links at the winner, and de-optimise.
 */
export function redirectPlan(clusters: CannibalCluster[], pageClicks: Map<string, number>): Redirect[] {
  const out: Redirect[] = []
  for (const cl of clusters) for (const page of cl.pages.slice(1)) {
    const items = cl.items.filter(c => c.pages.some(p => p.page === page))
    const contested = items.reduce((s, c) => s + (c.pages.find(p => p.page === page)?.clicks ?? 0), 0)
    const own = Math.max(contested, pageClicks.get(page) ?? contested)
    const share = own > 0 ? contested / own : 1
    const base = { from: page, to: cl.canonical, queries: items.map(c => c.query) }
    out.push(share >= 0.5
      ? { ...base, action: '301', reason: `${Math.round(share * 100)}% of its clicks come from queries ${shortUrl(cl.canonical)} also ranks for. Merge the useful content, then 301.` }
      : { ...base, action: 'canonical', reason: `Only ${Math.round(share * 100)}% of its clicks are contested, so keep it: add rel=canonical or internal links to ${shortUrl(cl.canonical)} and retarget its title away from these queries.` })
  }
  return out
}

export const redirectCsv = (rs: Redirect[]) => ['from,to,action,reason,queries', ...rs.map(r => [r.from, r.to, r.action, r.reason, r.queries.join('; ')].map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(','))].join('\n') + '\n'

// ---------- Content decay ----------

export interface Decay { page: string; months: string[]; series: number[]; slope: number; change: number; baseline: number; last: number; pattern: 'steady' | 'step'; gain: number; lost: { query: string; before: number; after: number; posBefore: number; posAfter: number }[] }

/** Monthly clicks per page over the last N complete months; flags pages whose Theil–Sen trend lost 25%+ of their baseline. */
export function contentDecay(ds: Fact[], endMonth: string, months: number, minLoss = 20): Decay[] {
  const grain = pickGrain(ds, ['page'])
  if (!grain) return []
  const ms: string[] = [endMonth]
  while (ms.length < months) ms.unshift(prevMonth(ms[0]))
  const idx = new Map(ms.map((m, i) => [m, i]))
  const b = dateBounds(ds.filter(f => f.g === grain))
  if (!b || b[0] > `${ms[0]}-07`) return []
  const series = new Map<string, number[]>()
  for (const f of ds) {
    if (f.g !== grain || !f.date) continue
    const i = idx.get(f.date.slice(0, 7))
    if (i === undefined) continue
    const s = series.get(f.page!) ?? Array(ms.length).fill(0)
    s[i] += f.clicks
    series.set(f.page!, s)
  }
  const out: Decay[] = []
  for (const [page, s] of series) {
    const half = Math.max(1, Math.floor(s.length / 2))
    const baseline = median(s.slice(0, half))
    const last = s[s.length - 1]
    const slope = theilSen(s)
    const change = baseline > 0 ? slope * (s.length - 1) / baseline : 0
    if (change > -0.25 || baseline - last < minLoss) continue
    const drops = s.slice(1).map((v, i) => s[i] - v)
    const pattern = Math.max(...drops) > 0.6 * (s[0] - last) ? 'step' : 'steady'
    out.push({ page, months: ms, series: s, slope, change, baseline, last, pattern, gain: 0.5 * (baseline - last), lost: [] })
  }
  // Queries lost: per page, query clicks in the first half vs the last month.
  const qp = pickGrain(ds, ['query', 'page'])
  if (qp && out.length) {
    const want = new Set(out.map(d => d.page))
    const firstHalf = new Set(ms.slice(0, Math.max(1, Math.floor(ms.length / 2))))
    const acc = new Map<string, { b: number; a: number; bi: number; ai: number; bp: number; ap: number }>()
    for (const f of ds) {
      if (f.g !== qp || !f.date || !want.has(f.page!)) continue
      const m = f.date.slice(0, 7)
      const isB = firstHalf.has(m), isA = m === endMonth
      if (!isB && !isA) continue
      const k = f.page + '\u0001' + f.query
      const r = acc.get(k) ?? { b: 0, a: 0, bi: 0, ai: 0, bp: 0, ap: 0 }
      if (isB) { r.b += f.clicks; r.bi += f.impressions; r.bp += f.position * f.impressions } else { r.a += f.clicks; r.ai += f.impressions; r.ap += f.position * f.impressions }
      acc.set(k, r)
    }
    const n = firstHalf.size
    for (const d of out) {
      d.lost = [...acc.entries()].filter(([k]) => k.startsWith(d.page + '\u0001'))
        .map(([k, r]) => ({ query: k.split('\u0001')[1], before: r.b / n, after: r.a, posBefore: r.bi ? r.bp / r.bi : NaN, posAfter: r.ai ? r.ap / r.ai : NaN }))
        .filter(x => x.before - x.after > 1).sort((x, y) => (y.before - y.after) - (x.before - x.after)).slice(0, 8)
    }
  }
  return out.sort((a, b) => b.gain - a.gain)
}

// ---------- Drop diagnosis ----------

export interface Parts { clicks: number; impressions: number; position: number }
export interface DropRow { key: string; prev: Parts; cur: Parts; delta: number; demand: number; rank: number; ctr: number; cause: 'demand' | 'rank' | 'ctr' }

/**
 * Splits a change in clicks into three parts that add up exactly:
 * demand (impressions at the old CTR), rank (the CTR change the expected curve predicts from the position move)
 * and CTR (whatever is left: titles, snippets, SERP features).
 */
export function decompose(prev: Parts, cur: Parts, curve: Curve): Omit<DropRow, 'key' | 'prev' | 'cur'> {
  const delta = cur.clicks - prev.clicks
  if (!prev.impressions) return { delta, demand: delta, rank: 0, ctr: 0, cause: 'demand' }
  const c0 = prev.clicks / prev.impressions
  const demand = (cur.impressions - prev.impressions) * c0
  let rank = 0
  if (cur.impressions) {
    const e0 = expectedCtr(curve, prev.position), e1 = expectedCtr(curve, cur.position)
    rank = e0 > 0 ? cur.impressions * c0 * (e1 / e0 - 1) : 0
  }
  const ctrPart = delta - demand - rank
  const parts = { demand, rank, ctr: ctrPart }
  const cause = (Object.keys(parts) as (keyof typeof parts)[]).sort((a, b) => (delta < 0 ? parts[a] - parts[b] : parts[b] - parts[a]))[0]
  return { delta, demand, rank, ctr: ctrPart, cause }
}

const parts = (a?: Agg): Parts => a ? { clicks: a.clicks, impressions: a.impressions, position: pos(a) } : { clicks: 0, impressions: 0, position: NaN }

export interface Diagnosis {
  total: DropRow
  rel: number
  by: Partial<Record<Dim | 'group' | 'brand', DropRow[]>>
  scope: 'none' | 'sitewide' | 'cluster' | 'mixed'
  scopeText: string
  cluster?: string
  changePoint?: { date: string; before: number; after: number; rel: number }
  updates: Update[]
  window: { cur: [string, string] | null; prev: [string, string] | null }
}

/** Daily clicks from the coarsest dated grain. */
export function dailyTotals(ds: Fact[]): { date: string; clicks: number; impressions: number }[] {
  const grains = [...new Set(ds.filter(f => f.date).map(f => f.g))]
  if (!grains.length) return []
  const g = grains.sort((a, b) => grainDims(a).length - grainDims(b).length || GRAIN_PREF.indexOf(a) - GRAIN_PREF.indexOf(b))[0]
  const m = new Map<string, { clicks: number; impressions: number }>()
  for (const f of ds) if (f.g === g && f.date) { const r = m.get(f.date) ?? { clicks: 0, impressions: 0 }; r.clicks += f.clicks; r.impressions += f.impressions; m.set(f.date, r) }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, r]) => ({ date, ...r }))
}

/** The day where the 14-day average after falls furthest below the 14-day average before. */
export function changePoint(daily: { date: string; clicks: number }[], span = 14, threshold = -0.15) {
  let best: { date: string; before: number; after: number; rel: number } | undefined
  for (let i = span; i + span <= daily.length; i++) {
    const before = daily.slice(i - span, i).reduce((s, d) => s + d.clicks, 0) / span
    const after = daily.slice(i, i + span).reduce((s, d) => s + d.clicks, 0) / span
    if (!before) continue
    const rel = (after - before) / before
    if (rel <= threshold && (!best || rel < best.rel)) best = { date: daily[i].date, before, after, rel }
  }
  return best
}

/** Before/after windows around a detected drop, skipping the rollout fortnight itself. */
export function dropWindow(ds: Fact[]): Win | null {
  const cp = changePoint(dailyTotals(ds))
  if (!cp) return null
  const prev: [string, string] = [addDays(cp.date, -28), addDays(cp.date, -1)]
  const cur: [string, string] = [addDays(cp.date, 14), addDays(cp.date, 41)]
  const b = dateBounds(ds)!
  if (cur[1] > b[1]) { cur[1] = b[1]; if (cur[0] > cur[1]) cur[0] = addDays(cp.date, 7) }
  return { key: 'drop', label: `Around the drop on ${cp.date}`, cur, prev, days: dayDiff(cur[0], cur[1]) + 1 }
}

export function diagnose(ds: Fact[], w: Win, curve: Curve, s: Pick<Settings, 'groupDepth'>, isBrand: (q: string) => boolean): Diagnosis {
  const rowsFor = (dims: Dim[], keyFn?: (a: Agg) => string): DropRow[] => {
    const sl = slice(ds, dims, w)
    if (sl.grain === null || !sl.prev.size) return []
    let cur = sl.cur, prev = sl.prev
    if (keyFn) {
      const regroup = (m: Map<string, Agg>) => { const o = new Map<string, Agg>(); for (const a of m.values()) { const k = keyFn(a); const r = o.get(k) ?? { key: k, dims: {}, clicks: 0, impressions: 0, posSum: 0 }; r.clicks += a.clicks; r.impressions += a.impressions; r.posSum += a.posSum; o.set(k, r) } return o }
      cur = regroup(cur); prev = regroup(prev)
    }
    const keys = new Set([...cur.keys(), ...prev.keys()])
    return [...keys].map(k => { const p = parts(prev.get(k)), c = parts(cur.get(k)); return { key: k, prev: p, cur: c, ...decompose(p, c, curve) } }).sort((a, b) => a.delta - b.delta)
  }
  const tot = slice(ds, [], w)
  const tp = total(tot.prev), tc = total(tot.cur)
  const totalRow: DropRow = { key: 'Total', prev: parts({ ...tp, key: '', dims: {} }), cur: parts({ ...tc, key: '', dims: {} }), ...decompose(parts({ ...tp, key: '', dims: {} }), parts({ ...tc, key: '', dims: {} }), curve) }
  const rel = tp.clicks ? (tc.clicks - tp.clicks) / tp.clicks : 0
  const by: Diagnosis['by'] = {}
  for (const d of DIMS) { const r = rowsFor([d]); if (r.length) by[d] = r }
  const groups = rowsFor(['page'], a => pageGroup(a.dims.page!, s.groupDepth))
  if (groups.length) by.group = groups
  const brand = rowsFor(['query'], a => isBrand(a.dims.query!) ? 'Branded' : 'Non-branded')
  if (brand.length) by.brand = brand

  let scope: Diagnosis['scope'] = 'none', scopeText = '', cluster: string | undefined
  if (rel > -0.05) scopeText = `Clicks are ${rel >= 0 ? 'up' : 'down'} ${Math.abs(rel * 100).toFixed(1)}%: no meaningful drop in this comparison.`
  else if (groups.length) {
    const loss = groups.filter(g => g.delta < 0).reduce((s2, g) => s2 - g.delta, 0)
    const worst = groups[0]
    const restPrev = groups.slice(1).reduce((s2, g) => s2 + g.prev.clicks, 0)
    const restCur = groups.slice(1).reduce((s2, g) => s2 + g.cur.clicks, 0)
    const restRel = restPrev ? (restCur - restPrev) / restPrev : 0
    const worstRel = worst.prev.clicks ? worst.delta / worst.prev.clicks : 0
    const meaningful = groups.filter(g => g.prev.clicks >= 0.05 * tp.clicks)
    const declined = meaningful.filter(g => g.prev.clicks && g.delta / g.prev.clicks <= -0.1)
    if (loss && -worst.delta / loss >= 0.6 && worstRel <= -0.2 && restRel > -0.1) {
      scope = 'cluster'; cluster = worst.key
      scopeText = `Concentrated in ${worst.key}: it lost ${Math.round(-worst.delta).toLocaleString()} clicks (${Math.round(worstRel * 100)}%), ${Math.round(-worst.delta / loss * 100)}% of all losses, while the rest of the site moved ${restRel >= 0 ? '+' : ''}${Math.round(restRel * 100)}%.`
    } else if (meaningful.length && declined.length / meaningful.length >= 0.6) {
      scope = 'sitewide'
      scopeText = `Sitewide: ${declined.length} of ${meaningful.length} page groups with real traffic fell 10% or more.`
    } else {
      scope = 'mixed'
      scopeText = `Mixed: losses are spread across several groups (worst is ${worst.key}, ${Math.round(worstRel * 100)}%) while others held.`
    }
  }
  const daily = dailyTotals(ds)
  const cp = changePoint(w.cur ? daily.filter(d => d.date >= w.prev![0] && d.date <= w.cur![1]) : daily)
  const updates = cp ? updatesNear(addDays(cp.date, -10), addDays(cp.date, 10)) : w.cur ? updatesNear(w.prev![0], w.cur[1]) : []
  return { total: totalRow, rel, by, scope, scopeText, cluster, changePoint: cp, updates, window: { cur: w.cur, prev: w.prev } }
}

// ---------- Brand split ----------

export function brandSplit(ds: Fact[], w: Win, isBrand: (q: string) => boolean) {
  const sl = slice(ds, ['query'], w)
  const sum = (m: Map<string, Agg>, b: boolean) => { let c = 0, i = 0; for (const a of m.values()) if (isBrand(a.dims.query!) === b) { c += a.clicks; i += a.impressions } return { clicks: c, impressions: i } }
  return { brand: { cur: sum(sl.cur, true), prev: sum(sl.prev, true) }, nonBrand: { cur: sum(sl.cur, false), prev: sum(sl.prev, false) } }
}

// ---------- Title and meta helper ----------

const W_NARROW = /[ijlft.,:;'|!I ]/
const W_WIDE = /[mwMW@%]/
/** Rough Google SERP title width in pixels (Arial 20px). */
export const pixelWidth = (s: string) => [...s].reduce((p, ch) => p + (W_NARROW.test(ch) ? 5.5 : W_WIDE.test(ch) ? 15 : /[A-Z]/.test(ch) ? 12.5 : 10), 0)

export interface TitleCheck { level: 'ok' | 'warn' | 'bad'; message: string }

export function checkTitle(title: string, query: string, meta = ''): TitleCheck[] {
  const out: TitleCheck[] = []
  const t = title.trim(), q = query.trim().toLowerCase()
  const px = pixelWidth(t)
  if (!t) return [{ level: 'bad', message: 'No title yet.' }]
  if (px > 580) out.push({ level: 'bad', message: `About ${Math.round(px)} px wide: Google cuts titles near 580 px (roughly ${t.length} characters here, aim for 50 to 60).` })
  else if (t.length < 30) out.push({ level: 'warn', message: `Only ${t.length} characters: room to add the query intent or a benefit.` })
  else out.push({ level: 'ok', message: `${t.length} characters, about ${Math.round(px)} px: fits.` })
  const words = q.split(/\s+/).filter(x => x.length > 2)
  const lt = t.toLowerCase()
  const missing = words.filter(x => !lt.includes(x.replace(/s$/, '')))
  if (q && lt.includes(q)) {
    const at = lt.indexOf(q)
    out.push(at <= 30 ? { level: 'ok', message: `Contains "${query}" early.` } : { level: 'warn', message: `"${query}" appears late (character ${at + 1}). Move it to the front.` })
  } else if (q) out.push(missing.length ? { level: 'bad', message: `Missing ${missing.map(m => `"${m}"`).join(', ')} from the query.` } : { level: 'warn', message: `Has the words but not the phrase "${query}".` })
  if (/(\s[|\-–]\s.*){2,}/.test(t)) out.push({ level: 'warn', message: 'More than one separator: Google often rewrites cluttered titles.' })
  if (meta) {
    const m = meta.trim()
    if (m.length > 160) out.push({ level: 'warn', message: `Meta description is ${m.length} characters; about 155 show on desktop.` })
    else if (m.length < 70) out.push({ level: 'warn', message: `Meta description is only ${m.length} characters.` })
    else out.push({ level: 'ok', message: `Meta description ${m.length} characters.` })
    if (q && !m.toLowerCase().includes(q)) out.push({ level: 'warn', message: `Meta description does not contain "${query}" (Google bolds matching words).` })
  }
  return out
}

const titleCase = (s: string) => s.replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase())

/** Puts the query first, keeps the useful part of the old title and trims to fit 580 px at a word boundary. */
export function suggestTitle(title: string, query: string, brand = ''): string {
  const q = titleCase(query.trim())
  const rest = title.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '').replace(/^[\s|\-–:,]+|[\s|\-–:,]+$/g, '').replace(/\s*[|\-–]\s*[^|\-–]*$/, brand ? '' : '$&').trim()
  let s = rest ? `${q}: ${rest}` : q
  const tail = brand ? ` | ${brand}` : ''
  while (pixelWidth(s + tail) > 580 && s.includes(' ')) s = s.slice(0, s.lastIndexOf(' ')).replace(/[\s,:;–-]+$/, '')
  return s + tail
}

// ---------- Worklist ----------

export type ActionKind = 'ctr' | 'cannibal' | 'decay' | 'striking'
export interface Action { id: string; kind: ActionKind; title: string; target: string; gain: number; effort: 1 | 2 | 3; priority: number; evidence: string[]; steps: string[]; queries: string[] }
export const KIND_LABEL: Record<ActionKind, string> = { ctr: 'Fix title & snippet', cannibal: 'Consolidate pages', decay: 'Refresh content', striking: 'Push to page one' }

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const r1 = (x: number) => x.toFixed(1)
const n0 = (x: number) => Math.round(x).toLocaleString('en-US')

export interface Analysis {
  win: Win
  curve: Curve
  points: QueryPoint[]
  striking: ReturnType<typeof strikingDistance>
  gaps: ReturnType<typeof ctrGaps>
  cannibals: Cannibal[]
  redirects: Redirect[]
  clusters: CannibalCluster[]
  decay: Decay[]
  actions: Action[]
  totals: { cur: Parts & { ctr: number }; prev: Parts & { ctr: number } | null }
  brand: ReturnType<typeof brandSplit>
  groups: { group: string; clicks: number; impressions: number; prevClicks: number; pages: number }[]
  pages: { page: string; clicks: number; impressions: number; position: number; prevClicks: number }[]
  has: { queryPage: boolean; dated: boolean; pages: boolean; queries: boolean }
}

export function analyze(ds: Fact[], winKey: string, s: Settings): Analysis {
  const win = resolveWindow(ds, winKey)
  const isBrand = brandMatcher(s.brandTerms)
  const perMonth = 30.44 / win.days
  const curve = siteCurve(ds, win, isBrand)
  const points = queryPoints(ds, win, curve, isBrand)
  const striking = strikingDistance(points, curve, s.minImpressions)
  const gaps = ctrGaps(points, s.minImpressions)
  const cannibals = cannibalisation(ds, win, curve, { minImp: s.minImpressions * 2, isBrand })
  const pageSl = slice(ds, ['page'], win)
  const pages = [...pageSl.cur.values()].map(a => ({ page: a.dims.page!, clicks: a.clicks * perMonth, impressions: a.impressions * perMonth, position: pos(a), prevClicks: (pageSl.prev.get(a.key)?.clicks ?? 0) * perMonth })).sort((a, b) => b.clicks - a.clicks)
  const clusters = cannibalClusters(cannibals)
  const redirects = redirectPlan(clusters, new Map(pages.map(p => [p.page, p.clicks])))
  const dated = !!dateBounds(ds)
  const end = win.cur ? (win.cur[1] >= addDays(`${nextMonth(win.cur[1].slice(0, 7))}-01`, -1) ? win.cur[1].slice(0, 7) : prevMonth(win.cur[1].slice(0, 7))) : ''
  const decay = dated && end ? contentDecay(ds, end, s.decayMonths, Math.max(10, s.minImpressions / 3)) : []

  const actions: Action[] = []
  // CTR gaps, grouped by the page that ranks.
  const byPage = new Map<string, QueryPoint[]>()
  for (const g of gaps) { const k = g.page ?? `query:${g.query}`; byPage.set(k, [...(byPage.get(k) ?? []), g]) }
  for (const [k, list] of byPage) {
    const gain = list.reduce((x, p) => x + p.gap, 0)
    const page = k.startsWith('query:') ? null : k
    actions.push({
      id: `ctr:${k}`, kind: 'ctr', target: page ?? list[0].query, gain, effort: 1, priority: 0, queries: list.map(p => p.query),
      title: page ? `Rewrite the title and meta description of ${shortUrl(page)}` : `Rewrite the snippet ranking for "${list[0].query}"`,
      evidence: list.slice(0, 4).map(p => `"${p.query}": position ${r1(p.position)}, CTR ${pct(p.ctr)} vs ${pct(p.expected)} expected at that position on this site, ${n0(p.impressions)} impressions a month`),
      steps: [`Put "${list[0].query}" at the front of the title and keep it under about 580 px.`, 'Write a meta description that answers the query and says why to click (time, price, proof).', 'Check the SERP for rich results or features pushing your result down; add structured data if a competitor has it.', 'Recheck CTR in 4 weeks; Google may take a few crawls to show the new title.'],
    })
  }
  for (const cl of clusters) {
    const losers = cl.pages.slice(1).map(shortUrl)
    actions.push({
      id: `cannibal:${cl.canonical}`, kind: 'cannibal', target: cl.canonical, gain: cl.gain, effort: 2, priority: 0, queries: cl.queries,
      title: `Consolidate ${losers.join(', ')} into ${shortUrl(cl.canonical)}`,
      evidence: cl.items.slice(0, 5).map(evCannibal),
      steps: [`Keep ${shortUrl(cl.canonical)} (most clicks on the contested queries).`, 'Merge anything unique from the other pages into it.', 'Apply the redirect map: 301 pages with little traffic of their own; canonical or internal-link the rest.', 'Update internal links and the sitemap to point at the canonical URL.'],
    })
  }
  for (const d of decay) actions.push({
    id: `decay:${d.page}`, kind: 'decay', target: d.page, gain: d.gain, effort: 2, priority: 0, queries: d.lost.map(l => l.query),
    title: `Refresh ${shortUrl(d.page)}`,
    evidence: [`Clicks went from about ${n0(d.baseline)} to ${n0(d.last)} a month over ${d.months.length} months (${d.pattern === 'step' ? 'a sudden step' : 'a steady slide'}, trend ${Math.round(d.change * 100)}%).`, ...d.lost.slice(0, 3).map(l => `"${l.query}": ${n0(l.before)} → ${n0(l.after)} clicks a month, position ${r1(l.posBefore)} → ${Number.isFinite(l.posAfter) ? r1(l.posAfter) : 'gone'}`)],
    steps: ['Compare the page with what ranks now for the lost queries: what do they cover that you do not?', 'Update facts, dates, screenshots and examples; add sections for the lost queries.', 'Do not change the URL. Update the visible "last updated" date only if the content really changed.', 'Add internal links from newer pages.'],
  })
  // Queries already covered by a consolidation or refresh item are not repeated as striking-distance work.
  const covered = new Set([...cannibals.map(c => c.query), ...decay.flatMap(d => d.lost.map(l => l.query))])
  const decaying = new Set(decay.map(d => d.page))
  for (const p of striking.filter(x => !covered.has(x.query) && !(x.page && decaying.has(x.page))).slice(0, 25)) actions.push({
    id: `striking:${p.query}`, kind: 'striking', target: p.page ?? p.query, gain: p.potential, effort: 3, priority: 0, queries: [p.query],
    title: `Push "${p.query}" from position ${r1(p.position)} onto page one${p.page ? ` (${shortUrl(p.page)})` : ''}`,
    evidence: [`${n0(p.impressions)} impressions a month at position ${r1(p.position)}, ${n0(p.clicks)} clicks. At position 5 this site's curve predicts ${pct(expectedCtr(curve, 5))} CTR.`],
    steps: [`Add a section that answers "${p.query}" directly, with the phrase in a subheading.`, 'Link to the page from 3 to 5 related pages using descriptive anchor text.', 'Improve the title so it matches the query intent.'],
  })
  for (const a of actions) a.priority = a.gain / a.effort
  actions.sort((a, b) => b.priority - a.priority)

  const tot = slice(ds, [], win)
  const tp = total(tot.prev), tc = total(tot.cur)
  const mk = (t: { clicks: number; impressions: number; posSum: number }) => ({ clicks: t.clicks * perMonth, impressions: t.impressions * perMonth, position: t.impressions ? t.posSum / t.impressions : NaN, ctr: t.impressions ? t.clicks / t.impressions : 0 })
  const groupMap = new Map<string, { group: string; clicks: number; impressions: number; prevClicks: number; pages: number }>()
  for (const p of pages) { const g = pageGroup(p.page, s.groupDepth); const r = groupMap.get(g) ?? { group: g, clicks: 0, impressions: 0, prevClicks: 0, pages: 0 }; r.clicks += p.clicks; r.impressions += p.impressions; r.prevClicks += p.prevClicks; r.pages++; groupMap.set(g, r) }
  return {
    win, curve, points, striking, gaps, cannibals, clusters, redirects, decay, actions,
    totals: { cur: mk(tc), prev: tp.impressions ? mk(tp) : null },
    brand: brandSplit(ds, win, isBrand),
    groups: [...groupMap.values()].sort((a, b) => b.clicks - a.clicks),
    pages,
    has: { queryPage: !!pickGrain(ds, ['query', 'page']), dated, pages: !!pickGrain(ds, ['page']), queries: !!pickGrain(ds, ['query']) },
  }
}

const evCannibal = (c: Cannibal) => `"${c.query}" (score ${c.score}): ${c.pages.map(p => `${shortUrl(p.page)} ${Math.round(p.share * 100)}% of impressions at position ${r1(p.position)}`).join(', ')}; the leading page changed ${Math.round(c.flipRate * 100)}% of weeks`

// ---------- Snapshots ----------

export interface Snapshot {
  id: string
  period: string
  label: string
  at: number
  window: string
  totals: Analysis['totals']['cur']
  brandShare: number
  actions: { id: string; kind: ActionKind; title: string; gain: number }[]
  counts: Record<ActionKind, number>
  pages: { page: string; clicks: number }[]
}

export function snapshot(a: Analysis, id: string, period: string, label: string): Snapshot {
  const counts = { ctr: 0, cannibal: 0, decay: 0, striking: 0 }
  for (const x of a.actions) counts[x.kind]++
  const bc = a.brand.brand.cur.clicks, all = bc + a.brand.nonBrand.cur.clicks
  return {
    id, period, label, at: Date.now(), window: a.win.key, totals: a.totals.cur, brandShare: all ? bc / all : 0,
    actions: a.actions.slice(0, 40).map(x => ({ id: x.id, kind: x.kind, title: x.title, gain: x.gain })),
    counts, pages: a.pages.slice(0, 25).map(p => ({ page: p.page, clicks: p.clicks })),
  }
}

export function compareSnapshots(a: Snapshot, b: Snapshot) {
  const ids = new Set(b.actions.map(x => x.id)), old = new Set(a.actions.map(x => x.id))
  const pa = new Map(a.pages.map(p => [p.page, p.clicks]))
  return {
    clicks: b.totals.clicks - a.totals.clicks,
    clicksRel: a.totals.clicks ? (b.totals.clicks - a.totals.clicks) / a.totals.clicks : 0,
    impressions: b.totals.impressions - a.totals.impressions,
    ctr: b.totals.ctr - a.totals.ctr,
    position: b.totals.position - a.totals.position,
    resolved: a.actions.filter(x => !ids.has(x.id)),
    added: b.actions.filter(x => !old.has(x.id)),
    open: b.actions.filter(x => old.has(x.id)),
    movers: b.pages.map(p => ({ page: p.page, before: pa.get(p.page) ?? 0, after: p.clicks })).sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before)).slice(0, 10),
  }
}
