import { test as base, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { crc32 } from 'node:zlib'

// Hosts the app asks for on its own (web fonts, the public Google status feed). They are blocked, never fetched.
const EXPECTED_BLOCKED = ['fonts.googleapis.com', 'fonts.gstatic.com', 'status.search.google.com']

export const test = base.extend<{ blocked: string[]; pageErrors: Error[] }>({
  blocked: [async ({ context }, use) => {
    const blocked: string[] = []
    await context.route(/^(?!https?:\/\/127\.0\.0\.1[:/]).*/, route => {
      const url = route.request().url()
      if (/^(data|blob):/.test(url)) return route.continue()
      blocked.push(new URL(url).host)
      return route.abort('blockedbyclient')
    })
    await use(blocked)
  }, { auto: true }],
  pageErrors: [async ({ page, blocked }, use) => {
    const errors: Error[] = []
    page.on('pageerror', e => errors.push(e))
    await use(errors)
    expect(errors, 'uncaught page errors').toEqual([])
    expect(blocked.filter(h => !EXPECTED_BLOCKED.includes(h)), 'unexpected external requests').toEqual([])
  }, { auto: true }],
})
export { expect }

export interface Upload { name: string; mimeType: string; buffer: Buffer }
export const file = (name: string, body: string | Buffer): Upload => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(body) })

/** Minimal zip writer (stored entries), enough for a Search Console export or a workbook. */
export function zip(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = [], dir: Buffer[] = []
  let at = 0
  for (const [name, text] of Object.entries(entries)) {
    const n = Buffer.from(name), d = Buffer.from(text), crc = crc32(d)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(at, 42)
    parts.push(h, n, d); dir.push(c, n)
    at += 30 + n.length + d.length
  }
  const size = dir.reduce((s, b) => s + b.length, 0)
  const e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(dir.length / 2, 8); e.writeUInt16LE(dir.length / 2, 10); e.writeUInt32LE(size, 12); e.writeUInt32LE(at, 16)
  return Buffer.concat([...parts, ...dir, e])
}

/** A workbook with inline strings and numbers, one sheet per entry. */
export function xlsx(sheets: Record<string, (string | number)[][]>): Buffer {
  const names = Object.keys(sheets)
  const cell = (v: string | number, r: number, c: number) => { const ref = String.fromCharCode(65 + c) + (r + 1); return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>` }
  return zip({
    'xl/workbook.xml': `<workbook><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
    ...Object.fromEntries(names.map((n, i) => [`xl/worksheets/sheet${i + 1}.xml`, `<worksheet><sheetData>${sheets[n].map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('')}</sheetData></worksheet>`])),
  })
}

export const day = (from: string, n: number) => new Date(Date.parse(from + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
export const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => day(from, i))
export const HEAD = 'Clicks,Impressions,CTR,Position'

/** Creates an empty site from the workspace and stops on its Data tab. */
export async function newSite(page: Page) {
  await page.goto('/app')
  await page.getByRole('button', { name: /^(Import your data|New site)$/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible()
}
export const drop = (page: Page, ...files: Upload[]) => page.locator('input[type=file]').setInputFiles(files)

/** Imports every recognised table and waits for the confirmation. */
export async function importAll(page: Page, ...files: Upload[]) {
  await drop(page, ...files)
  const all = page.getByRole('button', { name: 'Import all ready tables' })
  const one = page.getByRole('button', { name: /^Import [\d,]+ rows$/ })
  await expect(all.or(one).first()).toBeVisible()
  await (await all.isVisible() ? all : one).click()
  await expect(page.locator('.toast.ok')).toContainText('Imported')
}
export const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Site sections' }).getByRole('link', { name, exact: true }).click()
export const kpi = (page: Page, k: string) => page.locator(`.kpis .kpi.${k} b`).first()

export async function downloaded(page: Page, click: () => Promise<unknown>): Promise<{ name: string; text: string }> {
  const [d] = await Promise.all([page.waitForEvent('download'), click()])
  return { name: d.suggestedFilename(), text: readFileSync((await d.path())!, 'utf8') }
}

/** 28 chart days plus device, page and query tables: 280 clicks and 5,600 impressions in all. */
export const standardExport = (extra: Record<string, string> = {}) => ({
  'Chart.csv': `Date,${HEAD}\n` + days('2026-10-01', 28).map(d => `${d},10,200,5%,5.29`).join('\n') + '\n',
  'Devices.csv': `Device,${HEAD}\nDesktop,200,3800,5.26%,4\nMobile,80,1800,4.44%,8\n`,
  'Pages.csv': `Top pages,${HEAD}\nhttps://a.example/guide/,280,5600,5%,5.29\n`,
  'Queries.csv': `Top queries,${HEAD}\npasta water,28,2800,1%,10\n`,
  'Search appearance.csv': `Search Appearance,${HEAD}\nTranslated results,1,20,5%,9\n`,
  'Filters.csv': 'Filter,Value\nSearch type,Web\nDate,Last 28 days\n',
  ...extra,
})

/** The column-mapping select for one field. */
export const mapField = (page: Page, label: string) => page.locator('.map-grid label').filter({ has: page.locator('span', { hasText: new RegExp(`^${label.replace('*', '\\*')}$`) }) }).locator('select')

/** Dated page rows: the same clicks and impressions every day. */
export const flatPages = (from: string, n: number, path = '/p/') => 'date,page,clicks,impressions,position\n' + days(from, n).map(d => `${d},https://a.example${path},10,100,3`).join('\n') + '\n'
/** Dated query + page rows where `pages` split one query evenly, so the last of them are told to redirect to the first. */
export const contested = (...urls: string[]) => 'date,query,page,clicks,impressions,position\n' + days('2026-10-01', 28).flatMap(d => urls.map((u, i) => `${d},contested,"${u}",${9 - i},100,${4 + i}`)).join('\n') + '\n'
