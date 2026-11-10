// Two synthetic sites. Every number is generated; no real Search Console data is used.
import type { Fact } from './types.ts'
import { addDays } from './updates.ts'

export interface SampleDef { id: string; name: string; blurb: string; site: string; brand: string[]; titles: Record<string, string> }

interface PageSpec { path: string; title: string; ctr?: number; shift?: (d: string) => number }
interface QuerySpec { q: string; vol: number; pages: [number, number][]; cannibal?: boolean }
interface Site { def: SampleDef; start: string; end: string; pages: PageSpec[]; queries: QuerySpec[]; season?: (d: string) => number }

const START = '2025-10-01', END = '2026-11-07'

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }
const ramp = (d: string, from: string, to: string) => d <= from ? 0 : d >= to ? 1 : (Date.parse(d) - Date.parse(from)) / (Date.parse(to) - Date.parse(from))

/** The "true" CTR curve the generator draws from; the engine has to recover something like it. */
const trueCtr = (p: number) => Math.min(0.42, 0.31 * Math.pow(p, -1.12))
const visibility = (p: number) => p <= 10.5 ? 1 : p <= 20.5 ? 0.3 : 0.08

// ---------- Butter Crumb: recipe blog with cannibalised banana bread pages and a decaying sourdough guide ----------

const recipes: [string, string, number, number, number?][] = [
  // [slug, name, base position, daily volume of "<name> recipe", ctr factor]
  ['chocolate-chip-cookies', 'chocolate chip cookies', 2.2, 900, 0.42],
  ['blueberry-muffins', 'blueberry muffins', 4.5, 420],
  ['cinnamon-rolls', 'cinnamon rolls', 6.5, 520],
  ['pizza-dough', 'pizza dough', 3.2, 610],
  ['focaccia', 'focaccia', 9.5, 380],
  ['brownies', 'fudgy brownies', 5.5, 450],
  ['lemon-drizzle-cake', 'lemon drizzle cake', 1.8, 260],
  ['pancakes', 'fluffy pancakes', 11.5, 700],
  ['carrot-cake', 'carrot cake', 7.5, 330],
  ['scones', 'scones', 3.8, 240],
  ['apple-pie', 'apple pie', 13.5, 520],
]

