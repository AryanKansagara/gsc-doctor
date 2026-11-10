import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMap, detectKind, mergeFacts, normPage, parseCsv, parseCtr, parseDate, readFile, validate } from './parse.ts'
import {
  analyze, brandMatcher, cannibalClusters, cannibalisation, changePoint, checkTitle, compareSnapshots, contentDecay, decompose, diagnose,
  dropWindow, expectedCtr, fitCurve, isotonicDecreasing, pageGroup, pixelWidth, redirectPlan, resolveWindow, snapshot, suggestTitle, theilSen, windowOptions,
} from './analyze.ts'
import { generate, SAMPLES } from './sample.ts'
import { DEFAULT_SETTINGS, type Fact } from './types.ts'
import { updatesNear, UPDATES } from './updates.ts'

const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString().slice(0, 10)

// ---------- Parsing ----------

test('GSC Queries.csv: detects the table, maps columns, parses percent CTR', () => {
  const t = parseCsv('Top queries,Clicks,Impressions,CTR,Position\nbanana bread,120,4000,3%,6.2\n', 'Queries.csv')
  const map = autoMap(t.rows[0])
  assert.deepEqual([map.query, map.clicks, map.impressions, map.ctr, map.position], [0, 1, 2, 3, 4])
  assert.equal(detectKind(t, map), 'queries')
  const v = validate(t, map)
  assert.equal(v.facts.length, 1)
  assert.equal(v.facts[0].g, 'query')
  assert.equal(v.facts[0].period, 'cur')
})

test('compare-mode export yields a current and a previous fact per row', () => {
  const t = parseCsv('Top pages,Last 28 days Clicks,Previous 28 days Clicks,Last 28 days Impressions,Previous 28 days Impressions,Last 28 days Position,Previous 28 days Position\nhttps://a.example/x/,10,20,100,150,4,3\n')
  const map = autoMap(t.rows[0])
  assert.equal(map.clicks, 1); assert.equal(map.clicks_prev, 2); assert.equal(map.position_prev, 6)
  const v = validate(t, map)
  assert.equal(v.compare, true)
  assert.deepEqual(v.facts.map(f => [f.period, f.clicks]), [['cur', 10], ['prev', 20]])
})

test('validation reports bad rows with their line numbers and keeps the good ones', () => {
  const t = parseCsv('date,query,page,clicks,impressions,position\n2026-01-01,a,https://x.example/,5,50,3\n2026-13-01,b,https://x.example/,1,2,3\n2026-01-02,c,https://x.example/,9,3,2\n2026-01-03,,https://x.example/,1,1,1\n')
  const v = validate(t, autoMap(t.rows[0]))
  assert.equal(v.facts.length, 1)
  assert.equal(v.skipped, 3)
  assert.deepEqual(v.issues.filter(i => i.level === 'error').map(i => i.line), [3, 4, 5])
  assert.match(v.issues[1].message, /exceed impressions/)
  assert.equal(detectKind(t), 'rows')
})

test('quoted CSV fields with commas and newlines keep line numbers right', () => {
  const t = parseCsv('query,clicks,impressions,position\n"a, b",1,10,2\n"multi\nline",2,20,3\nlast,3,30,4\n')
  assert.equal(t.rows[1][0], 'a, b')
  assert.deepEqual(t.lines, [1, 2, 3, 5])
})

test('dates, CTRs and URLs normalise', () => {
  assert.equal(parseDate('2026-11-07'), '2026-11-07')
  assert.equal(parseDate('11/7/2026'), '2026-11-07')
  assert.equal(parseDate('20261107'), '2026-11-07')
  assert.equal(parseDate('46333'), '2026-11-07')
  assert.equal(parseDate('2026-02-30'), '')
  assert.equal(parseCtr('3.5%'), 0.035)
  assert.equal(parseCtr('0.035'), 0.035)
  assert.equal(normPage('https://A.Example/Recipe/#jump'), 'https://a.example/Recipe/')
})

test('re-importing the same rows replaces them instead of double counting', () => {
  const a: Fact[] = [{ g: 'page', date: day(0), page: '/a', clicks: 1, impressions: 10, position: 3 }]
  const b: Fact[] = [{ g: 'page', date: day(0), page: '/a', clicks: 5, impressions: 12, position: 2 }, { g: 'page', date: day(1), page: '/a', clicks: 2, impressions: 9, position: 3 }]
  const m = mergeFacts(a, b)
  assert.equal(m.length, 2)
  assert.equal(m.find(f => f.date === day(0))!.clicks, 5)
})

