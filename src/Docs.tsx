import { useEffect } from 'react'
import { UPDATES, UPDATES_CHECKED, updateEnd } from './engine/updates.ts'
import { Code, Link } from './ui.tsx'

const CHECKED = '2026-11-09'

const APPS_SCRIPT = `// Google Sheets: Extensions → Apps Script. Paste, set SITE, run exportSearchConsole once and approve access.
// Project Settings → tick "Show appsscript.json manifest" and add the oauthScopes shown below it.
const SITE = 'sc-domain:example.com' // or 'https://www.example.com/' for a URL-prefix property
const MONTHS = 6

function exportSearchConsole() {
  const fmt = d => Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd')
  const end = new Date(Date.now() - 3 * 864e5) // data lags about two days
  const start = new Date(end.getTime() - MONTHS * 30.44 * 864e5)
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet()
  sheet.clear().appendRow(['date', 'query', 'page', 'clicks', 'impressions', 'ctr', 'position'])
  let startRow = 0, rows
  do {
    const res = UrlFetchApp.fetch(
      'https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(SITE) + '/searchAnalytics/query', {
        method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({ startDate: fmt(start), endDate: fmt(end), dimensions: ['date', 'query', 'page'], type: 'web', rowLimit: 25000, startRow }),
      })
    rows = JSON.parse(res.getContentText()).rows || []
    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 7)
      .setValues(rows.map(r => [...r.keys, r.clicks, r.impressions, r.ctr, r.position]))
    startRow += rows.length
  } while (rows.length === 25000)
}`

const MANIFEST = `{
  "timeZone": "Etc/UTC",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/spreadsheets.currentonly",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}`

const BQ_ROWS = `-- Query + page rows by day (anonymised queries have no query text, so they are left out here)
SELECT
  data_date AS date,
  query,
  url AS page,
  SUM(clicks) AS clicks,
  SUM(impressions) AS impressions,
  SUM(sum_position) / SUM(impressions) + 1 AS position   -- sum_position is zero-based
FROM \`your-project.searchconsole.searchdata_url_impression\`
WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)
  AND search_type = 'WEB'
  AND NOT is_anonymized_query
GROUP BY date, query, page
HAVING impressions > 0`

const BQ_PAGES = `-- Page totals by day, including anonymised queries (makes decay and drop numbers complete)
SELECT
  data_date AS date,
  url AS page,
  SUM(clicks) AS clicks,
  SUM(impressions) AS impressions,
  SUM(sum_position) / SUM(impressions) + 1 AS position
FROM \`your-project.searchconsole.searchdata_url_impression\`
WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)
  AND search_type = 'WEB'
GROUP BY date, page`

const BQ_SITE = `-- Daily site totals, plus device and country splits for drop diagnosis
SELECT
  data_date AS date,
  device,
  country,
  SUM(clicks) AS clicks,
  SUM(impressions) AS impressions,
  SUM(sum_top_position) / SUM(impressions) + 1 AS position   -- site table uses sum_top_position
FROM \`your-project.searchconsole.searchdata_site_impression\`
WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)
  AND search_type = 'WEB'
GROUP BY date, device, country`

