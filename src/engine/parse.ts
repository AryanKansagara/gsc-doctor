import { DIMS, type Dim, type Fact } from './types.ts'

// ---------- CSV ----------

export interface Table { name: string; rows: string[][]; lines: number[] }

export function parseCsv(text: string, name = 'data.csv'): Table {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const delim = sniffDelimiter(text)
  const rows: string[][] = []
  const lines: number[] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let line = 1
  let rowLine = 1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else {
        if (c === '\n') line++
        field += c
      }
      continue
    }
    if (c === '"' && field === '') quoted = true
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') { rows.push(row); lines.push(rowLine) }
      row = []
      line++
      rowLine = line
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') { rows.push(row); lines.push(rowLine) }
  }
  return { name, rows, lines }
}

function sniffDelimiter(text: string): string {
  const nl = text.indexOf('\n')
  const head = text.slice(0, nl === -1 ? text.length : nl)
  return [',', '\t', ';'].map(d => [d, head.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0]
}

export const toCsv = (rows: (string | number)[][]) => rows.map(r => r.map(v => {
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}).join(',')).join('\n') + '\n'

// ---------- Zip and XLSX (no dependencies: central directory + DecompressionStream) ----------

export async function unzip(buf: ArrayBuffer): Promise<{ name: string; bytes: Uint8Array }[]> {
  const v = new DataView(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Not a zip file')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out: { name: string; bytes: Uint8Array }[] = []
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip directory')
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    const raw = new Uint8Array(buf, start, size)
    if (method === 0) out.push({ name, bytes: raw.slice() })
    else if (method === 8) {
      const stream = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      out.push({ name, bytes: new Uint8Array(await new Response(stream).arrayBuffer()) })
    } else throw new Error(`Unsupported zip compression in ${name}`)
  }
  return out
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&')
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }

/** Reads every sheet of an .xlsx workbook into string rows. */
export function readXlsx(files: { name: string; bytes: Uint8Array }[]): Table[] {
  const dec = new TextDecoder()
  const get = (n: string) => { const f = files.find(x => x.name === n); return f ? dec.decode(f.bytes) : '' }
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')))
  const rels = Object.fromEntries([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
  const relsAlt = Object.fromEntries([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)].map(m => [m[2], m[1]]))
  const sheets = [...get('xl/workbook.xml').matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)]
  return sheets.map(([, name, rid]) => {
    const target = (rels[rid] ?? relsAlt[rid] ?? '').replace(/^\/?xl\//, '')
    const xml = get('xl/' + target)
    const rows: string[][] = [], lines: number[] = []
    for (const r of xml.matchAll(/<row [^>]*?r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const row: string[] = []
      for (const c of (r[2] ?? '').matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/r="([A-Z]+\d+)"/)?.[1]
        const t = c[1].match(/t="(\w+)"/)?.[1]
        const body = c[2] ?? ''
        let val = ''
        if (t === 'inlineStr') val = unxml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))
        else {
          const vv = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''
          val = t === 's' ? shared[+vv] ?? '' : unxml(vv)
        }
        const i = ref ? colIndex(ref) : row.length
        while (row.length < i) row.push('')
        row[i] = val
      }
      if (row.some(x => x !== '')) { rows.push(row); lines.push(+r[1]) }
    }
    return { name: unxml(name), rows, lines }
  })
}

/** Turns any dropped file into tables: CSV/TSV, a zip of CSVs (the Search Console export), or an .xlsx workbook. */
export async function readFile(name: string, buf: ArrayBuffer): Promise<Table[]> {
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const files = await unzip(buf)
    if (files.some(f => f.name === 'xl/workbook.xml')) return readXlsx(files)
    return files.filter(f => /\.(csv|tsv|txt)$/i.test(f.name)).map(f => parseCsv(new TextDecoder().decode(f.bytes), f.name.split('/').pop()!))
  }
  return [parseCsv(new TextDecoder().decode(buf), name)]
}

// ---------- Values ----------

export function parseNum(raw: string | undefined): number {
  const s = (raw ?? '').trim().replace(/[,\s]/g, '')
  if (s === '' || /^(null|nan|-|—)$/i.test(s)) return NaN
  return Number(s)
}