test('reads a zip of CSVs (the Search Console export) without dependencies', async () => {
  // Build a stored (uncompressed) zip by hand with one CSV inside.
  const name = new TextEncoder().encode('Queries.csv')
  const body = new TextEncoder().encode('Top queries,Clicks,Impressions,CTR,Position\nx,1,10,10%,2\n')
  const local = new Uint8Array(30 + name.length); const lv = new DataView(local.buffer)
  lv.setUint32(0, 0x04034b50, true); lv.setUint32(18, body.length, true); lv.setUint32(22, body.length, true); lv.setUint16(26, name.length, true); local.set(name, 30)
  const cen = new Uint8Array(46 + name.length); const cv = new DataView(cen.buffer)
  cv.setUint32(0, 0x02014b50, true); cv.setUint32(20, body.length, true); cv.setUint32(24, body.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, 0, true); cen.set(name, 46)
  const end = new Uint8Array(22); const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true); ev.setUint32(12, cen.length, true); ev.setUint32(16, local.length + body.length, true)
  const zip = new Uint8Array([...local, ...body, ...cen, ...end])
  const tables = await readFile('export.zip', zip.buffer)
  assert.equal(tables.length, 1)
  assert.equal(tables[0].name, 'Queries.csv')
  assert.equal(detectKind(tables[0]), 'queries')
})

// ---------- Curve ----------

test('isotonic fit is non-increasing and pools violators by weight', () => {
  assert.deepEqual(isotonicDecreasing([0.3, 0.1, 0.2, 0.05], [1, 1, 1, 1]).map(x => +x.toFixed(3)), [0.3, 0.15, 0.15, 0.05])
  const f = isotonicDecreasing([0.2, 0.25, 0.1, 0.12, 0.01], [10, 1, 5, 5, 3])
  for (let i = 1; i < f.length; i++) assert.ok(f[i] <= f[i - 1])
})

test('curve recovers a known CTR-by-position shape and interpolates', () => {
  const truth = (p: number) => 0.3 * Math.pow(p, -1.1)
  const pts = Array.from({ length: 60 }, (_, i) => { const p = 1 + i / 3; return { pos: p, imp: 1000, clicks: Math.round(1000 * truth(p)) } })
  const c = fitCurve(pts)
  assert.equal(c.kind, 'isotonic')
  for (const p of [1.5, 3, 6, 10]) assert.ok(Math.abs(expectedCtr(c, p) - truth(p)) / truth(p) < 0.25, `pos ${p}`)
  assert.ok(expectedCtr(c, 2) > expectedCtr(c, 8))
})

test('sparse data falls back to a log fit, no data to the prior', () => {
  const log = fitCurve([{ pos: 1, clicks: 30, imp: 100 }, { pos: 3, clicks: 10, imp: 100 }, { pos: 8, clicks: 2, imp: 100 }])
  assert.equal(log.kind, 'log')
  assert.ok(expectedCtr(log, 1) > expectedCtr(log, 8))
  assert.equal(fitCurve([]).kind, 'prior')
})

// ---------- Trend, decomposition ----------

test('Theil–Sen ignores a single outlier month', () => {
  assert.equal(theilSen([100, 90, 80, 70, 60]), -10)
  assert.equal(theilSen([100, 90, 400, 70, 60]), -10)
})

test('drop decomposition always adds up to the click change', () => {
  const c = fitCurve([])
  for (const [prev, cur] of [
    [{ clicks: 100, impressions: 2000, position: 3 }, { clicks: 40, impressions: 1500, position: 7 }],
    [{ clicks: 50, impressions: 1000, position: 4 }, { clicks: 20, impressions: 1000, position: 4 }],
    [{ clicks: 30, impressions: 600, position: 5 }, { clicks: 0, impressions: 0, position: NaN }],
  ] as const) {
    const d = decompose(prev, cur, c)
    assert.ok(Math.abs(d.demand + d.rank + d.ctr - d.delta) < 1e-9)
  }
  const sameRank = decompose({ clicks: 50, impressions: 1000, position: 4 }, { clicks: 20, impressions: 1000, position: 4 }, c)
  assert.equal(sameRank.cause, 'ctr')
  const fell = decompose({ clicks: 100, impressions: 1000, position: 2 }, { clicks: 30, impressions: 1000, position: 9 }, c)
  assert.equal(fell.cause, 'rank')
})

test('change point finds the day traffic stepped down', () => {
  const daily = Array.from({ length: 60 }, (_, i) => ({ date: day(i), clicks: i < 30 ? 100 : 60 }))
  const cp = changePoint(daily)!
  assert.equal(cp.date, day(30))
  assert.ok(Math.abs(cp.rel + 0.4) < 1e-9)
  assert.equal(changePoint(daily.map(d => ({ ...d, clicks: 100 }))), undefined)
})