function butterCrumb(): Site {
  const site = 'https://buttercrumb.example'
  const pages: PageSpec[] = [
    { path: '/', title: 'Butter Crumb | Home Baking Recipes' },
    { path: '/banana-bread/', title: 'Banana Bread | Butter Crumb' },
    { path: '/easy-banana-bread-recipe/', title: 'Easy Banana Bread Recipe (One Bowl, No Mixer) | Butter Crumb' },
    { path: '/moist-banana-bread/', title: 'The Moistest Banana Bread You Will Ever Make | Butter Crumb' },
    // Decays from April: competitors refreshed their guides and this one slides down the page.
    { path: '/guides/sourdough-starter/', title: 'How to Make a Sourdough Starter From Scratch | Butter Crumb', shift: d => 6.5 * ramp(d, '2026-04-01', '2026-10-31') },
    { path: '/guides/sourdough-bread-beginners/', title: 'Sourdough Bread for Beginners | Butter Crumb' },
    { path: '/guides/baking-substitutions/', title: 'Baking Substitutions Chart | Butter Crumb' },
    { path: '/guides/how-to-proof-yeast/', title: 'How to Proof Yeast | Butter Crumb' },
    { path: '/guides/oven-temperature-conversion/', title: 'Oven Temperature Conversion | Butter Crumb' },
  ]
  const queries: QuerySpec[] = [
    { q: 'butter crumb', vol: 45, pages: [[0, 1.0]] },
    { q: 'buttercrumb recipes', vol: 18, pages: [[0, 1.1]] },
    { q: 'banana bread recipe', vol: 2400, pages: [[1, 5.5], [2, 6.0], [3, 7.5]], cannibal: true },
    { q: 'easy banana bread', vol: 950, pages: [[2, 4.0], [1, 4.8]], cannibal: true },
    { q: 'moist banana bread', vol: 640, pages: [[3, 4.5], [1, 5.0]], cannibal: true },
    { q: 'banana bread', vol: 1500, pages: [[1, 8.0], [2, 8.5]], cannibal: true },
    { q: 'banana bread with oil', vol: 120, pages: [[2, 3.2]] },
    { q: 'how to make a sourdough starter', vol: 520, pages: [[4, 2.1]] },
    { q: 'sourdough starter', vol: 900, pages: [[4, 3.4]] },
    { q: 'sourdough starter recipe', vol: 340, pages: [[4, 2.8]] },
    { q: 'feeding sourdough starter', vol: 160, pages: [[4, 4.2]] },
    { q: 'sourdough bread for beginners', vol: 260, pages: [[5, 9.4]] },
    { q: 'easy sourdough bread', vol: 330, pages: [[5, 12.5]] },
    { q: 'buttermilk substitute', vol: 1100, pages: [[6, 10.8]] },
    { q: 'egg substitute baking', vol: 520, pages: [[6, 14.5]] },
    { q: 'how to proof yeast', vol: 310, pages: [[7, 8.6]] },
    { q: 'gas mark 4 in celsius', vol: 640, pages: [[8, 2.6]] },
    { q: '180c to f', vol: 900, pages: [[8, 6.3]] },
  ]
  recipes.forEach(([slug, name, p, vol, f], i) => {
    const idx = pages.push({ path: `/${slug}/`, title: i === 0 ? 'Cookies' : `${name[0].toUpperCase() + name.slice(1)} Recipe | Butter Crumb`, ctr: f }) - 1
    queries.push(
      { q: `${name} recipe`, vol, pages: [[idx, p]] },
      { q: `easy ${name}`, vol: vol * 0.4, pages: [[idx, p + 1.4]] },
      { q: `best ${name} recipe`, vol: vol * 0.3, pages: [[idx, p + 3.8]] },
      { q: `how to make ${name}`, vol: vol * 0.22, pages: [[idx, Math.max(1.1, p - 0.6)], [0, p + 9]] },
      { q: `${name} calories`, vol: vol * 0.12, pages: [[idx, p + 11]] },
      { q: `vegan ${name}`, vol: vol * 0.15, pages: [[idx, p + 7.5]] },
    )
  })
  return {
    def: { id: 'butter-crumb', name: 'Butter Crumb (recipe blog)', blurb: 'Three banana bread pages fighting each other, a sourdough guide sliding since April, a cookie recipe with a one-word title.', site, brand: ['butter crumb'], titles: Object.fromEntries(pages.map(p => [site + p.path, p.title])) },
    start: START, end: END, pages, queries,
    season: d => 1 + 0.12 * Math.cos((new Date(d).getUTCMonth() - 11) / 12 * 2 * Math.PI),
  }
}

// ---------- Ledgerly: B2B invoicing SaaS hit by the May 2026 core update, concentrated in /blog/ ----------

