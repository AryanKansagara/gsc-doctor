import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { autoMap, detectKind, exportLength, filterDays, filtersNote, jsonTable, mergeFacts, normPage, parseCsv, parseCount, parseCtr, parseDate, parseNum, parsePosition, slashOrder, readFile, sumDuplicates, validate, type Table } from './parse.ts'
import {
  analyze, brandMatcher, cannibalClusters, cannibalisation, changePoint, checkTitle, compareSnapshots, contentDecay, decompose, diagnose,
  dropWindow, expectedCtr, slice, fitCurve, isotonicDecreasing, pageGroup, pixelWidth, redirectPlan, redirectRules, resolveWindow, snapshot, suggestTitle, theilSen, windowOptions,
} from './analyze.ts'
import { generate, SAMPLES } from './sample.ts'
import { DEFAULT_SETTINGS, type Fact } from './types.ts'
import { redirectCsv } from './analyze.ts'
import { factsToCsv, toCsv } from './parse.ts'
import { BUILT_IN, fromIncidents, mergeUpdates, updatesNear, UPDATES } from './updates.ts'

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

test('a file that ends inside a quote says so, with the line', () => {
  const H = 'Top queries,Clicks,Impressions,CTR,Position\n'
  const run = (body: string) => { const t = parseCsv(H + body); return { t, v: validate(t, autoMap(t.rows[0])) } }
  const { v } = run('a,10,100,10%,3\n"b,5,50,10%,3\nc,9,90,10%,2\nd,9,90,10%,2\n')
  assert.deepEqual([v.facts.length, v.total, v.skipped], [1, 2, 1])
  assert.deepEqual(v.issues.map(i => [i.line, i.level]), [[3, 'error']])
  assert.match(v.issues[0].message, /quote opened on line 3 never closes/)
  // The row is not kept even when its numbers come before the quote.
  const late = validate(parseCsv('query,clicks,impressions,position,note\na,1,10,3,\nb,1,10,3,"x\nc,1,10,3,\n'), { query: 0, clicks: 1, impressions: 2, position: 3 })
  assert.deepEqual([late.facts.map(f => f.query), late.issues[0].line], [['a'], 3])
  // The row can start before the quote.
  assert.equal(run('a,10,100,10%,3\n"two\nlines","5,50').v.issues[0].line, 4)
  assert.equal(run('a,10,100,10%,3\n"').v.issues.length, 1)
  assert.equal(parseCsv('"Top queries,Clicks\na,1\n').unclosed, 1)
  for (const ok of ['a,10,100,10%,3', '"a ""b""",10,100,10%,3\n', '"a\nb",10,100,10%,"3"', 'a "b,10,100,10%,3\n']) { const x = run(ok); assert.deepEqual([x.t.unclosed, x.v.facts.length, x.v.skipped], [undefined, 1, 0], ok) }
  // A chart that was cut off does not say how long the export is.
  assert.equal(exportLength([parseCsv('Date,Clicks,Impressions,CTR,Position\n2026-01-01,1,10,10%,3\n"2026-01-02,1', 'Chart.csv'), parseCsv('Filter,Value\nDate,Last 28 days', 'Filters.csv')]), 28)
})

test('the normalised CSV imports back to the same rows', () => {
  const round = (facts: Fact[]) => { const t = parseCsv(factsToCsv(facts)); return validate(t, autoMap(t.rows[0])) }
  const key = (f: Fact) => JSON.stringify([f.g, f.date, f.period, f.query, f.page, f.country, f.device, f.clicks, f.impressions, f.position])
  const facts: Fact[] = [
    { g: '', date: '2026-01-01', clicks: 12345, impressions: 1234567, position: 3.25 },
    { g: '', date: '2026-01-02', clicks: 0, impressions: 0, position: 0 },
    { g: 'device', date: '2026-01-01', device: 'Mobile', clicks: 1, impressions: 10, position: 3 },
    { g: 'query|page', date: '2026-01-01', query: 'shoes, red', page: 'https://a.example/x', clicks: 1, impressions: 10, position: 3 },
    { g: 'query|page|country|device', date: '2026-01-01', query: 'shoes', page: 'https://a.example/', country: 'USA', device: 'Desktop', clicks: 1, impressions: 10, position: 3 },
    ...(['cur', 'prev'] as const).flatMap(period => [
      { g: 'query', period, query: '=1+1', clicks: 2, impressions: 20, position: 1 },
      { g: 'query', period, query: "'=1+1", clicks: 3, impressions: 20, position: 1 },
      { g: 'query', period, query: "'quoted'", clicks: 4, impressions: 20, position: 1 },
      { g: 'page', period, page: 'https://a.example/x', clicks: period === 'cur' ? 5 : 6, impressions: 20, position: 2.5 },
      { g: 'country', period, country: 'United States', clicks: 5, impressions: 20, position: 2.5 },
    ]),
  ]
  const v = round(facts)
  assert.deepEqual(v.facts.map(key), facts.map(key))
  assert.deepEqual([v.skipped, v.issues, v.dated, v.grains.length], [0, [], true, 7])
  assert.equal(round(facts.filter(f => f.period)).dated, false)
  const sample = generate('ledgerly').filter(f => f.date! >= '2026-10-01')
  assert.equal(round(sample).facts.length, sample.length)
  // A row that says neither its date nor its period, or has no dimension at all, is still refused.
  const bad = parseCsv('date,period,query,page,country,device,clicks,impressions,ctr,position\n,,shoes,,,,1,10,0.1,3\n,cur,,,,,1,10,0.1,3\nsoon,cur,shoes,,,,1,10,0.1,3\n')
  assert.deepEqual([validate(bad, autoMap(bad.rows[0])).facts.length, validate(bad, autoMap(bad.rows[0])).skipped], [0, 3])
})