export default function Docs() {
  useEffect(() => {
    const h = location.hash.slice(1)
    if (h) requestAnimationFrame(() => document.getElementById(h)?.scrollIntoView())
  }, [])
  return (
    <section className="page docs">
      <aside className="docs-nav" aria-label="On this page">
        <a href="#export">Performance export</a>
        <a href="#compare">Compare two periods</a>
        <a href="#query-page">Query + page rows</a>
        <a href="#live">Live pull (optional)</a>
        <a href="#formats">Accepted formats</a>
        <a href="#method">How the numbers work</a>
        <a href="#updates">Google update dates</a>
        <a href="#faq">FAQ</a>
      </aside>
      <div className="docs-body">
        <div className="eyebrow">Docs · checked {CHECKED}</div>
        <h1>Getting your data out of Search Console</h1>
        <p className="lede">Everything runs in your browser. Start with the 30-second export; add query + page rows when you want cannibalisation and per-page fixes.</p>

        <h2 id="export">1. The Performance export (30 seconds)</h2>
        <ol>
          <li>Open <b>Search Console → Performance → Search results</b> for your property.</li>
          <li>Set <b>Date</b> to the range you want (up to the last 16 months). Leave Search type on <b>Web</b>.</li>
          <li>Click <b>Export</b> (top right) and pick <b>Download CSV</b> (a zip) or <b>Download Excel</b> (one .xlsx).</li>
          <li><Link href="/app">Drop the file into a site</Link>. Both formats contain the tables <code>Queries</code>, <code>Pages</code>, <code>Countries</code>, <code>Devices</code>, <code>Search appearance</code>, <code>Dates</code> and <code>Filters</code>; the app imports the first five it can use and reads your filters for the label.</li>
        </ol>
        <p className="small muted">Limits: each table holds at most 1,000 rows, and queries and pages are never paired. That is enough for the CTR curve, striking distance, brand split, the Dates timeline and a site-level drop check. For cannibalisation and decay you need step 3.</p>

        <h2 id="compare">2. Compare two periods</h2>
        <p>In the Date filter choose the <b>Compare</b> tab (for example &ldquo;Compare last 28 days to previous period&rdquo;), then export. Each metric gets two columns (&ldquo;Last 28 days Clicks&rdquo;, &ldquo;Previous 28 days Clicks&rdquo;); the importer maps the second one to the previous period automatically. Dated rows from step 3 do not need this: any two windows can be compared in the app.</p>

        <h2 id="query-page">3. Query + page rows (for cannibalisation and decay)</h2>
        <p>The Search Console API returns rows broken down by <code>date</code>, <code>query</code> and <code>page</code> together. Four free ways to get them, easiest first:</p>
        <h3>a. Apps Script in Google Sheets (free, about 5 minutes)</h3>
        <p>Create a blank Google Sheet, open <b>Extensions → Apps Script</b>, paste this, set <code>SITE</code>, and run it. When it finishes, <b>File → Download → CSV</b> and drop the CSV here.</p>
        <Code code={APPS_SCRIPT} label="Apps Script" />
        <Code code={MANIFEST} label="appsscript.json" />
        <p className="small muted">The API returns at most 25,000 rows per request and the script pages through them. A sheet holds 10 million cells (about 1.4 million rows of this shape). Very large sites: use BigQuery.</p>
        <h3>b. A Sheets add-on</h3>
        <p>Add-ons such as <b>Search Analytics for Sheets</b> (free tier) do the same thing with a form: pick the property and date range, group by <b>Date, Query, Page</b>, run, then download as CSV.</p>
        <h3>c. Looker Studio</h3>
        <p>Add a data source with the <b>Search Console</b> connector and choose the <b>URL impression</b> table. Build a table with <code>Date</code>, <code>Query</code>, <code>Landing Page</code>, <code>Url Clicks</code>, <code>Impressions</code>, <code>Average Position</code>, then use the chart menu → <b>Export → CSV</b>. Those column names map automatically.</p>
        <h3>d. BigQuery bulk data export</h3>
        <p>In Search Console, <b>Settings → Bulk data export</b> sends daily tables to a BigQuery dataset (default name <code>searchconsole</code>). It only covers days after you turn it on. Run these and save each result as CSV (or to Sheets first). As of {CHECKED} the BigQuery sandbox and free tier cover 1 TB of queries and 10 GB of storage a month; a small site&rsquo;s export stays well inside that.</p>
        <Code code={BQ_ROWS} label="BigQuery SQL · query + page" />
        <Code code={BQ_PAGES} label="BigQuery SQL · pages" />
        <Code code={BQ_SITE} label="BigQuery SQL · site, device, country" />

        <h2 id="live">4. Live pull with your own client ID (optional)</h2>
        <p>The app can call the Search Console API straight from the browser using Google&rsquo;s token flow (no client secret, no server, the token lives only in the tab). It does not ship a shared client ID: <code>webmasters.readonly</code> is a sensitive scope, so a public client needs Google&rsquo;s app verification, and the authorization-code flow with PKCE still requires a client secret for web clients. Your own client in testing mode avoids both:</p>
        <ol>
          <li>In <b>Google Cloud console</b>, create a project and enable <b>Google Search Console API</b>.</li>
          <li><b>Google Auth Platform → Audience</b>: External, Testing, and add your Google account as a test user.</li>
          <li><b>Clients → Create client → Web application</b>. Under Authorised JavaScript origins add <code>{location.origin}</code>.</li>
          <li>Copy the client ID into <b>Data &amp; settings → Live pull</b>, connect, pick the property and pull. It fetches daily totals, pages, devices, countries and query + page rows.</li>
        </ol>

        <h2 id="formats">Accepted formats</h2>
        <ul>
          <li>Search Console Performance export: the CSV zip or the Excel workbook, normal or Compare mode.</li>
          <li>Any CSV/TSV with clicks, impressions and position, plus any of date, query, page, country, device. Header synonyms such as <code>Top queries</code>, <code>Landing Page</code>, <code>Url Clicks</code>, <code>Average Position</code> and <code>data_date</code> map automatically; anything else can be mapped by hand.</li>
          <li>Dates: <code>2026-11-07</code>, <code>11/7/2026</code>, <code>20261107</code> or Excel serial days. CTR: <code>3.2%</code> or <code>0.032</code> (CTR is recomputed from clicks / impressions).</li>
          <li>Validation lists every skipped row with its line number: bad numbers, clicks above impressions, positions under 1, unreadable dates, empty queries, duplicates. URLs lose <code>#fragments</code> so jump links do not look like separate pages.</li>
        </ul>

        <h2 id="method">How the numbers work</h2>
        <dl className="method">
          <dt>Expected CTR curve</dt>
          <dd>One point per non-branded query per month over the last 6 months, binned by position, each query weighted by √impressions so one huge query cannot define a bin. An isotonic regression (pool-adjacent-violators) makes CTR never rise as position gets worse. With too few positions it falls back to a weighted log fit, then to an industry prior. Opportunity clicks = (expected CTR − actual CTR) × impressions.</dd>
          <dt>Striking distance</dt>
          <dd>Non-branded queries at average position 8 to 20 with at least the minimum impressions. Potential = clicks if the query reached position 5 on this site&rsquo;s curve.</dd>
          <dt>Cannibalisation</dt>
          <dd>A query where two or more pages each take 10%+ of its impressions. Score = 60 × evenness of the split (1 − HHI, normalised) + 40 × the share of weeks in the last 12 where the leading page changed. Pages linked by contested queries form a cluster; the canonical is the page with the most clicks on them. Gain assumes the merged page gets all the impressions at the best page&rsquo;s position. Losing pages get a 301 when at least half their clicks are contested, otherwise a canonical and internal links.</dd>
          <dt>Content decay</dt>
          <dd>Monthly clicks per page over the lookback window. Trend = Theil–Sen slope (median of all pairwise slopes). Flagged when the trend loses 25%+ of the first-half median and at least the minimum clicks. &ldquo;Step&rdquo; means one month holds most of the loss. Queries lost compare the first half with the last month. Gain assumes a refresh wins back half.</dd>
          <dt>Drop diagnosis</dt>
          <dd>Change in clicks = demand + rank + CTR, exactly. Demand = Δimpressions × old CTR. Rank = new impressions × old CTR × (expected CTR at new position / expected at old − 1). CTR = the rest. Run per page group, page, query, device, country and brand. A drop is a <b>cluster</b> when one group holds 60%+ of losses, fell 20%+, and the rest of the site moved less than −10%; <b>sitewide</b> when 60%+ of groups with real traffic fell 10%+. The change point is the day where the 14-day average after falls furthest below the 14 days before (at least 15%).</dd>
          <dt>Monthly numbers</dt>
          <dd>All per-month figures scale the selected range to 30.44 days. Undated exports assume the length of the Dates table, else 3 months (Search Console&rsquo;s default).</dd>
        </dl>

        <h2 id="updates">Google ranking update dates</h2>
        <p className="small muted">From the Google Search Status Dashboard (Ranking history), checked {UPDATES_CHECKED}. Rollout end = start + listed duration. Shaded on every timeline.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Update</th><th>Start</th><th>End</th><th className="num">Days</th></tr></thead>
          <tbody>{UPDATES.map(u => <tr key={u.name}><th scope="row">{u.name}</th><td>{u.start}</td><td>{updateEnd(u)}</td><td className="num">{u.days}</td></tr>)}</tbody>
        </table></div>

        <h2 id="faq">FAQ</h2>
        <h3>Clicks dropped in Search Console but not in GA4 (or the other way round)</h3>
        <p>They count different things. Search Console counts clicks on Google results, including people who bounce before analytics loads or decline cookies; GA4 counts sessions it can measure, credits some Google traffic to other channels, and misses consented-out visitors. A drop in only one usually means tracking or attribution changed, not rankings. Check the Drops tab: if Search Console impressions and positions held, look at your tag, consent banner or redirects first.</p>
        <h3>Why do query rows add up to less than the total?</h3>
        <p>Google hides rare queries for privacy (&ldquo;anonymised queries&rdquo;). Page and site totals include them; query rows do not. The app uses the most complete table available for each number.</p>
        <h3>Is my data uploaded?</h3>
        <p>No. Files are parsed in your browser and stored in IndexedDB. Signing in (optional) syncs settings, titles, done items and snapshots, plus raw rows when they are under 1.5 MB per site.</p>
      </div>
    </section>
  )
}