function ledgerly(): Site {
  const site = 'https://ledgerly.example'
  const core = (k: number) => (d: string) => k * ramp(d, '2026-05-21', '2026-06-02')
  const pages: PageSpec[] = [
    { path: '/', title: 'Ledgerly: Invoicing and Expenses for Small Businesses' },
    { path: '/pricing/', title: 'Pricing | Ledgerly' },
    { path: '/features/invoicing/', title: 'Features | Ledgerly', ctr: 0.5 },
    { path: '/features/recurring-billing/', title: 'Recurring Billing | Ledgerly' },
    { path: '/integrations/quickbooks/', title: 'Ledgerly + QuickBooks Integration' },
    { path: '/compare/ledgerly-vs-freshbooks/', title: 'Ledgerly vs FreshBooks: Honest Comparison (2026)' },
    { path: '/blog/how-to-write-an-invoice/', title: 'How to Write an Invoice: Step-by-Step Guide | Ledgerly', shift: core(5.5) },
    { path: '/blog/invoice-template/', title: 'Free Invoice Template (Word, Excel, PDF) | Ledgerly', shift: core(4.5) },
    { path: '/blog/net-30-payment-terms/', title: 'Net 30 Payment Terms Explained | Ledgerly', shift: core(6.5) },
    { path: '/blog/late-payment-email/', title: 'Late Payment Email Templates That Work | Ledgerly', shift: core(5) },
    { path: '/blog/proforma-invoice/', title: 'What Is a Proforma Invoice? | Ledgerly', shift: core(7) },
    { path: '/blog/what-is-accounts-receivable/', title: 'What Is Accounts Receivable? | Ledgerly', shift: core(4) },
    { path: '/blog/days-sales-outstanding/', title: 'Days Sales Outstanding (DSO) Formula | Ledgerly', shift: core(6) },
  ]
  const queries: QuerySpec[] = [
    { q: 'ledgerly', vol: 160, pages: [[0, 1.0]] },
    { q: 'ledgerly login', vol: 120, pages: [[0, 1.0]] },
    { q: 'ledgerly pricing', vol: 40, pages: [[1, 1.1]] },
    { q: 'invoicing software', vol: 1300, pages: [[2, 4.2]] },
    { q: 'invoicing software for small business', vol: 520, pages: [[2, 3.6]] },
    { q: 'online invoicing', vol: 380, pages: [[2, 5.2]] },
    { q: 'recurring billing software', vol: 420, pages: [[3, 11.2]] },
    { q: 'subscription invoicing', vol: 210, pages: [[3, 9.1]] },
    { q: 'quickbooks invoicing integration', vol: 260, pages: [[4, 6.4]] },
    { q: 'freshbooks alternative', vol: 480, pages: [[5, 8.4]] },
    { q: 'ledgerly vs freshbooks', vol: 35, pages: [[5, 1.2]] },
    { q: 'how to write an invoice', vol: 1600, pages: [[6, 2.6]] },
    { q: 'how to make an invoice', vol: 900, pages: [[6, 3.4]] },
    { q: 'invoice example', vol: 700, pages: [[6, 5.5]] },
    { q: 'invoice template', vol: 3200, pages: [[7, 4.8]] },
    { q: 'free invoice template', vol: 1400, pages: [[7, 3.9]] },
    { q: 'invoice template word', vol: 800, pages: [[7, 6.1]] },
    { q: 'net 30', vol: 1100, pages: [[8, 3.1]] },
    { q: 'net 30 payment terms', vol: 600, pages: [[8, 2.2]] },
    { q: 'what does net 30 mean', vol: 420, pages: [[8, 2.9]] },
    { q: 'late payment email', vol: 520, pages: [[9, 2.4]] },
    { q: 'overdue invoice email template', vol: 300, pages: [[9, 3.3]] },
    { q: 'proforma invoice', vol: 900, pages: [[10, 4.1]] },
    { q: 'proforma invoice meaning', vol: 300, pages: [[10, 3.5]] },
    { q: 'accounts receivable', vol: 1500, pages: [[11, 9.8]] },
    { q: 'what is accounts receivable', vol: 640, pages: [[11, 6.2]] },
    { q: 'dso formula', vol: 380, pages: [[12, 3.0]] },
    { q: 'days sales outstanding', vol: 520, pages: [[12, 5.4]] },
  ]
  return {
    def: { id: 'ledgerly', name: 'Ledgerly (B2B SaaS)', blurb: 'Clicks halved after the May 2026 core update. The drop sits in /blog/; product pages held.', site, brand: ['ledgerly'], titles: Object.fromEntries(pages.map(p => [site + p.path, p.title])) },
    start: START, end: END, pages, queries,
    // B2B: weekdays are busier.
    season: d => [0.55, 1.1, 1.12, 1.1, 1.05, 0.95, 0.6][new Date(d).getUTCDay()] / 0.92,
  }
}

const DEVICES: [string, number, number, number][] = [['Mobile', 0.6, 0.55, 0.3], ['Desktop', 0.36, 0.41, -0.4], ['Tablet', 0.04, 0.04, 0.1]]
const COUNTRIES: [string, number][] = [['United States', 0.46], ['United Kingdom', 0.15], ['Canada', 0.09], ['Australia', 0.07], ['India', 0.08], ['Germany', 0.04], ['Other', 0.11]]

