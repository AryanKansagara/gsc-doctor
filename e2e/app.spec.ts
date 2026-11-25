import { days, downloaded, drop, expect, file, HEAD, importAll, kpi, mapField, newSite, standardExport, tab, test, xlsx, zip } from './fixtures'

test('landing demo runs the engine and links into the sample', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('You opened Search Console')
  await expect(page.locator('.metric-tabs .clicks b')).not.toHaveText('…')
  await expect(page.locator('.console svg.scatter')).toBeVisible()
  await page.getByRole('radio', { name: 'Ledgerly' }).click()
  await expect(page.getByRole('radio', { name: 'Ledgerly' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('link', { name: 'Try the sample' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ledgerly')
})

test('sample site: every section shows what the sample was built to contain', async ({ page }) => {
  await page.goto('/app?sample=butter-crumb')
  await expect(page.locator('.banner')).toContainText('Synthetic site')
  await tab(page, 'Worklist')
  await expect(page.locator('.action').first()).toBeVisible()
  await expect(page.getByText(/Rewrite the title and meta description of \/chocolate-chip-cookies\//)).toBeVisible()
  await tab(page, 'Cannibalisation')
  await expect(page.getByRole('heading', { name: '“banana bread recipe”' })).toBeVisible()
  await expect(page.locator('.code', { hasText: '.htaccess' })).toBeVisible()
  await tab(page, 'Decay')
  await expect(page.getByRole('heading', { name: '/guides/sourdough-starter/' })).toBeVisible()
  await tab(page, 'Queries & pages')
  await expect(page.locator('.curve-table')).toContainText('#1')
  await tab(page, 'History')
  await expect(page.getByText('3 saved')).toBeVisible()
})

test('SaaS sample: the drop is put on /blog/ and the May 2026 core update', async ({ page }) => {
  await page.goto('/app?sample=ledgerly&tab=drops')
  await expect(page.locator('.verdict')).toContainText('Concentrated in /blog/')
  await expect(page.getByText('May 2026 core update').first()).toBeVisible()
})

test('hand-worked: standard export totals scale 28 days to a 30.44-day month', async ({ page }) => {
  // Devices: 200 + 80 = 280 clicks, 3,800 + 1,800 = 5,600 impressions, CTR 280 / 5,600 = 5.0%.
  // Position (3,800 x 4 + 1,800 x 8) / 5,600 = 29,600 / 5,600 = 5.29. Monthly: 280 x 30.44 / 28 = 304.4; 5,600 x 30.44 / 28 = 6,088.
  await newSite(page)
  await importAll(page, file('export.zip', zip(standardExport())))
  await tab(page, 'Overview')
  await expect(kpi(page, 'clicks')).toHaveText('304')
  await expect(kpi(page, 'impressions')).toHaveText('6,088')
  await expect(kpi(page, 'ctr')).toHaveText('5.0%')
  await expect(kpi(page, 'position')).toHaveText('5.3')
  await expect(page.getByText('Imported export period · 28 days')).toBeVisible()
})

test('hand-worked: striking distance on the prior curve', async ({ page }) => {
  // One query is too little to fit a curve, so the prior applies: 5.2% at position 5. "pasta water" has 2,800 impressions
  // in 28 days (3,044 a month) at 1%: (5.2% - 1%) x 3,044 = 127.8 clicks a month.
  await newSite(page)
  await importAll(page, file('export.zip', zip(standardExport())))
  await tab(page, 'Queries & pages')
  const row = page.getByRole('row', { name: /pasta water/ }).first()
  await expect(row).toContainText('3,044')
  await expect(row).toContainText('10.0')
  await expect(row).toContainText('+128')
})

test('hand-worked: drop split into demand, rank and CTR adds up', async ({ page }) => {
  // 28 days of 10 clicks / 200 impressions, then 28 days of 5 / 150, always position 3. 280 -> 140 clicks.
  // Demand: (4,200 - 5,600) x 5% = -70. Rank: same position, 0. CTR: -140 + 70 = -70.
  await newSite(page)
  await importAll(page, file('rows.csv', `date,page,clicks,impressions,position\n` + days('2026-09-01', 56).map((d, i) => `${d},https://a.example/guide/x/,${i < 28 ? '10,200' : '5,150'},3`).join('\n')))
  await tab(page, 'Drops')
  await page.getByRole('radio', { name: 'Last 28 days vs previous' }).click()
  await expect(page.locator('.parts-total .kpi.demand b')).toHaveText('−70')
  await expect(page.locator('.parts-total .kpi.rank b')).toHaveText('0')
  await expect(page.locator('.parts-total .kpi.ctr b')).toHaveText('−70')
  await expect(page.getByText('280 → 140 clicks (-50.0%)')).toBeVisible()
})

test('hand-worked: cannibalisation scores', async ({ page }) => {
  // "split query" is 75 / 25 every day and never flips: 1 - (0.75^2 + 0.25^2) = 0.375, normalised / 0.5 = 0.75, score 0.6 x 75 = 45.
  // "flip query" swaps 75 / 25 each Monday-to-Sunday week: 50 / 50 overall (1.0) and 3 of 3 changes (1.0), score 60 + 40 = 100.
  const rows = days('2026-10-05', 28).flatMap((d, i) => {
    const odd = Math.floor(i / 7) % 2
    return [`${d},split query,https://a.example/a/,3,75,4`, `${d},split query,https://a.example/b/,1,25,6`,
      `${d},flip query,https://a.example/c/,3,${odd ? 25 : 75},4`, `${d},flip query,https://a.example/d/,1,${odd ? 75 : 25},6`]
  })
  await newSite(page)
  await importAll(page, file('qp.csv', 'date,query,page,clicks,impressions,position\n' + rows.join('\n')))
  await tab(page, 'Cannibalisation')
  const card = (q: string) => page.locator('.cann', { has: page.getByRole('heading', { name: `“${q}”` }) })
  await expect(card('split query').locator('.score')).toHaveText('45')
  await expect(card('flip query').locator('.score')).toHaveText('100')
  await expect(card('split query').getByRole('row', { name: /canonical/ })).toContainText('/a/')
  const csv = await downloaded(page, () => page.getByRole('button', { name: 'Download CSV' }).click())
  expect(csv.text.split('\n')[0]).toBe('from,to,action,reason,queries')
  expect(csv.text).toContain('https://a.example/b/,https://a.example/a/,301,')
})

test('hand-worked: content decay trend', async ({ page }) => {
  // Monthly clicks 600, 500, 400, 300, 200, 100: every pairwise slope is -100. Baseline = median(600, 500, 400) = 500.
  // Trend = -100 x 5 / 500 = -100%. Gain = half of 500 - 100 = 200.
  const dates = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-31']
  await newSite(page)
  await importAll(page, file('pages.csv', 'date,page,clicks,impressions,position\n' + dates.map((d, i) => `${d},https://a.example/old/,${600 - i * 100},10000,3`).join('\n')))
  await tab(page, 'Decay')
  await expect(page.getByRole('heading', { name: '/old/' })).toBeVisible()
  await expect(page.locator('.gain')).toContainText('+200')
  await expect(page.locator('.decay-row')).toContainText('500')
  await expect(page.locator('.decay-row .down')).toHaveText('-100%')
})

test('worklist: done items, filters and CSV', async ({ page }) => {
  await page.goto('/app?sample=butter-crumb&tab=worklist')
  const first = page.locator('.action').first()
  const title = (await first.locator('h3').textContent())!
  await first.getByRole('checkbox', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('Show done (1)')).toBeVisible()
  await page.getByLabel('Show done (1)').check()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  const csv = await downloaded(page, () => page.getByRole('button', { name: 'Worklist CSV' }).click())
  expect(csv.name).toMatch(/worklist\.csv$/)
  expect(csv.text.split('\n')[0]).toBe('rank,type,action,target,expected_clicks_per_month,effort,queries,evidence,done')
  expect(csv.text.split('\n').filter(l => l.endsWith(',yes'))).toHaveLength(1)
  await page.getByRole('radio', { name: /^Consolidate pages/ }).click()
  for (const chip of await page.locator('.action .kind-chip').all()) await expect(chip).toHaveText('Consolidate pages')
})

test('title helper: advice updates and the title is kept after reload', async ({ page }) => {
  await page.goto('/app?sample=butter-crumb&tab=worklist')
  const field = page.getByLabel('Current title of /chocolate-chip-cookies/')
  await expect(field).toHaveValue('Cookies')
  await field.fill('Chocolate Chip Cookies Recipe: Chewy in the Middle')
  await field.blur()
  await expect(page.locator('.title-helper', { has: field }).locator('.checks')).toContainText('early')
  await page.reload()
  await expect(page.getByLabel('Current title of /chocolate-chip-cookies/')).toHaveValue('Chocolate Chip Cookies Recipe: Chewy in the Middle')
})

test('snapshots: save, compare, delete with undo', async ({ page }) => {
  await page.goto('/app?sample=butter-crumb&tab=history')
  await expect(page.getByText('3 saved')).toBeVisible()
  await page.getByRole('button', { name: 'Save snapshot' }).click()
  await expect(page.getByText('4 saved')).toBeVisible()
  await expect(page.getByText(/^Resolved \(\d+\)/)).toBeVisible()
  await page.getByRole('row').filter({ hasText: 'May 2026' }).getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('3 saved')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).last().click()
  await expect(page.getByText('4 saved')).toBeVisible()
})

test('report: KPIs match the overview and the client report has its sections', async ({ page }) => {
  await page.goto('/app?sample=butter-crumb')
  const clicks = await kpi(page, 'clicks').textContent()
  await page.getByRole('link', { name: 'Report', exact: true }).click()
  await expect(page.getByText('Monthly SEO report')).toBeVisible()
  await expect(kpi(page, 'clicks')).toHaveText(clicks!)
  for (const h of ['Summary', 'Next actions', 'Redirect plan', 'Top pages']) await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible()
  await expect(page.getByText('This site is synthetic.')).toBeVisible()
})

test('a site persists across reload, can be renamed, deleted and restored', async ({ page }) => {
  await newSite(page)
  await importAll(page, file('export.zip', zip(standardExport())))
  await page.reload()
  await tab(page, 'Overview')
  await expect(kpi(page, 'clicks')).toHaveText('304')
  await page.goto('/app')
  await page.getByRole('button', { name: 'Rename' }).click()
  await page.getByLabel('Project name').fill('Pasta site')
  await page.getByLabel('Project name').press('Enter')
  await expect(page.getByRole('link', { name: 'Pasta site' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete site' }).click()
  await expect(page.getByRole('link', { name: 'Pasta site' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('link', { name: 'Pasta site' }).click()
  await expect(kpi(page, 'clicks')).toHaveText('304')
})

test('settings: defaults apply to new sites; JSON export holds the data and no sign-in material', async ({ page }) => {
  await page.goto('/settings')
  await page.getByLabel('Page group depth').fill('3')
  await newSite(page)
  await expect(page.getByLabel('Page group depth')).toHaveValue('3')
  await importAll(page, file('export.zip', zip(standardExport())))
  await page.goto('/settings')
  const out = await downloaded(page, () => page.getByRole('button', { name: 'Export all my data (JSON)' }).click())
  const json = JSON.parse(out.text)
  expect(json.app).toBe('gsc-doctor')
  expect(json.projects[0].dataset).toHaveLength(28 + 2 + 1 + 1)
  expect(out.text).not.toMatch(/token|password|apikey|clientId/i)
  await page.getByRole('radio', { name: 'Dark' }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark')
})

test('brand terms split branded clicks', async ({ page }) => {
  // 60 of 100 query clicks contain the brand ("ac-me" squashes to "acme").
  await newSite(page)
  await importAll(page, file('Queries.csv', `Top queries,${HEAD}\nacme login,40,400,10%,1\nac-me,20,200,10%,1\nshoes,40,4000,1%,8\n`))
  await page.getByLabel(/^Brand terms/).fill('acme')
  await page.getByLabel(/^Brand terms/).blur()
  await tab(page, 'Overview')
  await expect(page.getByRole('row', { name: /^Branded/ })).toContainText('60')
  await expect(page.getByRole('row', { name: /^Non-branded/ })).toContainText('40')
})

test('docs, unknown page and unknown site', async ({ page }) => {
  await page.goto('/docs')
  await expect(page.getByRole('heading', { name: 'Getting your data out of Search Console' })).toBeVisible()
  await expect(page.getByText('May 2026 core update')).toBeVisible()
  await page.goto('/nope')
  await expect(page.getByRole('heading', { name: 'This URL is not indexed' })).toBeVisible()
  await page.goto('/app/p/not-a-site')
  await expect(page.getByRole('heading', { name: 'Site not found' })).toBeVisible()
  await page.goto('/app/p/not-a-site/report')
  await expect(page.getByRole('heading', { name: 'Nothing to report' })).toBeVisible()
})

test('keyboard: 2 opens the worklist, p the report', async ({ page }) => {
  await page.goto('/app?sample=butter-crumb')
  await expect(kpi(page, 'clicks')).toBeVisible()
  await page.keyboard.press('2')
  await expect(page).toHaveURL(/\/worklist$/)
  await page.keyboard.press('p')
  await expect(page.getByText('Monthly SEO report')).toBeVisible()
})

test.describe('import formats', () => {
  test('Excel workbook gives the same totals as the zip', async ({ page }) => {
    await newSite(page)
    await importAll(page, file('export.xlsx', xlsx({
      Chart: [['Date', 'Clicks', 'Impressions', 'CTR', 'Position'], ...days('2026-10-01', 28).map(d => [d, 10, 200, 0.05, 5.29])],
      Devices: [['Device', 'Clicks', 'Impressions', 'CTR', 'Position'], ['Desktop', 200, 3800, 0.0526, 4], ['Mobile', 80, 1800, 0.0444, 8]],
      Filters: [['Filter', 'Value'], ['Date', 'Last 28 days']],
    })))
    await tab(page, 'Overview')
    await expect(kpi(page, 'clicks')).toHaveText('304')
    await expect(kpi(page, 'position')).toHaveText('5.3')
  })

  test('German CSV with a BOM, CRLF, semicolons and decimal commas', async ({ page }) => {
    await newSite(page)
    await drop(page, file('Geräte.csv', '﻿Gerät;Klicks;Impressionen;CTR;Position\r\nComputer;200;3800;5,26%;4\r\nMobil;80;1800;4,44%;8,5\r\n'))
    await expect(page.getByText('2 rows ready')).toBeVisible()
    await expect(page.locator('.badge', { hasText: 'Devices table' })).toBeVisible()
    await page.getByRole('button', { name: 'Import 2 rows' }).click()
    await tab(page, 'Overview')
    // (3,800 x 4 + 1,800 x 8.5) / 5,600 = 30,500 / 5,600 = 5.45
    await expect(kpi(page, 'position')).toHaveText('5.4')
    await expect(kpi(page, 'ctr')).toHaveText('5.0%')
  })

  test('Compare mode: both periods are read', async ({ page }) => {
    await newSite(page)
    await importAll(page, file('compare.zip', zip({
      'Devices.csv': 'Device,Last 28 days Clicks,Previous 28 days Clicks,Last 28 days Impressions,Previous 28 days Impressions,Last 28 days CTR,Previous 28 days CTR,Last 28 days Position,Previous 28 days Position\nMobile,56,112,1120,1120,5%,10%,4,4\n',
      'Filters.csv': 'Filter,Value\nDate,Compare last 28 days to previous period\n',
    })))
    await tab(page, 'Drops')
    await expect(page.getByText('112 → 56 clicks (-50.0%)')).toBeVisible()
    await tab(page, 'Overview')
    // 56 x 30.44 / 28 = 60.9 a month
    await expect(kpi(page, 'clicks')).toHaveText('61')
  })

  test('Search Analytics JSON, Analytics report and raw BigQuery rows', async ({ page }) => {
    await newSite(page)
    await drop(page, file('api.json', JSON.stringify({ rows: [{ keys: ['2026-10-01', 'shoes', 'https://a.example/s/', 'usa', 'MOBILE'], clicks: 2, impressions: 40, ctr: 0.05, position: 3 }] })))
    await expect(page.getByText('Grain: query + page + country + device, by date.')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await drop(page, file('ga.csv', '# ----\n# Queries\n# ----\nOrganic Google Search query,Organic Google Search clicks,Organic Google Search impressions,Organic Google Search click through rate,Organic Google Search average position\nshoes,5,100,0.05,4\n'))
    await expect(page.locator('.badge', { hasText: 'Queries table' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await drop(page, file('bq.csv', 'data_date,url,query,is_anonymized_query,search_type,impressions,clicks,sum_position\n2026-10-01,https://a.example/,shoes,false,WEB,10,1,20\n2026-10-01,https://a.example/,,true,WEB,10,1,20\n2026-10-01,https://a.example/,shoes,false,IMAGE,10,1,20\n'))
    await expect(page.getByText('1 rows ready')).toBeVisible()
    await expect(page.getByRole('log')).toContainText('1 anonymised row with no query left out')
    await expect(page.getByRole('log')).toContainText('1 row from other search types')
  })

  test('the bundled public export imports and is analysed', async ({ page }) => {
    await page.goto('/app')
    await page.getByRole('button', { name: 'Import a real public one' }).click()
    await page.getByRole('button', { name: 'Import all ready tables' }).click()
    await expect(page.locator('.toast.ok')).toContainText('Imported')
    await tab(page, 'Overview')
    // Devices: 13,462 + 926 + 41 = 14,429 clicks over 339 chart days: 14,429 x 30.44 / 339 = 1,295.6
    await expect(kpi(page, 'clicks')).toHaveText('1,296')
  })

  test('normalised CSV imports back to the same totals', async ({ page }) => {
    await newSite(page)
    await importAll(page, file('rows.csv', 'date,page,clicks,impressions,position\n' + days('2026-10-01', 28).map(d => `${d},https://a.example/x,10,200,3`).join('\n')))
    const out = await downloaded(page, () => page.getByRole('button', { name: 'Download normalised CSV' }).click())
    await newSite(page)
    await drop(page, file('back.csv', out.text))
    // The export lists every dimension column, so unused ones are unmapped by hand.
    for (const f of ['Query', 'Country', 'Device']) await mapField(page, f).selectOption('')
    await page.getByRole('button', { name: 'Import 28 rows' }).click()
    await tab(page, 'Overview')
    await expect(kpi(page, 'clicks')).toHaveText('304')
  })

  test('importing the same dates again does not double count', async ({ page }) => {
    const f = file('rows.csv', 'date,page,clicks,impressions,position\n' + days('2026-10-01', 28).map(d => `${d},https://a.example/x,10,200,3`).join('\n'))
    await newSite(page)
    await importAll(page, f)
    await expect(page.getByText('28 rows ·')).toBeVisible()
    await drop(page, f)
    await page.getByRole('button', { name: 'Import 28 rows' }).click()
    await expect(page.getByRole('cell', { name: '2026-10-01 to 2026-10-28' })).toHaveCount(2)
    await expect(page.getByText('28 rows ·')).toBeVisible()
  })

  test('manual mapping makes unknown headers usable', async ({ page }) => {
    await newSite(page)
    await drop(page, file('odd.csv', 'zapytanie,kliknięcia,wyświetlenia,pozycja\nbuty,5,100,4\n'))
    await expect(page.locator('.badge', { hasText: 'Unrecognised columns' })).toBeVisible()
    await mapField(page, 'Query').selectOption('0')
    await mapField(page, 'Clicks *').selectOption('1')
    await mapField(page, 'Impressions *').selectOption('2')
    await mapField(page, 'Position *').selectOption('3')
    await expect(page.getByText('1 rows ready')).toBeVisible()
  })
})

test.describe('bad input never looks like a result', () => {
  for (const [name, body, message] of [
    ['an empty file', '', 'has no data rows'],
    ['a header with no rows', `Top queries,${HEAD}\n`, 'has no data rows'],
    ['truncated JSON', '{"rows":[{"keys":["a"],"clicks":1', 'could not be parsed'],
    ['an API error response', '{"error":{"code":403}}', 'No rows found in this JSON'],
    ['a truncated zip', zip(standardExport()).subarray(0, 900), 'Not a zip file'],
    ['a zip without tables', zip({ 'readme.md': 'hi' }), 'has no data rows'],
  ] as const) test(name, async ({ page }) => {
    await newSite(page)
    await drop(page, file('bad.csv', body as string))
    await expect(page.locator('.toast.error')).toContainText(message)
    await expect(page.getByRole('button', { name: /^Import [\d,]+ rows$/ })).toHaveCount(0)
  })

  test('unrelated CSV and binary data cannot be imported', async ({ page }) => {
    await newSite(page)
    await drop(page, file('people.csv', 'name,age\nAnn,30\n'))
    await expect(page.locator('.badge', { hasText: 'Unrecognised columns' })).toBeVisible()
    await expect(page.getByRole('log')).toContainText('No column is mapped to clicks')
    await expect(page.getByRole('button', { name: 'Import 0 rows' })).toBeDisabled()
  })

  test('bad rows are listed with their line and left out; good rows stay', async ({ page }) => {
    await newSite(page)
    await drop(page, file('rows.csv', 'date,query,clicks,impressions,position\n2026-10-01,ok,1,10,3\nsoon,x,1,10,3\n2026-10-02,,1,10,3\n2026-10-02,neg,-1,10,3\n2026-10-02,over,11,10,3\n2026-10-02,pos,1,10,0.5\n2026-10-02,text,many,10,3\n2026-02-30,day,1,10,3\n'))
    await expect(page.getByText('1 rows ready')).toBeVisible()
    const log = page.getByRole('log')
    for (const s of ['line 3Unreadable date "soon"', 'line 4Empty query', 'line 5Clicks "-1"', 'line 6Clicks (11) exceed impressions (10)', 'line 7Position "0.5" must be 1 or more', 'line 8Clicks "many" is not a number', 'line 9Unreadable date "2026-02-30"']) await expect(log).toContainText(s)
  })

  test('markup in queries, pages and titles is shown as text', async ({ page }) => {
    const evil = '<img src=x onerror=document.body.dataset.pwned=1>'
    await newSite(page)
    await importAll(page, file('Queries.csv', `Top queries,${HEAD}\n"${evil}",5,5000,0.1%,9\n`))
    await tab(page, 'Queries & pages')
    await expect(page.getByText(evil).first()).toBeVisible()
    expect(await page.evaluate(() => document.body.dataset.pwned)).toBeUndefined()
  })
})

