import { type Page } from '@playwright/test'
import { contested, day, days, downloaded, drop, expect, file, flatPages, HEAD, importAll, kpi, newSite, standardExport, tab, test, zip } from './fixtures'

// Each test.fail pins an open issue. The pull request that fixes the issue turns it into a normal test.

/** Imports a file into the site that is already open and waits until it is listed. */
async function importMore(page: Page, f: ReturnType<typeof file>) {
  await drop(page, f)
  const all = page.getByRole('button', { name: 'Import all ready tables' })
  const one = page.getByRole('button', { name: /^Import [\d,]+ rows$/ })
  await expect(all.or(one).first()).toBeVisible()
  await (await all.isVisible() ? all : one).click()
  await expect(all.or(one)).toHaveCount(0)
  await expect(page.getByRole('rowheader', { name: new RegExp(`^${f.name}`) }).first()).toBeVisible()
}
const apache = (page: Page) => page.locator('.code', { hasText: '.htaccess' }).locator('pre')
const nginx = (page: Page) => page.locator('.code', { hasText: 'nginx' }).locator('pre')

test.describe('#2 redirect rules', () => {
  test('an Apache rule matches only its own path', async ({ page }) => {
    await newSite(page)
    await importAll(page, file('qp.csv', contested('https://a.example/blog/post/', 'https://a.example/blog')))
    await tab(page, 'Cannibalisation')
    await expect(page.getByRole('heading', { name: 'Keep /blog/post/' })).toBeVisible()
    await expect(apache(page)).toHaveText('RedirectMatch 301 "^/blog$" "https://a.example/blog/post/"')
  })
  test('copies of one page on another host or scheme get no self-redirect', async ({ page }) => {
    await newSite(page)
    await importAll(page, file('qp.csv', contested('https://a.example/a/', 'http://www.a.example/a/')))
    await tab(page, 'Cannibalisation')
    await expect(page.getByRole('cell', { name: '301 redirect' })).toBeVisible()
    await expect(page.locator('.code')).toHaveCount(0)
  })
  test('a query string is not turned into a rule that never matches', async ({ page }) => {
    await newSite(page)
    await importAll(page, file('qp.csv', contested('https://a.example/a/', 'https://a.example/p?id=2')))
    await tab(page, 'Cannibalisation')
    await expect(page.getByRole('cell', { name: '301 redirect' })).toBeVisible()
    await expect(page.locator('.code')).toHaveCount(0)
    await expect(page.getByText('Redirect these by hand:')).toBeVisible()
  })
  test('a URL cannot add a directive', async ({ page }) => {
    await newSite(page)
    await importAll(page, file('qp.csv', contested('https://a.example/a/', 'https://a.example/b; } location /admin { allow all')))
    await tab(page, 'Cannibalisation')
    await expect(nginx(page)).toBeVisible()
    // The whole URL stays inside the quoted path.
    await expect(nginx(page)).toHaveText('location = "/b; } location /admin { allow all" { return 301 "https://a.example/a/"; }')
  })
})

test.describe('#3 windows the data does not cover', () => {
  test('a previous window that starts before the data is not compared', async ({ page }) => {
    await newSite(page)
    await importAll(page, file('rows.csv', flatPages('2026-09-01', 40)))
    await tab(page, 'Overview')
    await expect(kpi(page, 'clicks')).toHaveText('304')
    await expect(page.locator('.kpi.clicks .delta')).toHaveCount(0)
    await tab(page, 'Drops')
    await expect(page.locator('.verdict')).toContainText('No comparison')
    await expect(page.getByText('Where the clicks went')).toHaveCount(0)
    await page.getByRole('link', { name: 'Report', exact: true }).click()
    await expect(page.getByText('Monthly SEO report')).toBeVisible()
    await expect(page.getByText(/on the previous period/)).toHaveCount(0)
  })
  test('ten days of data are scaled as ten days', async ({ page }) => {
    // 100 clicks x 30.44 / 10 = 304.4
    await newSite(page)
    await importAll(page, file('rows.csv', flatPages('2026-09-01', 10)))
    await tab(page, 'Overview')
    await expect(kpi(page, 'clicks')).toHaveText('304')
  })
})

test('#4 a second monthly export keeps its own length', async ({ page }) => {
  const month = (from: string, n: number) => zip({ 'Chart.csv': `Date,${HEAD}\n` + days(from, n).map(d => `${d},10,100,10%,3`).join('\n'), 'Pages.csv': `Top pages,${HEAD}\nhttps://a.example/p/,${n * 10},${n * 100},10%,3\n` })
  await newSite(page)
  await importMore(page, file('sep.zip', month('2026-09-01', 30)))
  await importMore(page, file('oct.zip', month('2026-10-01', 30)))
  await tab(page, 'Overview')
  // October alone: 300 x 30.44 / 30 = 304.4
  await expect(kpi(page, 'clicks')).toHaveText('304')
})