/** "3.2%" -> 0.032, "0.032" -> 0.032, "3.2" -> 0.032 */
export function parseCtr(raw: string | undefined): number {
  const s = (raw ?? '').trim()
  if (s.endsWith('%')) return parseNum(s.slice(0, -1)) / 100
  const n = parseNum(s)
  return n > 1 ? n / 100 : n
}

/** ISO dates, YYYY/MM/DD, US M/D/YYYY, compact 20261107 and Excel serial days. Returns YYYY-MM-DD or ''. */
export function parseDate(raw: string | undefined): string {
  const s = (raw ?? '').trim()
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return iso(+m[3], +m[1], +m[2])
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 30000 && +s < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000).toISOString().slice(0, 10)
  const t = Date.parse(s + (/\d{4}$/.test(s) ? ' UTC' : ''))
  return Number.isFinite(t) && /[a-z]/i.test(s) ? new Date(t).toISOString().slice(0, 10) : ''
}
function iso(y: number, mo: number, d: number) {
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : ''
}

/** Strips fragments (Search Console reports #section jump links as separate URLs) and lowercases the host. */
export function normPage(raw: string): string {
  const s = raw.trim().replace(/#.*$/, '')
  const m = s.match(/^(https?:\/\/)([^/?]+)(.*)$/i)
  return m ? m[1].toLowerCase() + m[2].toLowerCase() + (m[3] || '/') : s
}
const DEVICES: Record<string, string> = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' }
const normDevice = (s: string) => DEVICES[s.trim().toLowerCase()] ?? s.trim()
const normCountry = (s: string) => /^[a-z]{3}$/.test(s.trim()) ? s.trim().toUpperCase() : s.trim()

// ---------- Format detection and column mapping ----------

export type Field = Dim | 'date' | 'clicks' | 'impressions' | 'ctr' | 'position' | 'clicks_prev' | 'impressions_prev' | 'ctr_prev' | 'position_prev'
export type Mapping = Partial<Record<Field, number>>
export const FIELDS: { key: Field; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date' }, { key: 'query', label: 'Query' }, { key: 'page', label: 'Page' },
  { key: 'country', label: 'Country' }, { key: 'device', label: 'Device' },
  { key: 'clicks', label: 'Clicks', required: true }, { key: 'impressions', label: 'Impressions', required: true },
  { key: 'ctr', label: 'CTR' }, { key: 'position', label: 'Position', required: true },
  { key: 'clicks_prev', label: 'Clicks (previous)' }, { key: 'impressions_prev', label: 'Impressions (previous)' },
  { key: 'ctr_prev', label: 'CTR (previous)' }, { key: 'position_prev', label: 'Position (previous)' },
]

const SYN: Record<Dim | 'date', RegExp> = {
  query: /^(top )?quer(y|ies)$|^search (query|term)$|^keyword$|^keys?\[?0\]?$/,
  page: /^(top )?pages?$|^landing page$|^url$|^address$|^page url$/,
  country: /^countr(y|ies)$/,
  device: /^device( category)?$|^devices$/,
  date: /^date$|^data_date$|^day$/,
}
const METRIC: Record<'clicks' | 'impressions' | 'ctr' | 'position', RegExp> = {
  clicks: /(^|\s)(url |site |total )?clicks$/,
  impressions: /(^|\s)impressions$/,
  ctr: /(^|\s)(url |site )?ctr$/,
  position: /(^|\s)(average |avg\.? )?position$/,
}
const PREV = /previous|prior|year ago|before/

export function autoMap(headers: string[]): Mapping {
  const h = headers.map(x => x.trim().toLowerCase().replace(/\s+/g, ' '))
  const map: Mapping = {}
  for (const d of [...DIMS, 'date'] as const) { const i = h.findIndex(x => SYN[d].test(x)); if (i >= 0) map[d] = i }
  for (const k of Object.keys(METRIC) as (keyof typeof METRIC)[]) {
    const idx = h.map((x, i) => METRIC[k].test(x) ? i : -1).filter(i => i >= 0)
    if (!idx.length) continue
    if (idx.length === 1) { map[k] = idx[0]; continue }
    // Compare mode exports two columns per metric, e.g. "Last 28 days Clicks" and "Previous 28 days Clicks".
    const prev = idx.find(i => PREV.test(h[i])) ?? idx[1]
    map[k] = idx.find(i => i !== prev)!
    map[`${k}_prev`] = prev
  }
  return map
}

export type TableKind = 'queries' | 'pages' | 'countries' | 'devices' | 'dates' | 'rows' | 'ignored' | 'unknown'
export const KIND_LABEL: Record<TableKind, string> = {
  queries: 'Search Console Queries table', pages: 'Search Console Pages table', countries: 'Search Console Countries table',
  devices: 'Search Console Devices table', dates: 'Search Console Dates table', rows: 'Row-level export (API, Sheets, Looker Studio or BigQuery)',
  ignored: 'Not used (search appearance or filters)', unknown: 'Unrecognised columns',
}

export function detectKind(t: Table, map: Mapping = autoMap(t.rows[0] ?? [])): TableKind {
  const h0 = (t.rows[0]?.[0] ?? '').trim().toLowerCase()
  if (/^filter$/.test(h0) || /search appearance/.test(h0) || /^(filters|search appearance)/i.test(t.name)) return 'ignored'
  if (map.clicks === undefined || map.impressions === undefined) return 'unknown'
  const dims = DIMS.filter(d => map[d] !== undefined)
  if (dims.length > 1 || (dims.length === 1 && map.date !== undefined)) return 'rows'
  if (dims.length === 0) return map.date !== undefined ? 'dates' : 'unknown'
  return ({ query: 'queries', page: 'pages', country: 'countries', device: 'devices' } as const)[dims[0]]
}

/** Reads the date range from the export's Filters sheet ("Date | Last 3 months" or "Compare | ..."), if present. */
export function filtersNote(tables: Table[]): string {
  const f = tables.find(t => /filters/i.test(t.name) || /^filter$/i.test(t.rows[0]?.[0] ?? ''))
  return f ? f.rows.slice(1).map(r => r.filter(Boolean).join(': ')).join(' · ') : ''
}

// ---------- Validation ----------

export interface Issue { line: number; level: 'error' | 'warning'; message: string }
export interface Validation { facts: Fact[]; total: number; skipped: number; issues: Issue[]; dims: Dim[]; dated: boolean; compare: boolean; range: [string, string] | null }

export function validate(t: Table, map: Mapping): Validation {
  const issues: Issue[] = []
  const facts: Fact[] = []
  const dims = DIMS.filter(d => map[d] !== undefined)
  const g = dims.join('|')
  const dated = map.date !== undefined
  const compare = map.clicks_prev !== undefined && map.impressions_prev !== undefined
  for (const f of ['clicks', 'impressions', 'position'] as const) if (map[f] === undefined) issues.push({ line: t.lines[0] ?? 1, level: 'error', message: `No column is mapped to ${f}.` })
  if (issues.length) return { facts, total: Math.max(0, t.rows.length - 1), skipped: Math.max(0, t.rows.length - 1), issues, dims, dated, compare, range: null }
  const seen = new Set<string>()
  let skipped = 0
  let lo = '', hi = ''
  for (let r = 1; r < t.rows.length; r++) {
    const row = t.rows[r], line = t.lines[r] ?? r + 1
    const err = (m: string) => { issues.push({ line, level: 'error', message: m }); skipped++ }
    const base: Partial<Fact> = { g }
    let bad = false
    for (const d of dims) {
      let v = (row[map[d]!] ?? '').trim()
      if (!v) { err(`Empty ${d}.`); bad = true; break }
      if (d === 'page') {
        if (!/^https?:\/\//i.test(v) && !v.startsWith('/') && !/^sc-domain:/.test(v)) issues.push({ line, level: 'warning', message: `"${v.slice(0, 60)}" does not look like a URL.` })
        v = normPage(v)
      }
      if (d === 'device') v = normDevice(v)
      if (d === 'country') v = normCountry(v)
      base[d] = v
    }
    if (bad) continue
    if (dated) {
      const d = parseDate(row[map.date!])
      if (!d) { err(`Unreadable date "${row[map.date!] ?? ''}". Use YYYY-MM-DD.`); continue }
      base.date = d
      if (!lo || d < lo) lo = d
      if (!hi || d > hi) hi = d
    }
    const read = (prev: boolean): Fact | string | null => {
      const clicks = parseNum(row[map[prev ? 'clicks_prev' : 'clicks']!])
      const imp = parseNum(row[map[prev ? 'impressions_prev' : 'impressions']!])
      const p = parseNum(row[map[prev ? 'position_prev' : 'position'] ?? -1])
      const tag = prev ? ' (previous period)' : ''
      if (prev && !Number.isFinite(clicks) && !Number.isFinite(imp)) return null
      if (!Number.isFinite(clicks) || clicks < 0) return `Clicks${tag} "${row[map[prev ? 'clicks_prev' : 'clicks']!] ?? ''}" is not a number.`
      if (!Number.isFinite(imp) || imp < 0) return `Impressions${tag} "${row[map[prev ? 'impressions_prev' : 'impressions']!] ?? ''}" is not a number.`
      if (clicks > imp) return `Clicks${tag} (${clicks}) exceed impressions (${imp}).`
      if (imp === 0) return null
      if (!Number.isFinite(p) || p < 1) return `Position${tag} "${row[map[prev ? 'position_prev' : 'position'] ?? -1] ?? ''}" must be 1 or more.`
      const ctrCol = map[prev ? 'ctr_prev' : 'ctr']
      if (ctrCol !== undefined) {
        const c2 = parseCtr(row[ctrCol])
        if (Number.isFinite(c2) && Math.abs(c2 - clicks / imp) > 0.015 && imp >= 20) issues.push({ line, level: 'warning', message: `CTR${tag} ${(c2 * 100).toFixed(1)}% does not match clicks / impressions (${(clicks / imp * 100).toFixed(1)}%). Using clicks / impressions.` })
      }
      return { ...base, clicks, impressions: imp, position: p, ...(dated ? {} : { period: prev ? 'prev' : 'cur' }) } as Fact
    }
    const cur = read(false)
    if (typeof cur === 'string') { err(cur); continue }
    const prev = compare ? read(true) : null
    if (typeof prev === 'string') { issues.push({ line, level: 'warning', message: prev + ' Previous period ignored for this row.' }) }
    const key = [base.date, ...dims.map(d => base[d])].join('\u0001')
    if (seen.has(key)) issues.push({ line, level: 'warning', message: `Duplicate row for ${dims.map(d => base[d]).join(' / ') || base.date}. The later row wins.` })
    seen.add(key)
    if (cur) facts.push(cur)
    else issues.push({ line, level: 'warning', message: 'Zero impressions; row ignored.' })
    if (prev && typeof prev !== 'string') facts.push(prev)
  }
  return { facts, total: t.rows.length - 1, skipped, issues, dims, dated, compare, range: lo ? [lo, hi] : null }
}

export const factKey = (f: Fact) => `${f.g}\u0001${f.date ?? f.period}\u0001${f.query ?? ''}\u0001${f.page ?? ''}\u0001${f.country ?? ''}\u0001${f.device ?? ''}`

/** Merges new facts into a dataset; the same grain/date/dimensions replace the old row (re-imports do not double count). */
export function mergeFacts(base: Fact[], incoming: Fact[]): Fact[] {
  const m = new Map(base.map(f => [factKey(f), f]))
  // An undated export replaces any earlier undated export of the same grain.
  const undatedGrains = new Set(incoming.filter(f => !f.date).map(f => f.g))
  for (const [k, f] of m) if (!f.date && undatedGrains.has(f.g)) m.delete(k)
  for (const f of incoming) m.set(factKey(f), f)
  return [...m.values()]
}

export function factsToCsv(facts: Fact[]): string {
  return toCsv([['date', 'period', 'query', 'page', 'country', 'device', 'clicks', 'impressions', 'ctr', 'position'],
    ...facts.map(f => [f.date ?? '', f.period ?? '', f.query ?? '', f.page ?? '', f.country ?? '', f.device ?? '', f.clicks, f.impressions, f.impressions ? (f.clicks / f.impressions).toFixed(4) : '0', f.position.toFixed(2)])])
}