// ---------- Cannibalisation ----------

function cannibalData(flip: boolean): Fact[] {
  const out: Fact[] = []
  for (let d = 0; d < 84; d++) {
    const wk = Math.floor(d / 7)
    const aLead = flip ? wk % 2 === 0 : true
    out.push({ g: 'query|page', date: day(d), query: 'banana bread', page: '/a/', clicks: aLead ? 6 : 3, impressions: aLead ? 60 : 40, position: aLead ? 4 : 6 })
    out.push({ g: 'query|page', date: day(d), query: 'banana bread', page: '/b/', clicks: aLead ? 2 : 5, impressions: aLead ? 40 : 60, position: aLead ? 6 : 4 })
  }
  return out
}

test('cannibalisation: split impressions plus weekly flip-flop scores high and picks a canonical', () => {
  const ds = cannibalData(true)
  const w = resolveWindow(ds, 'l28')
  const [c] = cannibalisation(ds, w, fitCurve([]), { minImp: 10, isBrand: () => false })
  assert.ok(c, 'flagged')
  assert.ok(c.score >= 80, `score ${c.score}`)
  assert.ok(c.flipRate > 0.9)
  assert.equal(c.pages.length, 2)
  const steady = cannibalisation(cannibalData(false), w, fitCurve([]), { minImp: 10, isBrand: () => false })
  assert.ok(!steady.length || steady[0].score < c.score)
})

test('redirect plan never points two pages at each other and 301s low-traffic losers', () => {
  const ds = cannibalData(true)
  const cans = cannibalisation(ds, resolveWindow(ds, 'l28'), fitCurve([]), { minImp: 10, isBrand: () => false })
  const clusters = cannibalClusters(cans)
  assert.equal(clusters.length, 1)
  const plan = redirectPlan(clusters, new Map([['/a/', 200], ['/b/', 120]]))
  assert.equal(plan.length, 1)
  const froms = new Set(plan.map(r => r.from))
  assert.ok(plan.every(r => !froms.has(r.to)))
  const keep = redirectPlan(clusters, new Map([[plan[0].from, 10_000]]))
  assert.equal(keep[0].action, 'canonical')
})

// ---------- Decay ----------

test('content decay flags a steady slide and lists the queries lost', () => {
  const ds: Fact[] = []
  for (let m = 0; m < 6; m++) for (let d = 1; d <= 28; d++) {
    const date = `2026-0${m + 1}-${String(d).padStart(2, '0')}`
    ds.push({ g: 'page', date, page: '/old/', clicks: 40 - m * 6, impressions: 800, position: 3 + m })
    ds.push({ g: 'page', date, page: '/fine/', clicks: 30, impressions: 600, position: 3 })
    ds.push({ g: 'query|page', date, query: 'lost query', page: '/old/', clicks: 30 - m * 5, impressions: 500, position: 3 + m })
  }
  const out = contentDecay(ds, '2026-06', 6)
  assert.deepEqual(out.map(d => d.page), ['/old/'])
  assert.equal(out[0].pattern, 'steady')
  assert.equal(out[0].lost[0].query, 'lost query')
  assert.ok(out[0].gain > 0)
})

// ---------- Brand, groups, titles, updates ----------

test('brand matcher catches spacing and punctuation variants', () => {
  const b = brandMatcher(['Butter Crumb'])
  assert.ok(b('buttercrumb banana bread'))
  assert.ok(b('butter-crumb scones'))
  assert.ok(!b('butter cookies'))
  assert.ok(!brandMatcher([])('anything'))
})

test('page groups by path depth', () => {
  assert.equal(pageGroup('https://x.example/blog/net-30/'), '/blog/')
  assert.equal(pageGroup('https://x.example/blog/2026/net-30/', 2), '/blog/2026/')
  assert.equal(pageGroup('https://x.example/'), '/')
  assert.equal(pageGroup('https://x.example/banana-bread/'), '/* (top level)')
})

test('title checks flag width, missing query, and the suggestion fits and leads with the query', () => {
  const bad = checkTitle('Cookies', 'chocolate chip cookies recipe')
  assert.ok(bad.some(c => c.level === 'bad' && /Missing/.test(c.message)))
  const long = checkTitle('The Absolutely Ultimate Guide To Making The Very Best Chocolate Chip Cookies At Home', 'cookies')
  assert.ok(long.some(c => c.level === 'bad' && /px/.test(c.message)))
  const s = suggestTitle('Cookies | Butter Crumb', 'chocolate chip cookies recipe', 'Butter Crumb')
  assert.ok(s.toLowerCase().startsWith('chocolate chip cookies recipe'))
  assert.ok(pixelWidth(s) <= 580)
})