test('#4 tables imported one at a time keep their export\'s length, and a later lone table does not inherit it', async ({ page }) => {
  await newSite(page)
  await importMore(page, file('Chart.csv', `Date,${HEAD}\n` + days('2026-08-01', 60).map(d => `${d},10,100,10%,3`).join('\n')))
  await drop(page, file('export.zip', zip(standardExport())))
  await page.locator('.panel', { hasText: 'export.zip › Devices.csv' }).getByRole('button', { name: 'Import 2 rows' }).click()
  await expect(page.getByRole('rowheader', { name: 'export.zip › Devices.csv' })).toBeVisible()
  await tab(page, 'Overview')
  await expect(kpi(page, 'clicks')).toHaveText('304')
  await tab(page, 'Data & settings')
  // A lone table says nothing about its length, so the chart days (60) are the best guess again: 280 x 30.44 / 60 = 142.
  await importMore(page, file('Devices.csv', `Device,${HEAD}\nDesktop,280,5600,5%,4\n`))
  await tab(page, 'Overview')
  await expect(kpi(page, 'clicks')).toHaveText('142')
})

test('#5 German counts and positions are read by field', async ({ page }) => {
  // 1.234 clicks of 45.678 impressions is the 2.7% in the file. Over the default 90 days: 1,234 x 30.44 / 90 = 417.4 a month.
  await newSite(page)
  await importAll(page, file('Seiten.csv', 'Die häufigsten Seiten;Klicks;Impressionen;CTR;Position\nhttps://a.example/;1.234;45.678;2,7%;7,125\n'))
  await tab(page, 'Overview')
  await expect(kpi(page, 'position')).toHaveText('7.1')
  await expect(kpi(page, 'clicks')).toHaveText('417')
})

test('#6 raw BigQuery rows that share a key are added up', async ({ page }) => {
  // 10 + 5 clicks, 100 + 40 impressions, position (200 + 40) / 140 + 1 = 2.71.
  await newSite(page)
  await importAll(page, file('bq.csv', 'data_date,url,query,is_anonymized_query,country,search_type,device,is_video,impressions,clicks,sum_position\n2026-10-01,https://a.example/,shoes,false,usa,WEB,MOBILE,false,100,10,200\n2026-10-01,https://a.example/,shoes,false,usa,WEB,MOBILE,true,40,5,40\n'))
  const csv = await downloaded(page, () => page.getByRole('button', { name: 'Download normalised CSV' }).click())
  expect(csv.text.trim().split('\n').slice(1)).toEqual(['2026-10-01,,shoes,https://a.example/,USA,Mobile,15,140,0.1071,2.71'])
})