function build(s: Site): Fact[] {
  const r = rng(hash(s.def.id))
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r())
  const out: Fact[] = []
  const url = (i: number) => s.def.site + s.pages[i].path
  for (let d = s.start; d <= s.end; d = addDays(d, 1)) {
    const season = s.season?.(d) ?? 1
    const weekend = [0, 6].includes(new Date(d).getUTCDay()) ? 1.12 : 1
    const pageAgg = new Map<number, { c: number; i: number; ps: number }>()
    for (const q of s.queries) {
      const demand = q.vol * season * (s.season ? 1 : weekend) * (1 + 0.12 * gauss())
      const week = Math.floor((Date.parse(d) - Date.parse(s.start)) / (7 * 86400000))
      // Cannibalised queries: which page Google prefers flips from week to week.
      const leader = q.cannibal ? Math.floor(rng(hash(q.q) + week * 7919)() * q.pages.length) : 0
      q.pages.forEach(([pi, base], k) => {
        const lead = q.cannibal ? k === leader : k === 0
        const shiftPos = s.pages[pi].shift?.(d) ?? 0
        const p = Math.max(1, base + shiftPos + (q.cannibal && !lead ? 1.8 : 0) + 0.35 * gauss())
        const share = q.cannibal ? (lead ? 0.62 : 0.38 / (q.pages.length - 1)) : (k === 0 ? 0.95 : 0.05)
        const imp = Math.round(demand * share * visibility(p) * (1 + 0.1 * gauss()))
        if (imp <= 0) return
        const c = trueCtr(p) * (s.pages[pi].ctr ?? 1) * (1 + 0.15 * gauss())
        const clicks = Math.max(0, Math.min(imp, Math.round(imp * c + gauss() * Math.sqrt(imp * c * 0.5))))
        out.push({ g: 'query|page', date: d, query: q.q, page: url(pi), clicks, impressions: imp, position: Math.round(p * 10) / 10 })
        const a = pageAgg.get(pi) ?? { c: 0, i: 0, ps: 0 }
        a.c += clicks; a.i += imp; a.ps += p * imp
        pageAgg.set(pi, a)
      })
    }
    // Page rows include anonymised queries, so they run a little higher than the sum of query rows.
    let tc = 0, ti = 0, tps = 0
    for (const [pi, a] of pageAgg) {
      const i = Math.round(a.i * 1.22), c = Math.min(i, Math.round(a.c * 1.1))
      const p = a.ps / a.i + 0.4
      out.push({ g: 'page', date: d, page: url(pi), clicks: c, impressions: i, position: Math.round(p * 10) / 10 })
      tc += c; ti += i; tps += p * i
    }
    if (!ti) continue
    const tp = tps / ti
    out.push({ g: '', date: d, clicks: tc, impressions: ti, position: Math.round(tp * 10) / 10 })
    const split = (parts: number[], n: number) => { const v = parts.map(x => Math.floor(x * n)); v[0] += n - v.reduce((a, b) => a + b, 0); return v }
    const di = split(DEVICES.map(x => x[1]), ti), dc = split(DEVICES.map(x => x[2]), tc)
    DEVICES.forEach(([device, , , dp], k) => { if (di[k] > 0) out.push({ g: 'device', date: d, device, clicks: Math.min(dc[k], di[k]), impressions: di[k], position: Math.round(Math.max(1, tp + dp) * 10) / 10 }) })
    const ci = split(COUNTRIES.map(x => x[1]), ti), cc = split(COUNTRIES.map(x => x[1]), tc)
    COUNTRIES.forEach(([country], k) => { if (ci[k] > 0) out.push({ g: 'country', date: d, country, clicks: Math.min(cc[k], ci[k]), impressions: ci[k], position: Math.round(tp * 10) / 10 }) })
  }
  return out
}

const SITES = [butterCrumb, ledgerly]
export const SAMPLES: SampleDef[] = SITES.map(f => f().def)
const cache = new Map<string, Fact[]>()
export function generate(id: string): Fact[] {
  if (!cache.has(id)) { const f = SITES.find(x => x().def.id === id); if (!f) return []; cache.set(id, build(f())) }
  return cache.get(id)!
}