test('update overlay: the dated list is valid and lookups find the May 2026 core update', () => {
  for (const u of UPDATES) assert.match(u.start, /^\d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(updatesNear('2026-05-25', '2026-05-30').map(u => u.name), ['May 2026 core update'])
  assert.equal(updatesNear('2026-01-10', '2026-01-20').length, 0)
})

// ---------- Windows, samples end to end, snapshots ----------

test('windows: rolling and calendar months resolve to adjacent previous periods', () => {
  const ds: Fact[] = Array.from({ length: 120 }, (_, i) => ({ g: '', date: day(i), clicks: 1, impressions: 10, position: 5 }))
  const opts = windowOptions(ds)
  assert.ok(opts.includes('l28') && opts.includes('2026-03'))
  const w = resolveWindow(ds, '2026-03')
  assert.deepEqual(w.cur, ['2026-03-01', '2026-03-31'])
  assert.deepEqual(w.prev, ['2026-02-01', '2026-02-28'])
  const r = resolveWindow(ds, 'l28')
  assert.equal(r.days, 28)
  assert.equal(r.prev![1] < r.cur![0], true)
})

test('recipe sample: banana bread cannibalisation, sourdough decay and the cookie title gap all surface', () => {
  const s = SAMPLES.find(x => x.id === 'butter-crumb')!
  const a = analyze(generate(s.id), 'l28', { ...DEFAULT_SETTINGS, brandTerms: s.brand })
  assert.ok(a.cannibals.some(c => c.query === 'banana bread recipe'))
  assert.ok(a.clusters[0].pages.every(p => /banana-bread/.test(p)))
  assert.ok(a.decay.some(d => /sourdough-starter/.test(d.page)))
  assert.equal(a.actions[0].kind, 'ctr')
  assert.match(a.actions[0].target, /chocolate-chip-cookies/)
  assert.ok(!a.points.filter(p => p.branded).some(p => a.gaps.includes(p)))
})

test('SaaS sample: the drop is concentrated in /blog/, rank-driven and lines up with the May 2026 core update', () => {
  const s = SAMPLES.find(x => x.id === 'ledgerly')!
  const ds = generate(s.id)
  const w = dropWindow(ds)!
  assert.ok(w.prev![1] < '2026-06-01' && w.cur![0] > '2026-05-28')
  const a = analyze(ds, 'l28', { ...DEFAULT_SETTINGS, brandTerms: s.brand })
  const d = diagnose(ds, w, a.curve, DEFAULT_SETTINGS, brandMatcher(s.brand))
  assert.equal(d.scope, 'cluster')
  assert.equal(d.cluster, '/blog/')
  assert.ok(d.updates.some(u => u.name === 'May 2026 core update'))
  assert.ok(d.total.rank < 0 && d.total.rank < d.total.demand)
  const brand = d.by.brand!.find(r => r.key === 'Branded')!
  assert.ok(Math.abs(brand.delta / brand.prev.clicks) < 0.15, 'branded traffic held')
})

test('snapshots compare: resolved and new actions, click change', () => {
  const s = SAMPLES[0]
  const ds = generate(s.id)
  const set = { ...DEFAULT_SETTINGS, brandTerms: s.brand }
  const a = snapshot(analyze(ds, '2026-05', set), 'a', '2026-05', 'May')
  const b = snapshot(analyze(ds, '2026-10', set), 'b', '2026-10', 'Oct')
  const c = compareSnapshots(a, b)
  assert.equal(c.resolved.length + c.open.length, a.actions.length)
  assert.equal(c.added.length + c.open.length, b.actions.length)
  assert.ok(Math.abs(c.clicks - (b.totals.clicks - a.totals.clicks)) < 1e-9)
})

test('an undated UI export (queries + pages tables) still produces a worklist without cannibalisation', () => {
  const q = parseCsv('Top queries,Clicks,Impressions,CTR,Position\n' + Array.from({ length: 40 }, (_, i) => `q${i},${Math.round(400 / (i + 1))},${2000 + i * 10},x,${1 + i / 2}`).join('\n'))
  const facts = validate(q, autoMap(q.rows[0])).facts
  const a = analyze(facts, 'export', DEFAULT_SETTINGS)
  assert.equal(a.win.key, 'export')
  assert.equal(a.has.queryPage, false)
  assert.equal(a.cannibals.length, 0)
  assert.ok(a.actions.length > 0)
})