test('#7 query text cannot become a spreadsheet formula', async ({ page }) => {
  await newSite(page)
  await importAll(page, file('Queries.csv', `Top queries,${HEAD}\n"=HYPERLINK(""http://x.example"",""open"")",5,5000,0.1%,9\n`))
  await tab(page, 'Queries & pages')
  const csv = await downloaded(page, () => page.getByRole('button', { name: 'Queries CSV' }).click())
  expect(csv.text.split('\n')[1]).toMatch(/^"'=HYPERLINK/)
})

test('#8 two quick imports keep both tables', async ({ page }) => {
  await newSite(page)
  await drop(page, file('Queries.csv', `Top queries,${HEAD}\nshoes,5,500,1%,9\n`), file('Pages.csv', `Top pages,${HEAD}\nhttps://a.example/,5,500,1%,9\n`))
  const buttons = page.getByRole('button', { name: 'Import 1 rows' })
  await expect(buttons).toHaveCount(2)
  await buttons.evaluateAll(b => b.forEach(x => (x as HTMLElement).click()))
  await expect(buttons).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Imported data', { exact: true })).toBeVisible()
  await expect(page.getByText(/^2 rows/)).toBeVisible()
})

test('#8 two quick imports into a sample start one site with both tables', async ({ page }) => {
  await page.goto('/app?sample=ledgerly&tab=data')
  await drop(page, file('Queries.csv', `Top queries,${HEAD}\nshoes,5,500,1%,9\n`), file('Pages.csv', `Top pages,${HEAD}\nhttps://a.example/,5,500,1%,9\n`))
  const buttons = page.getByRole('button', { name: 'Import 1 rows' })
  await expect(buttons).toHaveCount(2)
  await buttons.evaluateAll(b => b.reverse().forEach(x => (x as HTMLElement).click()))
  await expect(page.getByRole('heading', { level: 1 })).toContainText('My site')
  await expect(page.locator('.toast.ok')).toHaveCount(2)
  await tab(page, 'Data & settings')
  await expect(page.getByText(/^2 rows/)).toBeVisible()
  for (const f of ['Queries.csv', 'Pages.csv']) await expect(page.getByRole('rowheader', { name: f })).toBeVisible()
  await page.goto('/app')
  await expect(page.getByRole('link', { name: 'My site' })).toHaveCount(1)
})

test('#8 rows that cannot be read are not replaced', async ({ page }) => {
  await newSite(page)
  await importMore(page, file('Queries.csv', `Top queries,${HEAD}\nshoes,5,500,1%,9\n`))
  await drop(page, file('Pages.csv', `Top pages,${HEAD}\nhttps://a.example/,5,500,1%,9\n`))
  await page.evaluate(() => { const get = IDBObjectStore.prototype.get; IDBObjectStore.prototype.get = function (k) { if (this.name === 'data') throw new DOMException('broken', 'DataError'); return get.call(this, k) } })
  await page.getByRole('button', { name: 'Import 1 rows' }).click()
  await expect(page.locator('.toast.error')).toContainText('Not imported')
  await page.reload()
  await expect(page.getByText(/^1 rows/)).toBeVisible()
})

test.describe('#9 dates', () => {
  test('text that is not a date is rejected', async ({ page }) => {
    await newSite(page)
    await drop(page, file('rows.csv', 'date,page,clicks,impressions,position\nWeek 12,https://a.example/,1,10,3\n2026-10-01,https://a.example/,1,10,3\n'))
    await expect(page.getByText(/rows ready/)).toBeVisible()
    await expect(page.getByText('1 rows ready')).toBeVisible()
  })
  test('a day-first column is read day-first', async ({ page }) => {
    await newSite(page)
    await drop(page, file('rows.csv', 'date,page,clicks,impressions,position\n07/11/2026,https://a.example/,1,10,3\n13/11/2026,https://a.example/,1,10,3\n'))
    await expect(page.getByText(/rows ready/)).toBeVisible()
    await expect(page.getByText('Dates 2026-11-07 to 2026-11-13.')).toBeVisible()
  })
})

test('#10 decay is not declared clean without dated page rows', async ({ page }) => {
  await newSite(page)
  await importAll(page, file('export.zip', zip(standardExport())))
  await tab(page, 'Decay')
  await expect(page.locator('.empty h3')).toBeVisible()
  await expect(page.getByText('No decaying pages')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Needs dated page rows' })).toBeVisible()
})

test('#10 decay says when the history is too short for the lookback', async ({ page }) => {
  await newSite(page)
  await importAll(page, file('rows.csv', flatPages('2026-01-01', 120)))
  await tab(page, 'Decay')
  await expect(page.getByRole('heading', { name: 'Not enough history' })).toBeVisible()
  await expect(page.locator('.empty')).toContainText('2026-01-01 to 2026-04-30')
})

test('#11 page rows that end before the chart are not decay', async ({ page }) => {
  await newSite(page)
  await importMore(page, file('rows.csv', flatPages('2026-01-01', 250)))
  await importMore(page, file('export.zip', zip({ ...standardExport(), 'Chart.csv': `Date,${HEAD}\n` + days('2026-08-10', 91).map(d => `${d},10,200,5%,5.29`).join('\n') })))
  await tab(page, 'Worklist')
  await expect(page.locator('.empty h3')).toBeVisible()
  await expect(page.getByText('Refresh /p')).toHaveCount(0)
})

test('#11 a chart with other dates does not zero the totals', async ({ page }) => {
  await newSite(page)
  await importMore(page, file('rows.csv', flatPages('2026-09-01', 60)))
  await importMore(page, file('Chart.csv', `Date,${HEAD}\n` + days(day('2026-09-01', -40), 30).map(d => `${d},10,100,10%,3`).join('\n')))
  await tab(page, 'Overview')
  await expect(page.locator('.kpis')).toBeVisible()
  await expect(kpi(page, 'clicks')).toHaveText('304')
})

test('#12 a page that lost everything is a page move', async ({ page }) => {
  const rows = (d: string, top: number) => Array.from({ length: 30 }, (_, i) => `${d},https://a.example/p${i}/,${i ? 100 - i : top},1000,3`)
  await newSite(page)
  await importAll(page, file('rows.csv', 'date,page,clicks,impressions,position\n' + [...rows('2026-09-01', 500), ...rows('2026-09-30', 1), ...rows('2026-10-01', 0), ...rows('2026-10-31', 0)].join('\n')))
  for (const m of ['2026-09', '2026-10']) {
    await page.locator('#win').selectOption(m)
    await page.getByRole('button', { name: 'Save snapshot' }).click()
  }
  await tab(page, 'History')
  await expect(page.getByRole('heading', { name: 'Biggest page moves' })).toBeVisible()
  await expect(page.locator('table').last().getByRole('row').nth(1)).toContainText('/p0/')
})

test.fail('#13 a flat site shows no change in February', async ({ page }) => {
  await newSite(page)
  await importAll(page, file('rows.csv', flatPages('2026-01-01', 90)))
  await page.locator('#win').selectOption('2026-02')
  await tab(page, 'Overview')
  await expect(kpi(page, 'clicks')).toHaveText('304')
  await expect(page.locator('.kpi.clicks .delta')).toHaveText('0')
})

test('#14 an unclosed quote is reported as such', async ({ page }) => {
  await newSite(page)
  await drop(page, file('Queries.csv', `Top queries,${HEAD}\na,10,100,10%,3\n"b,5,50,10%,3\nc,9,90,10%,2\nd,9,90,10%,2\n`))
  await expect(page.getByText(/rows ready/)).toBeVisible()
  await expect(page.getByText(/quote/i)).toBeVisible()
  await expect(page.getByRole('log')).toContainText('quote opened on line 3 never closes')
})

test('#14 an unclosed quote in the header row is reported as such', async ({ page }) => {
  await newSite(page)
  await drop(page, file('Queries.csv', `"Top queries,${HEAD}\na,10,100,10%,3\n`))
  await expect(page.locator('.toast.error')).toContainText('quote opened on line 1 never closes')
})

test.describe('#15 failed saves', () => {
  const q = file('Queries.csv', `Top queries,${HEAD}\na,10,100,10%,3\n`)
  const full = (page: Page) => page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new DOMException('full', 'QuotaExceededError') } })
  test('#15 a failed save is not reported as imported', async ({ page }) => {
    await newSite(page)
    await drop(page, q)
    await full(page)
    await page.getByRole('button', { name: 'Import 1 rows' }).click()
    await expect(page.locator('.toast').first()).toBeVisible()
    expect(await page.locator('.toast').first().textContent()).not.toContain('Imported')
    await expect(page.locator('.toast.error')).toContainText('storage is full')
    await expect(page.getByRole('button', { name: 'Import 1 rows' })).toBeEnabled()
    await expect(page.getByText('Imported data', { exact: true })).toHaveCount(0)
  })
  test('#15 a transaction that aborts after its request succeeded is a failed save', async ({ page }) => {
    await newSite(page)
    await drop(page, q)
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (v, k) { const r = k === undefined ? put.call(this, v) : put.call(this, v, k); r.addEventListener('success', () => this.transaction.abort()); return r }
    })
    await page.getByRole('button', { name: 'Import 1 rows' }).click()
    await expect(page.locator('.toast.error')).toContainText('Not imported')
    await expect(page.locator('.toast.ok')).toHaveCount(0)
  })
  test('#15 a failed import into a sample leaves no empty site behind', async ({ page }) => {
    await page.goto('/app?sample=ledgerly&tab=data')
    await drop(page, q)
    await page.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { if (this.name === 'data') throw new DOMException('full', 'QuotaExceededError'); return k === undefined ? put.call(this, v) : put.call(this, v, k) } })
    await page.getByRole('button', { name: 'Import 1 rows' }).click()
    await expect(page.locator('.toast.error')).toContainText('Not imported')
    await page.goto('/app')
    await expect(page.getByRole('link', { name: /Ledgerly/ }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'My site' })).toHaveCount(0)
  })
  test('#15 settings that could not be saved are said to last for the session', async ({ page }) => {
    await newSite(page)
    await full(page)
    await page.getByLabel('Page group depth').fill('3')
    await expect(page.locator('.toast.error').first()).toContainText('lasts until this tab closes')
    await expect(page.getByLabel('Page group depth')).toHaveValue('3')
  })
  test('#15 without any storage the rows are readable and said to be temporary', async ({ page }) => {
    await page.addInitScript(() => { IDBFactory.prototype.open = () => { throw new DOMException('no', 'SecurityError') } })
    await newSite(page)
    await expect(page.locator('.toast.error')).toContainText('does not let the app store data')
    await drop(page, q)
    await page.getByRole('button', { name: 'Import 1 rows' }).click()
    await expect(page.locator('.toast.ok')).toContainText('kept until this tab closes')
    await expect(page.getByText(/^1 rows/)).toBeVisible()
  })
})

test.fail('#16 sample rows can be dropped back in', async ({ page }) => {
  await page.goto('/app?sample=ledgerly&tab=data')
  const csv = await downloaded(page, () => page.getByRole('button', { name: 'Download 3 months of sample rows' }).click())
  await newSite(page)
  await drop(page, file('sample.csv', csv.text))
  await expect(page.getByText(/rows ready/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import 0 rows' })).toHaveCount(0)
})

test.fail('#17 a lookback of 12 months can be typed', async ({ page }) => {
  await newSite(page)
  const f = page.getByLabel('Decay lookback (months)')
  await f.press('ControlOrMeta+a')
  await f.pressSequentially('12')
  await f.blur()
  await expect(f).toHaveValue('12')
})
