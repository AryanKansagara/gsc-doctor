import { DIMS, type Dim, type Fact } from './types.ts'

// ---------- CSV ----------

export interface Table { name: string; rows: string[][]; lines: number[] }

export function parseCsv(text: string, name = 'data.csv'): Table {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const delim = sniffDelimiter(text.replace(/^(?:[ \t]*(?:#[^\n]*)?\r?\n)+/, ''))
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
  // Google Analytics exports start with a block of "# ..." comment lines before the header.
  while (rows.length && rows[0][0].trimStart().startsWith('#')) { rows.shift(); lines.shift() }
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

const DEVICE_KEYS = /^(desktop|mobile|tablet)$/i

/**
 * Search Analytics API responses ({ rows: [{ keys, clicks, impressions, ctr, position }] }) and plain arrays of
 * objects (BigQuery "save as JSON"). The API does not name the keys, so each key column is recognised by its values.
 */
export function jsonTable(data: unknown, name = 'data.json'): Table {
  const list = (Array.isArray(data) ? data : (data as { rows?: unknown })?.rows) as Record<string, unknown>[] | undefined
  if (!Array.isArray(list) || !list.length || typeof list[0] !== 'object' || list[0] === null) throw new Error('No rows found in this JSON. Expected a Search Analytics API response or an array of rows.')
  const str = (v: unknown) => v === null || v === undefined ? '' : String(v)
  let header: string[], body: string[][]
  if (Array.isArray(list[0].keys)) {
    const n = (list[0].keys as unknown[]).length
    const probe = list.slice(0, 200)
    const names: string[] = []
    for (let i = 0; i < n; i++) {
      const vals = probe.map(r => str((r.keys as unknown[])[i]))
      const guess = vals.every(v => /^\d{4}-\d{2}-\d{2}$/.test(v)) ? 'date' : vals.every(v => /^(https?:\/\/|sc-domain:)/i.test(v)) ? 'page'
        : vals.every(v => DEVICE_KEYS.test(v)) ? 'device' : vals.every(v => /^[a-z]{3}$/.test(v)) ? 'country' : 'query'
      names.push(names.includes(guess) ? `${guess} ${i + 1}` : guess)
    }
    header = [...names, 'clicks', 'impressions', 'ctr', 'position']
    body = list.map(r => [...(r.keys as unknown[]).map(str), str(r.clicks), str(r.impressions), str(r.ctr), str(r.position)])
  } else {
    header = [...new Set(list.flatMap(r => Object.keys(r)))]
    body = list.map(r => header.map(k => { const v = r[k]; return v !== null && typeof v === 'object' ? str((v as { value?: unknown }).value) : str(v) }))
  }
  return { name, rows: [header, ...body], lines: [1, ...body.map((_, i) => i + 2)] }
}

/** Turns any dropped file into tables: CSV/TSV, a zip of CSVs (the Search Console export), or an .xlsx workbook. */
export async function readFile(name: string, buf: ArrayBuffer): Promise<Table[]> {
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const files = await unzip(buf)
    if (files.some(f => f.name === 'xl/workbook.xml')) return readXlsx(files)
    return files.filter(f => /\.(csv|tsv|txt)$/i.test(f.name)).map(f => parseCsv(new TextDecoder().decode(f.bytes), f.name.split('/').pop()!))
  }
  const text = new TextDecoder().decode(buf)
  if (/^\uFEFF?\s*[[{]/.test(text)) {
    let data: unknown
    try { data = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw new Error('This looks like JSON but could not be parsed.') }
    return [jsonTable(data, name)]
  }
  return [parseCsv(text, name)]
}

// ---------- Values ----------

export function parseNum(raw: string | undefined): number {
  let s = (raw ?? '').trim().replace(/[\s\u00a0\u202f]/g, '')
  if (s === '' || /^(null|nan|-|—)$/i.test(s)) return NaN
  // "1,234" and "1,234.5" are thousands; "1.234,5" and "11,75" are decimal commas (German, French, Spanish exports).
  if (/^-?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')
  else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.')
  return Number(s)
}

const DOT_GROUPS = /^[1-9]\d{0,2}(\.\d{3})+$/
const bare = (raw: string | undefined) => (raw ?? '').trim().replace(/[\s  '’]/g, '')

/**
 * Clicks and impressions are whole numbers, so groups of three are thousands whatever the separator: "1.234" is 1234 in a
 * German export. With `dotDecimal` the table writes decimals with a dot ("5.000" is 5).
 */
export function parseCount(raw: string | undefined, dotDecimal = false): number {
  const s = bare(raw)
  return !dotDecimal && DOT_GROUPS.test(s) ? Number(s.replace(/\./g, '')) : parseNum(s)
}

/** A count column that shows a dot followed by anything but one group of three uses the dot as its decimal mark. */
export const usesDotDecimals = (cells: string[]) => cells.some(c => { const s = bare(c); return /^\d+\.\d+$/.test(s) && !DOT_GROUPS.test(s) })

/** Average positions are small decimals: a lone "," or "." is the decimal mark, so "7,125" is 7.125. */
export function parsePosition(raw: string | undefined): number {
  const s = bare(raw)
  return /^\d+,\d+$/.test(s) ? Number(s.replace(',', '.')) : parseNum(s)
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
/** Lowercase, single spaces, accents removed: "Häufigste  Suchanfragen" -> "haufigste suchanfragen". */
export const fold = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
// Device labels as Search Console writes them in English, German, French, Spanish, Italian, Portuguese and Dutch exports.
const DEVICES: Record<string, string> = {
  desktop: 'Desktop', computer: 'Desktop', ordinateur: 'Desktop', ordenador: 'Desktop', computador: 'Desktop',
  mobile: 'Mobile', mobil: 'Mobile', movil: 'Mobile', moviles: 'Mobile', 'dispositivo mobile': 'Mobile', 'dispositivos moveis': 'Mobile', mobiel: 'Mobile',
  tablet: 'Tablet', tablette: 'Tablet', tableta: 'Tablet', tablets: 'Tablet',
}
const normDevice = (s: string) => DEVICES[fold(s)] ?? s.trim()
const normCountry = (s: string) => /^[a-z]{3}$/.test(s.trim()) ? s.trim().toUpperCase() : s.trim()

// ---------- Format detection and column mapping ----------

export type Field = Dim | 'date' | 'clicks' | 'impressions' | 'ctr' | 'position' | 'sum_position' | 'clicks_prev' | 'impressions_prev' | 'ctr_prev' | 'position_prev'
export type Mapping = Partial<Record<Field, number>>
export const FIELDS: { key: Field; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date' }, { key: 'query', label: 'Query' }, { key: 'page', label: 'Page' },
  { key: 'country', label: 'Country' }, { key: 'device', label: 'Device' },
  { key: 'clicks', label: 'Clicks', required: true }, { key: 'impressions', label: 'Impressions', required: true },
  { key: 'ctr', label: 'CTR' }, { key: 'position', label: 'Position', required: true },
  { key: 'sum_position', label: 'Sum of positions (BigQuery)' },
  { key: 'clicks_prev', label: 'Clicks (previous)' }, { key: 'impressions_prev', label: 'Impressions (previous)' },
  { key: 'ctr_prev', label: 'CTR (previous)' }, { key: 'position_prev', label: 'Position (previous)' },
]

// Header names are matched after fold(): lowercase, no accents. Besides English these cover the localised
// Search Console exports (German, French, Spanish, Italian, Portuguese, Dutch) and the Analytics Search Console report.
const SYN: Record<Dim | 'date', RegExp> = {
  query: /^(top )?quer(y|ies)$|^search (query|term)$|^keyword$|^keys?\[?0\]?$|^organic google search query$|suchanfrage|^requetes?( les plus frequentes)?$|^consultas?( principales)?$|^principais consultas$|^query piu frequenti$|zoekopdracht/,
  page: /^(top )?pages?$|^landing page$|^url$|^address$|^page url$|^(die )?haufigsten seiten$|^seiten?$|^pages les plus populaires$|^paginas principales$|^principais paginas$|^pagine principali$|^pagina$|^populairste pagina'?s$/,
  country: /^countr(y|ies)$|^land$|^pays$|^pais$|^paese$/,
  device: /^device( category)?$|^devices$|^gerat$|^appareil$|^dispositivo$|^apparaat$/,
  date: /^date$|^data_date$|^day$|^datum$|^fecha$|^data$/,
}
const word = (w: string) => new RegExp(`(^|\\s)(${w})$|^(${w}) `)
const METRIC: Record<'clicks' | 'impressions' | 'ctr' | 'position', RegExp> = {
  clicks: word('clicks|klicks|clics|clic|cliques|klikken'),
  impressions: word('impressions|impressionen|impresiones|impressioni|impressoes|vertoningen'),
  ctr: /(^|\s)ctr$|click-through rate$|^klickrate|^taux de clics|^porcentaje de clics/,
  position: /(^|\s)(position|posicion|posizione|posicao|positie)$|^durchschnittliche position/,
}
const PREV = /previous|prior|year ago|before|vorherige|vorheriger|precedent|anterior|vorige/

export function autoMap(headers: string[]): Mapping {
  const h = headers.map(fold)
  const map: Mapping = {}
  // The raw BigQuery bulk export stores a zero-based sum of positions instead of an average.
  const sum = h.findIndex(x => /^sum_(top_)?position$/.test(x))
  if (sum >= 0) map.sum_position = sum
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
  if (isFilters(t) || APPEARANCE.test(fold(t.rows[0]?.[0] ?? '')) || APPEARANCE.test(fold(t.name))) return 'ignored'
  if (map.clicks === undefined || map.impressions === undefined) return 'unknown'
  const dims = DIMS.filter(d => map[d] !== undefined)
  if (dims.length > 1 || (dims.length === 1 && map.date !== undefined)) return 'rows'
  if (dims.length === 0) return map.date !== undefined ? 'dates' : 'unknown'
  return ({ query: 'queries', page: 'pages', country: 'countries', device: 'devices' } as const)[dims[0]]
}

const APPEARANCE = /^(search appearance|darstellung in der suche|apparence dans les resultats|aspecto de (la )?busqueda|aspetto nella ricerca|aparencia (na|da) pesquisa|uiterlijk in zoek)/
/** The two-column Filters table: "Filter,Value", "Filtern,Wert", "Filtre,Valeur", "Filtrar,Valor", "Filtra,Valore". */
const isFilters = (t: Table) => (t.rows[0]?.length ?? 0) <= 2 && /^filt/.test(fold(t.rows[0]?.[0] ?? ''))

/** Reads the date range from the export's Filters sheet ("Date | Last 3 months" or "Compare | ..."), if present. */
export function filtersNote(tables: Table[]): string {
  const f = tables.find(isFilters)
  return f ? f.rows.slice(1).map(r => r.filter(Boolean).join(': ')).join(' · ') : ''
}

/**
 * Length in days of the exported period, from the Filters table: "Last 28 days", "Letzte 3 Monate",
 * "Últimos 3 meses", "3 derniers mois" or an explicit "1 Jan 2024-18 Dec 2024". Null when it cannot be read.
 */
export function filterDays(tables: Table[]): number | null {
  for (const r of tables.find(isFilters)?.rows.slice(1) ?? []) {
    const v = fold(r[1] ?? '')
    const m = v.match(/(\d+) (?:\w+ )?(day|tag|dia|giorn|jour|dag|month|monat|mes|mois|maand)/)
    if (m) return Math.round(+m[1] * (/^(day|tag|dia|giorn|jour|dag)/.test(m[2]) ? 1 : 30.44))
    const d = v.match(/^(\d{1,2} [a-z]{3,9} \d{4}) ?- ?(\d{1,2} [a-z]{3,9} \d{4})$/)
    if (d) { const a = Date.parse(d[1] + ' UTC'), b = Date.parse(d[2] + ' UTC'); if (Number.isFinite(a) && Number.isFinite(b) && b >= a) return Math.round((b - a) / 86400000) + 1 }
  }
  return null
}

/** Length in days of one export: the days in its own chart table, else what its Filters table says. Null when neither tells. */
export function exportLength(tables: Table[]): number | null {
  for (const t of tables) {
    if (t.rows.length < 2) continue
    const map = autoMap(t.rows[0])
    if (detectKind(t, map) !== 'dates') continue
    const n = new Set(validate(t, map).facts.map(f => f.date)).size
    if (n) return n
  }
  return filterDays(tables)
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
  const head = t.lines[0] ?? 1
  for (const f of ['clicks', 'impressions', 'position'] as const) if (map[f] === undefined && !(f === 'position' && map.sum_position !== undefined)) issues.push({ line: head, level: 'error', message: `No column is mapped to ${f}.` })
  if (issues.length) return { facts, total: Math.max(0, t.rows.length - 1), skipped: Math.max(0, t.rows.length - 1), issues, dims, dated, compare, range: null }
  // Raw BigQuery tables mix search types and carry anonymised rows with no query.
  const h = (t.rows[0] ?? []).map(fold)
  const typeCol = h.indexOf('search_type'), anonCol = h.indexOf('is_anonymized_query')
  // Google's raw tables repeat keys (and split them by search appearance flags), so their rows are parts of one total.
  const raw = map.sum_position !== undefined && map.position === undefined
  let added = 0
  const seen = new Map<string, { cur: Fact | null; prev: Fact | null; frag: boolean }>()
  const sum = (a: Fact, b: Fact) => { a.position = (a.position * a.impressions + b.position * b.impressions) / (a.impressions + b.impressions); a.clicks += b.clicks; a.impressions += b.impressions }
  const countCols = (['clicks', 'impressions', 'clicks_prev', 'impressions_prev'] as const).map(f => map[f]).filter(c => c !== undefined)
  const counts = t.rows.slice(1).flatMap(r => countCols.map(c => r[c] ?? ''))
  const dotDecimal = usesDotDecimals(counts)
  const grouped = dotDecimal ? undefined : counts.find(c => DOT_GROUPS.test(bare(c)))
  if (grouped) issues.push({ line: head, level: 'warning', message: `Clicks and impressions like "${grouped.trim()}" are read as thousands (${parseCount(grouped).toLocaleString('en-US')}).` })
  let skipped = 0, zero = 0, otherType = 0, anon = 0, merged = 0
  let lo = '', hi = ''
  for (let r = 1; r < t.rows.length; r++) {
    const row = t.rows[r], line = t.lines[r] ?? r + 1
    const err = (m: string) => { issues.push({ line, level: 'error', message: m }); skipped++ }
    if (typeCol >= 0 && (row[typeCol] ?? '').trim() && !/^web$/i.test(row[typeCol].trim())) { otherType++; continue }
    if (anonCol >= 0 && map.query !== undefined && !(row[map.query] ?? '').trim() && /^true$/i.test((row[anonCol] ?? '').trim())) { anon++; continue }
    const base: Partial<Fact> = { g }
    let bad = false, frag = false
    for (const d of dims) {
      let v = (row[map[d]!] ?? '').trim()
      if (!v) { err(`Empty ${d}.`); bad = true; break }
      if (d === 'page') {
        if (!/^https?:\/\//i.test(v) && !v.startsWith('/') && !/^sc-domain:/.test(v)) issues.push({ line, level: 'warning', message: `"${v.slice(0, 60)}" does not look like a URL.` })
        frag = v.includes('#')
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
      const clicks = parseCount(row[map[prev ? 'clicks_prev' : 'clicks']!], dotDecimal)
      const imp = parseCount(row[map[prev ? 'impressions_prev' : 'impressions']!], dotDecimal)
      const tag = prev ? ' (previous period)' : ''
      if (prev && !Number.isFinite(clicks) && !Number.isFinite(imp)) return null
      if (!Number.isFinite(clicks) || clicks < 0) return `Clicks${tag} "${row[map[prev ? 'clicks_prev' : 'clicks']!] ?? ''}" is not a number.`
      if (!Number.isFinite(imp) || imp < 0) return `Impressions${tag} "${row[map[prev ? 'impressions_prev' : 'impressions']!] ?? ''}" is not a number.`
      for (const [n, v, col] of [['Clicks', clicks, 'clicks'], ['Impressions', imp, 'impressions']] as const) if (!Number.isInteger(v)) return `${n}${tag} "${row[map[prev ? `${col}_prev` as const : col]!]}" is not a whole number.`
      if (clicks > imp) return `Clicks${tag} (${clicks}) exceed impressions (${imp}).`
      if (imp === 0) return null
      const sumCol = prev ? undefined : map.sum_position
      const posCol = map[prev ? 'position_prev' : 'position'] ?? -1
      // BigQuery: sum_position is zero-based and summed over impressions, so average position = sum / impressions + 1.
      const p = sumCol !== undefined && map.position === undefined ? parseCount(row[sumCol], dotDecimal) / imp + 1 : parsePosition(row[posCol])
      if (!Number.isFinite(p) || p < 1) return `Position${tag} "${row[sumCol !== undefined && map.position === undefined ? sumCol : posCol] ?? ''}" must be 1 or more.`
      const ctrCol = map[prev ? 'ctr_prev' : 'ctr']
      if (ctrCol !== undefined) {
        const c2 = parseCtr(row[ctrCol])
        if (Number.isFinite(c2) && Math.abs(c2 - clicks / imp) > 0.015 && imp >= 20) issues.push({ line, level: 'warning', message: `CTR${tag} ${(c2 * 100).toFixed(1)}% does not match clicks / impressions (${(clicks / imp * 100).toFixed(1)}%). Using clicks / impressions.` })
      }
      return { ...base, clicks, impressions: imp, position: p, ...(dated ? {} : { period: prev ? 'prev' : 'cur' }) } as Fact
    }
    const cur = read(false)
    if (typeof cur === 'string') { err(cur); continue }
    let prev = compare ? read(true) : null
    if (typeof prev === 'string') { issues.push({ line, level: 'warning', message: prev + ' Previous period ignored for this row.' }); prev = null }
    if (!cur && !prev) {
      // A day with no impressions is still a day: keep it in the daily series so period lengths and trends stay right.
      if (dated && !dims.length) facts.push({ g, date: base.date, clicks: 0, impressions: 0, position: 0 })
      else zero++
      continue
    }
    const key = [base.date, ...dims.map(d => base[d])].join('\u0001')
    const e = seen.get(key)
    if (e && (frag || e.frag)) {
      // Search Console lists #jump-link URLs as separate rows of the same page: add them up instead of keeping one.
      merged++
      e.frag = true
      if (cur) { if (e.cur) sum(e.cur, cur); else { e.cur = cur; facts.push(cur) } }
      if (prev) { if (e.prev) sum(e.prev, prev); else { e.prev = prev; facts.push(prev) } }
      continue
    }
    if (e && raw && cur) {
      added++
      if (e.cur) sum(e.cur, cur); else { e.cur = cur; facts.push(cur) }
      continue
    }
    if (e) issues.push({ line, level: 'warning', message: `Duplicate row for ${dims.map(d => base[d]).join(' / ') || base.date}. The later row wins.` })
    seen.set(key, { cur, prev, frag })
    if (cur) facts.push(cur)
    if (prev) facts.push(prev)
  }
  const note = (n: number, message: string) => { if (n) issues.push({ line: head, level: 'warning', message: `${n.toLocaleString('en-US')} ${message}` }) }
  note(merged, `row${merged === 1 ? '' : 's'} for #section links were added to their page.`)
  note(added, `row${added === 1 ? '' : 's'} with the same key were added up.`)
  note(zero, `row${zero === 1 ? '' : 's'} with zero impressions left out.`)
  note(otherType, `row${otherType === 1 ? '' : 's'} from other search types (image, video, news, Discover) left out; only web search is analysed.`)
  note(anon, `anonymised row${anon === 1 ? '' : 's'} with no query left out. Use a page-level table for full click totals.`)
  return { facts, total: t.rows.length - 1, skipped, issues, dims, dated, compare, range: lo ? [lo, hi] : null }
}

/** Adds up rows that share a key (the API returns #section URLs separately; stripping the fragment makes them collide). */
export function sumDuplicates(facts: Fact[]): Fact[] {
  const m = new Map<string, Fact>()
  for (const f of facts) {
    const k = factKey(f), a = m.get(k)
    if (!a) { m.set(k, { ...f }); continue }
    const imp = a.impressions + f.impressions
    a.position = imp ? (a.position * a.impressions + f.position * f.impressions) / imp : a.position
    a.clicks += f.clicks; a.impressions = imp
  }
  return [...m.values()]
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