test('only known date layouts are read, and a column of slashed dates has one order', () => {
  for (const bad of ['Week 12', 'unknown 5', 'Total 2026', 'Nov 2026', 'Q3 Oct 2026', '5 2026', '2026-10-01 to 2026-10-07', '2026-10-011', '2026-02-30', 'Oct 32, 2026', 'Foo 1, 2026', 'Octopus 1, 2026', 'Oct 1, 26', 'Oct 1 2026 total', '13/13/2026', '07.11.2026', '1/2/26', 'Infinity', '']) assert.equal(parseDate(bad), '', bad)
  for (const ok of ['2026-11-07', '2026/11/7', '20261107', '46333', '11/7/2026', '11/07/2026 13:45', '11/7/2026 12:00 AM', '2026-11-07T23:30:00-05:00', '2026-11-07 00:00:00 UTC', 'Nov 7, 2026', 'November 7 2026', 'NOV. 7, 2026, 12:00:00 AM', '7 Nov 2026', '07-Nov-2026', '07/Nov/2026', '7Nov2026', 'Nov 7,2026', '2026-11-07Z', '7 november 2026', 'Saturday, November 7, 2026', 'Sat, 07 Nov 2026 23:00:00 GMT', 'Sat Nov 07 2026 00:00:00 GMT+0100 (CET)', '2026-Nov-07']) assert.equal(parseDate(ok), '2026-11-07', ok)
  assert.equal(parseDate('07/11/2026', true), '2026-11-07')
  assert.deepEqual([['07/11/2026', '13/11/2026'], ['11/13/2026', '1/2/2026'], ['01/02/2026'], ['13/11/2026', '11/13/2026'], ['13/13/2026'], ['2026-01-01'], ['01/02/2026', '99/02/2026']].map(slashOrder), ['day', 'month', 'ambiguous', 'mixed', 'mixed', 'none', 'ambiguous'])
  const run = (...dates: string[]) => { const t = parseCsv('date,page,clicks,impressions,position\n' + dates.map((d, i) => `${d},https://a.example/${i},1,10,3`).join('\n')); return validate(t, autoMap(t.rows[0])) }
  assert.deepEqual(run('07/11/2026', '13/11/2026').facts.map(f => f.date), ['2026-11-07', '2026-11-13'])
  assert.deepEqual(run('07/11/2026', '08/11/2026').facts.map(f => f.date), ['2026-07-11', '2026-08-11'])
  const mixed = run('13/11/2026', '11/13/2026', '01/02/2026')
  assert.deepEqual([mixed.facts.length, mixed.skipped], [0, 3])
  assert.match(mixed.issues[0].message, /none of the slashed dates/)
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

test('redirect rules match one path, and pairs a path rule cannot express are left to do by hand', () => {
  const to = 'https://a.example/blog/post/'
  const r = (from: string, target = to) => redirectRules([{ from, to: target, action: '301', reason: '', queries: [] }])
  assert.deepEqual(r('https://a.example/blog').apache, ['RedirectMatch 301 "^/blog$" "https://a.example/blog/post/"'])
  assert.deepEqual(r('https://a.example/').nginx, ['location = "/" { return 301 "https://a.example/blog/post/"; }'])
  // Servers match the decoded path; regex characters are literal.
  assert.deepEqual(r('https://a.example/c++%20(1).html').apache, ['RedirectMatch 301 "^/c\\+\\+ \\(1\\)\\.html$" "https://a.example/blog/post/"'])
  assert.deepEqual(r('https://a.example/b; } location /x { deny all').nginx, ['location = "/b; } location /x { deny all" { return 301 "https://a.example/blog/post/"; }'])
  for (const bad of ['http://a.example/blog/post/', 'https://www.a.example/blog/post/', 'https://www.a.example/x', 'https://a.example/p?id=2', '/blog', 'https://a.example/a"b%22', 'https://a.example/x\nDeny', 'https://a.example/%0aDeny', 'https://a.example/%E0%A4%A', 'https://a.example/a%2Fb']) {
    const x = r(bad)
    assert.deepEqual([x.apache, x.nginx, x.manual.length], [[], [], 1], bad)
  }
  assert.equal(r('https://a.example/x', 'https://a.example/y$1').manual.length, 1)
  assert.deepEqual(redirectRules([{ from: 'https://a.example/x', to, action: 'canonical', reason: '', queries: [] }]), { apache: [], nginx: [], manual: [] })
})

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

test('windows the data does not cover: no comparison, and a short window is scaled by its own days', () => {
  const flat = (n: number, g = 'page'): Fact[] => Array.from({ length: n }, (_, i) => ({ g, date: day(i), ...(g ? { page: 'https://a.example/p' } : {}), clicks: 10, impressions: 100, position: 3 }))
  const run = (ds: Fact[], w = 'l28') => analyze(ds, w, DEFAULT_SETTINGS)
  // 10 clicks a day is 304.4 a month whatever the span.
  for (const n of [1, 10, 27, 28, 40, 55, 56, 100]) assert.ok(Math.abs(run(flat(n)).totals.cur.clicks - 304.4) < 1e-6, String(n))
  assert.deepEqual([run(flat(10)).win.label, run(flat(10)).win.days, run(flat(1)).win.label], ['Last 10 days', 10, 'Last 1 day'])
  for (const n of [28, 40, 55]) { const a = run(flat(n)); assert.equal(a.totals.prev, null); assert.equal(a.has.prevPages, false) }
  assert.ok(Math.abs(run(flat(56)).totals.prev!.clicks - 304.4) < 1e-6)
  assert.equal(run(flat(40), '2026-01').totals.prev, null)
  assert.equal(run(flat(181), 'l3m').totals.prev, null)
  assert.notEqual(run(flat(182), 'l3m').totals.prev, null)
  // A page table that starts later than the daily totals is not compared, one that misses its first 3 days is.
  const mixed = (from: number) => [...flat(80, ''), ...flat(80).slice(from)]
  const prevPages = (from: number) => slice(mixed(from), ['page'], resolveWindow(mixed(from), 'l28')).prev.size
  assert.deepEqual([24, 27, 28, 40].map(prevPages), [1, 1, 0, 0])
  const d = diagnose(flat(40), resolveWindow(flat(40), 'l28'), run(flat(40)).curve, DEFAULT_SETTINGS, () => false)
  assert.equal(d.scope, 'unknown')
  assert.match(d.scopeText, /does not cover the whole previous period/)
})

test('imports that cover different dates: windows follow the page and query tables, and a table is only used for dates it covers', () => {
  const page = 'https://a.example/p'
  const rows = (g: string, from: string, to: string, clicks = 10): Fact[] => {
    const out: Fact[] = []
    for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) out.push({ g, date: new Date(t).toISOString().slice(0, 10), ...(g.includes('page') ? { page } : {}), ...(g.includes('query') ? { query: 'q' } : {}), clicks, impressions: 100, position: 3 })
    return out
  }
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`)
  const run = (ds: Fact[], w = windowOptions(ds)[0]) => analyze(ds, w, DEFAULT_SETTINGS)
  // Flat page rows that end before the chart does: nothing decayed.
  const early = [...rows('page', '2026-01-01', '2026-09-07'), ...rows('', '2026-08-10', '2026-11-08'), { g: 'page', period: 'cur', page, clicks: 900, impressions: 9000, position: 3 } as Fact]
  assert.deepEqual(run(early).actions, [])
  assert.deepEqual(run(early).win.cur, ['2026-08-11', '2026-09-07'])
  assert.deepEqual(windowOptions(early).slice(0, 3), ['l28', 'l3m', '2026-08'])
  near(run(early).totals.cur.clicks, 304.4)
  // A chart that ends before the page rows start is not the total of a month it does not hold.
  const late = [...rows('page', '2026-09-01', '2026-10-30'), ...rows('', '2026-07-23', '2026-08-21')]
  near(run(late).totals.cur.clicks, 304.4)
  near(run(late).pages[0].clicks, 304.4)
  assert.deepEqual(windowOptions(late).filter(w => /^\d/.test(w)), ['2026-09'])
  // Two page tables: the one that holds the window is read, and decay needs one that holds every month.
  const two = [...rows('page', '2026-01-01', '2026-06-30'), ...rows('query|page', '2026-03-01', '2026-10-31', 4)]
  near(run(two, '2026-05').pages[0].clicks, 10 * 31 * 30.44 / 31)
  near(run(two, '2026-10').pages[0].clicks, 4 * 31 * 30.44 / 31)
  assert.deepEqual(run(two, '2026-10').decay, [])
  // A handful of newer query rows does not shrink the window to their days.
  assert.equal(run([...rows('page', '2026-01-01', '2026-10-31'), ...rows('query|page', '2026-11-01', '2026-11-03')]).win.days, 28)
  // Undated page rows next to dated query + page rows do not hide the decay.
  const fall = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].flatMap((m, i) => rows('query|page', `${m}-01`, `${m}-28`, 60 - i * 10))
  assert.equal(run([...fall, ...rows('query|page', '2026-10-29', '2026-10-31', 10), { g: 'page', period: 'cur', page, clicks: 9, impressions: 90, position: 3 }]).decay.length, 1)
})

test('decay tells "could not look" from "none found"', () => {
  const pages = (n: number, from = 0): Fact[] => Array.from({ length: n }, (_, i) => ({ g: 'page', date: day(from + i), page: 'https://a.example/p', clicks: 10, impressions: 100, position: 3 }))
  const chart: Fact[] = Array.from({ length: 200 }, (_, i) => ({ g: '', date: day(i), clicks: 10, impressions: 100, position: 3 }))
  const undated: Fact = { g: 'page', period: 'cur', page: 'https://a.example/p', clicks: 9, impressions: 90, position: 3 }
  const state = (ds: Fact[], w = windowOptions(ds)[0], s = DEFAULT_SETTINGS) => analyze(ds, w, s).decayCheck.state
  assert.equal(state([undated, ...chart]), 'no-rows')
  assert.equal(state(chart), 'no-rows')
  assert.equal(state([undated]), 'no-rows')
  assert.equal(state(pages(120)), 'short')
  assert.equal(state(pages(120), 'l28', { ...DEFAULT_SETTINGS, decayMonths: 4 }), 'ok')
  assert.equal(state(pages(181)), 'ok')
  assert.equal(state([...pages(181), undated], 'export'), 'no-range')
  // Page rows that stop before the range do not count as looked at.
  assert.equal(state([...pages(181), ...pages(120, 181).map(f => ({ ...f, g: 'query', page: undefined, query: 'q' }))], '2026-09'), 'short')
})

test('months of different length: a flat site shows no change in any month', () => {
  const ds: Fact[] = Array.from({ length: 366 }, (_, i) => [
    { g: '', date: day(i), clicks: 10, impressions: 100, position: 3 },
    { g: 'query|page', date: day(i), query: i % 2 ? 'acme' : 'shoes', page: 'https://a.example/blog/p', clicks: 10, impressions: 100, position: 3 },
    { g: 'query|page', date: day(i), query: 'x', page: 'https://a.example/y', clicks: 10, impressions: 100, position: 3 },
  ]).flat()
  for (const w of windowOptions(ds)) {
    const a = analyze(ds, w, { ...DEFAULT_SETTINGS, brandTerms: ['acme'] })
    if (!a.totals.prev) continue
    const same = (x: number, y: number) => assert.ok(Math.abs(x - y) < 1e-9, `${w}: ${x} is not ${y}`)
    same(a.totals.prev.clicks, 304.4); same(a.totals.cur.clicks, 304.4); same(a.totals.prev.position, 3)
    for (const p of a.pages) same(p.prevClicks, p.clicks)
    for (const g of a.groups) same(g.prevClicks, g.clicks)
    const d = diagnose(ds, a.win, a.curve, DEFAULT_SETTINGS, q => q === 'acme')
    same(d.rel, 0); same(d.total.delta, 0); assert.equal(d.scope, 'none')
    for (const row of d.by.page!) same(row.delta, 0)
  }
  // Half the traffic is still half: 310 clicks in January scaled to 28 days is 280, February has 140.
  const half = ds.filter(f => f.g === '' && f.date! < '2026-03-01').map(f => ({ ...f, clicks: f.date! < '2026-02-01' ? 10 : 5 }))
  const d = diagnose(half, resolveWindow(half, '2026-02'), fitCurve([]), DEFAULT_SETTINGS, () => false)
  assert.deepEqual([d.total.prev.clicks, d.total.cur.clicks, d.rel], [280, 140, -0.5])
  assert.ok(Math.abs(d.total.demand + d.total.rank + d.total.ctr - d.total.delta) < 1e-9)
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
  assert.equal(c.resolved!.length + c.open.length, a.actions.length)
  assert.equal(c.added!.length + c.open.length, b.actions.length)
  assert.ok(Math.abs(c.clicks - (b.totals.clicks - a.totals.clicks)) < 1e-9)
})

test('snapshots compare: moves cover both lists, and what a cut-off list leaves out is unknown', () => {
  const base = analyze(generate('ledgerly'), 'l28', DEFAULT_SETTINGS)
  const make = (id: string, pages: [string, number][], actions: string[]) => snapshot({ ...base, pages: pages.map(([page, clicks]) => ({ page, clicks, impressions: 1, position: 1, prevClicks: 0 })), actions: actions.map(x => ({ ...base.actions[0], id: x, title: x })) }, id, id, id)
  const many = (n: number, f = (i: number) => 1000 - i) => Array.from({ length: n }, (_, i) => [`p${i}`, f(i)] as [string, number])
  const ids = (n: number, p = 'x') => Array.from({ length: n }, (_, i) => p + i)
  // 500 -> 0, 290 -> 300, an action that slips from rank 40 to 41.
  const a = make('a', [['gone', 500], ...many(30, i => 400 - i), ['up', 290]], ids(45))
  const b = make('b', [...many(30, i => 400 - i), ['up', 300]], [...ids(39), 'other', 'x39', ...ids(45).slice(40)])
  const c = compareSnapshots(a, b)
  assert.deepEqual(c.movers[0], { page: 'gone', before: 500, after: 0 })
  assert.deepEqual(c.movers[1], { page: 'up', before: 290, after: 300 })
  assert.deepEqual([c.resolved!.length, c.added!.map(x => x.id), c.open.length], [0, ['other'], 45])
  // Older snapshots kept the top 25 pages and 40 actions.
  const old = (s: typeof a) => { const { pageCount: _, ...rest } = s; return { ...rest, pages: s.pages.slice(0, 25), actions: s.actions.slice(0, 40) } }
  const o = compareSnapshots(old(a), old(b))
  assert.deepEqual([o.resolved, o.added], [null, null])
  assert.deepEqual(o.movers[0], { page: 'gone', before: 500, after: null })
  assert.ok(o.movers.every(m => m.before !== 0 && m.after !== 0))
  assert.deepEqual(compareSnapshots(old(make('a', [['p', 9]], ['x'])), make('b', [['q', 4]], [])).movers, [{ page: 'p', before: 9, after: 0 }, { page: 'q', before: 0, after: 4 }])
  // A snapshot without page rows says nothing about pages.
  assert.deepEqual(compareSnapshots(make('a', [], []), make('b', [['p', 9]], [])).movers, [])
  // More than is kept.
  const big = compareSnapshots(make('a', many(1200, i => 2000 - i), ids(600)), make('b', many(1200, i => 3000 - i), ids(600, 'y')))
  assert.deepEqual([big.resolved, big.added], [null, null])
  assert.ok(big.movers.every(m => m.after! - m.before! === 1000))
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

// ---------- Real export layouts ----------
// Header rows below are copied from exports that site owners published on GitHub (checked 2026-11-13);
// data rows are short excerpts or rows written to match the same layout.

const load = (csv: string, name: string) => { const t = parseCsv(csv, name); const map = autoMap(t.rows[0]); return { t, map, kind: detectKind(t, map), v: validate(t, map) } }
const facts = (tables: Table[]) => tables.reduce<Fact[]>((ds, t) => { const map = autoMap(t.rows[0] ?? []); const k = detectKind(t, map); return k === 'ignored' || k === 'unknown' ? ds : mergeFacts(ds, validate(t, map).facts) }, [])

test('German export: Suchanfragen, Seiten, Geräte, Länder, Diagramm and Filter are all recognised', () => {
  assert.equal(load('Häufigste Suchanfragen,Klicks,Impressionen,CTR,Position\nsemrush report,0,6,0%,33.5\n', 'Suchanfragen.csv').kind, 'queries')
  assert.equal(load('Die häufigsten Seiten,Klicks,Impressionen,CTR,Position\nhttps://www.example.de/,3,149,2.01%,3.21\n', 'Seiten.csv').kind, 'pages')
  assert.equal(load('Land,Klicks,Impressionen,CTR,Position\nDeutschland,3,499,0.6%,4.25\n', 'Länder.csv').kind, 'countries')
  assert.equal(load('Datum,Klicks,Impressionen,CTR,Position\n2026-01-02,1,40,2.5%,4.1\n', 'Diagramm.csv').kind, 'dates')
  const d = load('Gerät,Klicks,Impressionen,CTR,Position\nComputer,3,198,1.52%,7.83\nMobil,2,457,0.44%,3.18\nTablet,0,4,0%,4\n', 'Geräte.csv')
  assert.equal(d.kind, 'devices')
  assert.deepEqual(d.v.facts.map(f => f.device), ['Desktop', 'Mobile', 'Tablet'])
  const f = parseCsv('Filtern,Wert\nSuchtyp,Web\nDatum,Letzte 3 Monate', 'Filter.csv')
  assert.equal(detectKind(f), 'ignored')
  assert.equal(filtersNote([f]), 'Suchtyp: Web · Datum: Letzte 3 Monate')
  assert.equal(detectKind(parseCsv('Darstellung in der Suche,Klicks,Impressionen,CTR,Position\nx,1,2,50%,1', 'Darstellung in der Suche.csv')), 'ignored')
})

test('French, Spanish and Italian exports map every column and normalise device names', () => {
  const fr = load('Requêtes les plus fréquentes,Clics,Impressions,CTR,Position\ncarbo carcassonne,89,240,37.08%,1.04\n', 'Requêtes.csv')
  assert.equal(fr.kind, 'queries'); assert.equal(fr.v.facts[0].clicks, 89)
  assert.equal(load('Pages les plus populaires,Clics,Impressions,CTR,Position\nhttp://example.fr/,150,2598,5.77%,3.06\n', 'Pages.csv').kind, 'pages')
  assert.deepEqual(load('Appareil,Clics,Impressions,CTR,Position\nMobile,226,3004,7.52%,3.65\nOrdinateur,26,495,5.25%,5.57\nTablette,3,36,8.33%,3.4\n', 'Appareils.csv').v.facts.map(f => f.device), ['Mobile', 'Desktop', 'Tablet'])
  const es = load('Consultas principales,Clics,Impresiones,CTR,Posición\npoketypes,8,162,4.94%,6.27\n', 'Consultas.csv')
  assert.equal(es.kind, 'queries'); assert.equal(es.v.facts[0].position, 6.27)
  assert.deepEqual(load('Dispositivo,Clics,Impresiones,CTR,Posición\nMóviles,11,96,11.46%,6.47\nOrdenador,10,280,3.57%,32.91\n', 'Dispositivos.csv').v.facts.map(f => f.device), ['Mobile', 'Desktop'])
  assert.equal(load('Query più frequenti,Clic,Impressioni,CTR,Posizione\nunlistened,0,344,0%,9.64\n', 'Query.csv').kind, 'queries')
  assert.equal(load('Pagine principali,Clic,Impressioni,CTR,Posizione\nhttps://www.example.it/,0,349,0%,9.43\n', 'Pagine.csv').kind, 'pages')
  const it = load('Data,Clic,Impressioni,CTR,Posizione\n2026-02-07,0,6,0%,31.5\n', 'Grafico.csv')
  assert.equal(it.kind, 'dates'); assert.deepEqual(it.v.range, ['2026-02-07', '2026-02-07'])
  assert.deepEqual(load('Dispositivo,Clic,Impressioni,CTR,Posizione\nDispositivo mobile,1,122,0.82%,9.22\nComputer,0,335,0%,12.35\n', 'Dispositivi.csv').v.facts.map(f => f.device), ['Mobile', 'Desktop'])
})

test('numbers: thousands separators and decimal commas are told apart', () => {
  assert.equal(parseNum('1,234'), 1234)
  assert.equal(parseNum('12,345.6'), 12345.6)
  assert.equal(parseNum('11,75'), 11.75)
  assert.equal(parseNum('1.234,5'), 1234.5)
  assert.equal(parseNum('1 234'), 1234)
  assert.equal(parseCtr('3,65 %'), 0.0365)
  const v = load('Pays;Clics;Impressions;CTR;Position\nFrance;234;3235;7,23 %;3,75\n', 'Pays.csv').v
  assert.equal(v.facts[0].position, 3.75); assert.equal(v.issues.length, 0)
})

test('Analytics Search Console report: "#" preamble is skipped and the long headers map (English and German)', () => {
  const pre = '# ----------------------------------------\n# Queries: Organic Google Search query\n# Account: Demo\n# ----------------------------------------\n# \n# All Users\n# Start date: 20260414\n# End date: 20260511\n'
  const en = load(pre + 'Organic Google Search query,Organic Google Search clicks,Organic Google Search impressions,Organic Google Search click-through rate,Organic Google Search average position\nseo reporting,2,30,0.0667,12.5\n', 'Queries.csv')
  assert.equal(en.kind, 'queries'); assert.equal(en.v.issues.length, 0)
  assert.deepEqual([en.v.facts[0].clicks, en.v.facts[0].impressions, en.v.facts[0].position], [2, 30, 12.5])
  assert.equal(en.t.lines[1], 10)
  const de = load(pre + 'Suchanfrage in den organischen Suchergebnissen bei Google,Klicks in den organischen Suchergebnissen bei Google,Impressionen in den organischen Suchergebnissen bei Google,Klickrate in den organischen Suchergebnissen bei Google,Durchschnittliche Position in den organischen Suchergebnissen bei Google\nseo reporting monatlich,0,3,0,81.66666666666667\n', 'Suchanfragen.csv')
  assert.equal(de.kind, 'queries'); assert.equal(de.v.facts[0].impressions, 3)
})

test('compare mode: a query that vanished keeps its previous period and raises no warning', () => {
  const { v } = load('Top queries,Last 28 days Clicks,Previous 28 days Clicks,Last 28 days Impressions,Previous 28 days Impressions,Last 28 days CTR,Previous 28 days CTR,Last 28 days Position,Previous 28 days Position\n'
    + 'radiance clinic,37,16,677,466,5.47%,3.43%,11.76,18.9\nclosed comedones,0,0,0,370,0%,0%,0,10.98\nbest skin clinic,1,0,1,0,100%,0%,1,0\n', 'Queries.csv')
  assert.equal(v.issues.length, 0)
  assert.deepEqual(v.facts.map(f => `${f.query}:${f.period}:${f.impressions}`), ['radiance clinic:cur:677', 'radiance clinic:prev:466', 'closed comedones:prev:370', 'best skin clinic:cur:1'])
})

test('CSV exports: text cannot become a formula, numbers stay numbers, and our own CSV reads back', () => {
  assert.equal(toCsv([['=1+1', '+1', '-1', '@x', '\tx', 'a=1', -5]]), `'=1+1,'+1,'-1,'@x,'\tx,a=1,-5\n`)
  assert.equal(toCsv([['=HYPERLINK("x","y")']]), `"'=HYPERLINK(""x"",""y"")"\n`)
  assert.match(redirectCsv([{ from: '=a', to: 'https://a.example/', action: '301', reason: 'r, s', queries: ['@q'] }]), /\n'=a,https:\/\/a.example\/,301,"r, s",'@q\n$/)
  for (const q of ['=1+1', '+app', '-minus', '@handle', "'quoted", "'90s", 'plain, "x"']) {
    const t = parseCsv(factsToCsv([{ g: 'query', date: '2026-10-01', query: q, clicks: 1, impressions: 10, position: 3 }]))
    const map = autoMap(t.rows[0])
    for (const d of ['page', 'country', 'device'] as const) delete map[d]
    assert.equal(validate(t, map).facts[0].query, q)
  }
  // Someone else's file keeps its text as it is.
  assert.equal(load(`Top queries,Clicks,Impressions,CTR,Position\n'=x,1,10,10%,3\n`, 'Queries.csv').v.facts[0].query, "'=x")
})

test('jump-link rows are added to their page instead of replacing it (lets-plot.org excerpt)', () => {
  const { v } = load('Top pages,Clicks,Impressions,CTR,Position\nhttps://lets-plot.org/python/index.html,246,17436,1.41%,13.6\nhttps://lets-plot.org/python/index.html#python-index-user-guide,0,1043,0%,3.32\nhttps://lets-plot.org/python/index.html#user-guide,0,65,0%,4.08\n', 'Pages.csv')
  assert.equal(v.facts.length, 1)
  assert.equal(v.facts[0].clicks, 246)
  assert.equal(v.facts[0].impressions, 17436 + 1043 + 65)
  assert.ok(Math.abs(v.facts[0].position - (13.6 * 17436 + 3.32 * 1043 + 4.08 * 65) / 18544) < 1e-9)
  assert.deepEqual(v.issues.map(i => i.message), ['2 rows for #section links were added to their page.'])
  // The API returns the same thing as separate keys.
  const api = sumDuplicates([{ g: 'page', date: '2026-01-01', page: 'https://a.example/x', clicks: 4, impressions: 100, position: 2 }, { g: 'page', date: '2026-01-01', page: 'https://a.example/x', clicks: 1, impressions: 300, position: 6 }])
  assert.deepEqual(api.map(f => [f.clicks, f.impressions, f.position]), [[5, 400, 5]])
})

test('numbers are read by field: counts are whole, positions are decimals', () => {
  for (const [s, n] of [['1.234', 1234], ['1.234.567', 1234567], ['1,234', 1234], ['1,234,567', 1234567], ['1 234', 1234], ["1'234", 1234], ['1’234', 1234], ['12', 12], ['12.0', 12], ['0', 0]] as const) assert.equal(parseCount(s), n, s)
  assert.equal(parseCount('5.000', true), 5)
  for (const [s, n] of [['7,125', 7.125], ['7.125', 7.125], ['11,75', 11.75], ['3', 3], ['1,234.5', 1234.5]] as const) assert.equal(parsePosition(s), n, s)
  assert.equal(parseNum('0,125'), 0.125)
  for (const s of ['', '-', 'many', '1.2.3', '1.23.456']) { assert.ok(Number.isNaN(parseCount(s)), s); assert.ok(Number.isNaN(parsePosition(s)), s) }
  // 1,234 / 45,678 = 2.7%, as the file says.
  const de = load('Die häufigsten Seiten;Klicks;Impressionen;CTR;Position\nhttps://a.example/;1.234;45.678;2,7%;7,125\n', 'Seiten.csv').v
  assert.deepEqual([de.facts[0].clicks, de.facts[0].impressions, de.facts[0].position], [1234, 45678, 7.125])
  assert.deepEqual(de.issues.map(i => i.level), ['warning'])
  // A table that shows dot decimals elsewhere keeps "5.000" as 5; a real fraction of a click is refused.
  const us = load('page,clicks,impressions,position\nhttps://a.example/,5.000,1234.000,3\nhttps://a.example/b,2.500,100.000,3\n', 'rows.csv').v
  assert.deepEqual([us.facts[0].clicks, us.facts[0].impressions, us.facts.length], [5, 1234, 1])
  assert.match(us.issues[0].message, /Clicks "2.500" is not a whole number/)
})

test('raw BigQuery searchdata_url_impression: zero-based sum_position, anonymised and non-web rows', () => {
  const head = 'data_date,site_url,url,query,is_anonymized_query,is_anonymized_discover,country,search_type,device,impressions,clicks,sum_position'
  const { kind, v } = load(head + '\n5/7/2024,https://nbastats.pro/,https://nbastats.pro/player/Larry_Bird,bird stats,FALSE,FALSE,esp,WEB,DESKTOP,4,1,10\n5/7/2024,https://nbastats.pro/,https://nbastats.pro/,,TRUE,FALSE,are,WEB,MOBILE,1,0,0\n5/8/2024,https://nbastats.pro/,https://nbastats.pro/,nba stats,FALSE,FALSE,usa,IMAGE,MOBILE,9,0,27\n', 'url.csv')
  assert.equal(kind, 'rows')
  assert.equal(v.facts.length, 1)
  assert.deepEqual([v.facts[0].date, v.facts[0].country, v.facts[0].device, v.facts[0].position], ['2024-05-07', 'ESP', 'Desktop', 3.5])
  assert.equal(v.skipped, 0)
  assert.equal(v.issues.length, 2)
  assert.ok(v.issues.every(i => i.level === 'warning'))
})

test('raw BigQuery: rows that share a key are parts of one total', () => {
  const head = 'data_date,url,query,country,search_type,device,is_video,impressions,clicks,sum_position\n'
  const row = (video: string, imp: number, clicks: number, sum: number, q = 'shoes') => `2026-10-01,https://a.example/,${q},usa,WEB,MOBILE,${video},${imp},${clicks},${sum}\n`
  const { v } = load(head + row('false', 100, 10, 200) + row('true', 40, 5, 40) + row('true', 40, 5, 40), 'url.csv')
  // 20 clicks, 180 impressions, position (200 + 40 + 40) / 180 + 1
  assert.equal(v.facts.length, 1)
  assert.deepEqual([v.facts[0].clicks, v.facts[0].impressions], [20, 180])
  assert.ok(Math.abs(v.facts[0].position - (280 / 180 + 1)) < 1e-9)
  assert.deepEqual(v.issues.map(i => i.message), ['2 rows with the same key were added up.'])
  // Importing the same file again replaces the total.
  assert.deepEqual(mergeFacts(v.facts, v.facts), v.facts)
  // A zero-impression part changes nothing, and other tables still warn about duplicates.
  assert.equal(load(head + row('false', 100, 10, 200) + row('true', 0, 0, 0), 'url.csv').v.facts[0].clicks, 10)
  const dup = load('date,query,clicks,impressions,position\n2026-10-01,shoes,1,10,3\n2026-10-01,shoes,2,20,3\n', 'rows.csv').v
  assert.match(dup.issues[0].message, /later row wins/)
})

test('Search Analytics API JSON: unnamed keys are recognised by their values', () => {
  const t = jsonTable({ rows: [
    { keys: ['2026-10-01', 'banana bread recipe', 'https://a.example/banana-bread/', 'usa', 'MOBILE'], clicks: 12, impressions: 340, ctr: 0.0353, position: 5.4 },
    { keys: ['2026-10-01', 'usa', 'https://a.example/usa-guide/', 'gbr', 'DESKTOP'], clicks: 1, impressions: 20, ctr: 0.05, position: 9 },
  ] })
  assert.deepEqual(t.rows[0], ['date', 'query', 'page', 'country', 'device', 'clicks', 'impressions', 'ctr', 'position'])
  const v = validate(t, autoMap(t.rows[0]))
  assert.equal(detectKind(t), 'rows')
  assert.deepEqual(v.facts.map(f => [f.g, f.query, f.country, f.device]), [['query|page|country|device', 'banana bread recipe', 'USA', 'Mobile'], ['query|page|country|device', 'usa', 'GBR', 'Desktop']])
  const flat = jsonTable([{ data_date: { value: '2026-10-01' }, url: 'https://a.example/', clicks: 3, impressions: 10, position: 2 }])
  assert.equal(validate(flat, autoMap(flat.rows[0])).facts[0].date, '2026-10-01')
  assert.throws(() => jsonTable({ error: { code: 403 } }), /No rows/)
})

test('readFile routes JSON by content, not by extension', async () => {
  const buf = new TextEncoder().encode(JSON.stringify({ rows: [{ keys: ['shoes'], clicks: 1, impressions: 9, ctr: 0.11, position: 3 }] })).buffer as ArrayBuffer
  const [t] = await readFile('response.txt', buf)
  assert.deepEqual(t.rows[1], ['shoes', '1', '9', '0.11', '3'])
})

test('export length is read from the Filters table in several languages', () => {
  const f = (h: string, row: string) => filterDays([parseCsv(`${h}\n${row}`, 'Filters.csv')])
  assert.equal(f('Filter,Value', 'Date,Last 28 days'), 28)
  assert.equal(f('Filter,Value', 'Date,Last 3 months'), 91)
  assert.equal(f('Filtern,Wert', 'Datum,Letzte 7 Tage'), 7)
  assert.equal(f('Filtrar,Valor', 'Fecha,Últimos 3 meses'), 91)
  assert.equal(f('Filtra,Valore', 'Data,Ultimi 16 mesi'), 487)
  assert.equal(f('Filter,Value', 'Date,1 Jan 2024-18 Dec 2024'), 353)
  assert.equal(f('Filtre,Valeur', 'Date,1 juin 2026-30 juin 2026'), null)
  assert.equal(filterDays([parseCsv('Top queries,Clicks\nx,1')]), null)
})

test('a standard export is analysed as its own period, not rescaled to a 28-day window', () => {
  // 91 daily rows (some with no impressions) next to undated 3-month tables, as in the zip.
  const chart = 'Date,Clicks,Impressions,CTR,Position\n' + Array.from({ length: 91 }, (_, i) => i % 9 === 0 ? `${day(i)},0,0,,` : `${day(i)},10,200,5%,7`).join('\n')
  const ds = facts([
    parseCsv(chart, 'Chart.csv'),
    parseCsv('Top queries,Clicks,Impressions,CTR,Position\nmini diary,300,3000,10%,3\nencrypted journal,90,6000,1.5%,9\n', 'Queries.csv'),
    parseCsv('Top pages,Clicks,Impressions,CTR,Position\nhttps://a.example/,500,9000,5.56%,6\nhttps://a.example/journal/,300,7000,4.29%,8\n', 'Pages.csv'),
    parseCsv('Device,Clicks,Impressions,CTR,Position\nDesktop,600,12000,5%,7\nMobile,200,4000,5%,7\n', 'Devices.csv'),
  ])
  assert.equal(ds.filter(f => f.g === '').length, 91)
  assert.deepEqual(windowOptions(ds), ['export'])
  const a = analyze(ds, 'export', DEFAULT_SETTINGS)
  assert.equal(a.win.days, 91)
  const perMonth = 30.44 / 91
  assert.ok(Math.abs(a.totals.cur.clicks - 800 * perMonth) < 1e-6)
  assert.ok(Math.abs(a.points.reduce((s2, p) => s2 + p.clicks, 0) - 390 * perMonth) < 1e-6)
  assert.ok(Math.abs(a.pages.reduce((s2, p) => s2 + p.clicks, 0) - 800 * perMonth) < 1e-6)
})

test('export length belongs to one export, not to every chart ever imported', () => {
  const chart = (from: number, n: number) => parseCsv('Date,Clicks,Impressions,CTR,Position\n' + Array.from({ length: n }, (_, i) => `${day(from + i)},10,100,10%,3`).join('\n'), 'Chart.csv')
  const pages = (n: number) => parseCsv(`Top pages,Clicks,Impressions,CTR,Position\nhttps://a.example/,${n * 10},${n * 100},10%,3`, 'Pages.csv')
  const filters = parseCsv('Filter,Value\nDate,Last 28 days', 'Filters.csv')
  assert.equal(exportLength([pages(31), chart(0, 31), filters]), 31)
  assert.equal(exportLength([pages(28), filters]), 28)
  assert.equal(exportLength([pages(28)]), null)
  assert.equal(exportLength([]), null)
  const ds = mergeFacts(facts([chart(0, 31), pages(31)]), facts([chart(31, 28), pages(28)]))
  const a = analyze(ds, 'export', { ...DEFAULT_SETTINGS, exportDays: 28 })
  assert.equal(a.win.days, 28)
  // 280 clicks x 30.44 / 28 = 304.4
  assert.ok(Math.abs(a.pages[0].clicks - 304.4) < 1e-6)
})

test('compare export without a chart takes its length from exportDays', () => {
  const t = parseCsv('Device,Last 28 days Clicks,Previous 28 days Clicks,Last 28 days Impressions,Previous 28 days Impressions,Last 28 days CTR,Previous 28 days CTR,Last 28 days Position,Previous 28 days Position\nMobile,414,436,38443,41348,1.08%,1.05%,7.92,9.04\nDesktop,101,94,12121,14763,0.83%,0.64%,29.76,27.43\n', 'Devices.csv')
  const ds = facts([t])
  assert.equal(resolveWindow(ds, 'export').days, 90)
  const a = analyze(ds, 'export', { ...DEFAULT_SETTINGS, exportDays: 28 })
  assert.equal(a.win.days, 28)
  assert.ok(Math.abs(a.totals.cur.clicks - 515 * 30.44 / 28) < 1e-6)
  assert.ok(Math.abs(a.totals.prev!.clicks - 530 * 30.44 / 28) < 1e-6)
})

test('dated windows read dated rows only when API rows and an undated export sit side by side', () => {
  const api: Fact[] = Array.from({ length: 60 }, (_, i) => ({ g: 'query|page', date: day(i), query: 'q', page: 'https://a.example/p', clicks: 2, impressions: 50, position: 4 }))
  const ui: Fact[] = [{ g: 'query', period: 'cur', query: 'q', clicks: 9000, impressions: 90000, position: 4 }]
  const ds = [...api, ...ui]
  assert.deepEqual(windowOptions(ds).slice(0, 1), ['l28'])
  assert.ok(windowOptions(ds).includes('export'))
  const dated = slice(ds, ['query'], resolveWindow(ds, 'l28'))
  assert.equal(dated.grain, 'query|page')
  assert.equal([...dated.cur.values()][0].clicks, 56)
  const exp = slice(ds, ['query'], resolveWindow(ds, 'export'))
  assert.equal(exp.grain, 'query')
  assert.equal([...exp.cur.values()][0].clicks, 9000)
})

test('status feed: ranking incidents become updates, open ones are still rolling out', () => {
  // Shape of https://status.search.google.com/incidents.json, trimmed to the fields read.
  const feed = [
    { begin: '2026-11-10T18:06:00+00:00', external_desc: 'November 2026 core update', service_name: 'Ranking', updates: [{ text: 'Released the November 2026 core update. The rollout may take up to 2 weeks to complete.' }] },
    { begin: '2026-09-24T16:15:00+00:00', end: '2026-10-08T08:00:00+00:00', external_desc: 'September 2026 spam update', service_name: 'Ranking' },
    { begin: '2026-02-25T03:55:00+00:00', end: '2026-02-25T04:10:00+00:00', external_desc: 'Serving was experiencing an issue', service_name: 'Serving' },
    { begin: '2026-02-05T17:00:00+00:00', end: '2026-02-27T10:00:00+00:00', external_desc: 'February 2026 Discover update', service_name: 'Ranking' },
  ]
  const live = fromIncidents(feed, '2026-11-13')
  assert.deepEqual(live.map(u => [u.name, u.start, u.days, u.kind, !!u.ongoing]), [
    ['November 2026 core update', '2026-11-10', 14, 'core', true],
    ['September 2026 spam update', '2026-09-24', 14, 'spam', false],
    ['February 2026 Discover update', '2026-02-05', 22, 'other', false],
  ])
  assert.equal(fromIncidents(feed, '2026-12-20')[0].days, 40)
  assert.deepEqual(fromIncidents({ error: 'x' }, '2026-11-13'), [])
  // The built-in table agrees with the feed for every update the feed still lists.
  for (const u of live.filter(x => !x.ongoing)) assert.equal(BUILT_IN.find(b => b.name === u.name)?.days, u.days)
  const merged = mergeUpdates(BUILT_IN, [...live, { name: 'December 2026 spam update', start: '2026-12-02', days: 3, kind: 'spam' }])
  assert.equal(merged.length, BUILT_IN.length + 1)
  assert.equal(merged[0].name, 'December 2026 spam update')
  assert.deepEqual(updatesNear('2026-11-12', '2026-11-13', merged).map(u => u.name), ['November 2026 core update'])
})

test('bundled public export (lets-plot.org 2024, MIT, JetBrains) imports cleanly end to end', async () => {
  const b = readFileSync(new URL('../../public/samples/lets-plot-org-2024.zip', import.meta.url))
  const tables = await readFile('lets-plot.zip', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
  assert.equal(tables.length, 7)
  assert.equal(filterDays(tables), 353)
  for (const t of tables) { const k = detectKind(t); if (k !== 'ignored') assert.equal(validate(t, autoMap(t.rows[0])).skipped, 0, t.name) }
  const ds = facts(tables)
  const a = analyze(ds, 'export', DEFAULT_SETTINGS)
  assert.equal(a.win.days, 339)
  // Site, device and country tables agree on the click total; pages overlap slightly because one search can show two URLs.
  const sum = (g: string) => ds.filter(f => f.g === g).reduce((s2, f) => s2 + f.clicks, 0)
  assert.deepEqual([sum(''), sum('device'), sum('country')], [14429, 14429, 14429])
  assert.equal(a.curve.kind, 'isotonic')
  assert.ok(a.curve.knots.every((k, i, all) => i === 0 || k.ctr <= all[i - 1].ctr + 1e-12))
  assert.ok(a.striking.some(p => p.query === 'geom_smooth'))
  assert.equal(a.has.queryPage, false)
})

test('drop window: equal before/after spans inside the data, and a dip that recovered is not a drop', () => {
  const series = (f: (i: number) => number, n: number): Fact[] => Array.from({ length: n }, (_, i) => ({ g: '', date: day(i), clicks: f(i), impressions: f(i) * 20, position: 8 }))
  // 20 days at 100 clicks, then a lasting step down to 50.
  const w = dropWindow(series(i => i < 20 ? 100 : 50, 80))!
  assert.equal(w.prev![1], day(19))
  assert.equal(w.prev![0], day(0))
  assert.equal(w.days, 20)
  assert.equal((Date.parse(w.cur![1]) - Date.parse(w.cur![0])) / 86400000 + 1, 20)
  // A five-day spike ending looks like a step down on a 14-day average, but traffic is back to normal after it.
  assert.equal(dropWindow(series(i => i >= 16 && i < 21 ? 300 : 100, 80)), null)
})

test('change point ignores sites with almost no clicks', () => {
  const daily = Array.from({ length: 60 }, (_, i) => ({ date: day(i), clicks: i < 30 && i % 10 === 0 ? 1 : 0 }))
  assert.equal(changePoint(daily), undefined)
})

test('a drop in site totals without dated page rows is reported as a drop of unknown scope, not "no drop"', () => {
  const ds: Fact[] = Array.from({ length: 80 }, (_, i) => ({ g: '', date: day(i), clicks: i < 30 ? 100 : 50, impressions: 2000, position: 8 }))
  const w = dropWindow(ds)!
  const d = diagnose(ds, w, fitCurve([]), DEFAULT_SETTINGS, () => false)
  assert.equal(d.scope, 'unknown')
  assert.ok(d.rel <= -0.4)
  assert.equal(Object.keys(d.by).length, 0)
  assert.ok(Math.abs(d.total.demand + d.total.rank + d.total.ctr - d.total.delta) < 1e-9)
})
