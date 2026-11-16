# Search Console Doctor

Turns a Google Search Console export into a prioritised SEO worklist.

Live: https://gsc-doctor.vercel.app

## The pain

Content marketers, SEO freelancers and small-site owners open Search Console, see a table of clicks and positions, and ask "now what?". Finding cannibalised pages, decaying posts, titles that underperform their ranking, or the cause of a sudden drop means hours of filtering and pivot tables.

## What it does

- **Import**: the Performance export (zip of CSVs or Excel, normal or Compare mode, in English, German, French, Spanish, Italian, Portuguese or Dutch), the Search Console report exported from Google Analytics, Search Analytics API JSON, the raw BigQuery `searchdata_url_impression` table, or query + page rows from an Apps Script or Looker Studio. Tables are detected, columns mapped, and every rejected row is listed with its line number. Optional live pull with your own OAuth client ID (browser token flow, no secret).
- **Expected CTR curve** fitted from the site's own data (isotonic regression, √impressions weights, brand queries excluded). The gap to the curve is the opportunity in clicks per month.
- **Striking distance** queries at positions 8 to 20.
- **Cannibalisation**: queries where several pages split impressions and the leading page flips week to week. Scored, clustered, canonical picked, with a 301 / canonical redirect map (CSV, .htaccess, nginx).
- **Content decay**: Theil–Sen trend of monthly clicks per page, steady slide vs sudden step, and the queries each page lost.
- **Drop diagnosis**: every lost click split exactly into demand, rank and CTR, by page group, page, query, device, country and brand. Detects whether a drop is sitewide or one folder, finds the change point, and overlays dated Google core and spam updates.
- **Worklist** ranked by expected clicks per effort, with evidence, steps, a title/meta helper with SERP preview, done tracking and CSV export.
- **Monthly snapshots** with a compare view, and a printable client report.
- Local-first (IndexedDB), works signed out. Optional email/password account syncs sites across devices via Supabase.

Both sample sites are synthetic.

## Real data

- **Google ranking updates** come from the Google Search Status Dashboard. A built-in table (checked 2026-11-13) is merged at load with the dashboard's public feed, `https://status.search.google.com/incidents.json`, so new and still-rolling updates appear without a release. If the feed is unreachable the built-in table is used.
- **A real public export** can be imported from the workspace: the Search Console Performance export of lets-plot.org (1 Jan to 18 Dec 2024) from [JetBrains/lets-plot-docs](https://github.com/JetBrains/lets-plot-docs/tree/master/data/lp2024/original/lpd_performance), MIT licence, © JetBrains. It is bundled unchanged in `public/samples/` and goes through the same importer as any dropped file.
- **The importer is tested against real export layouts**: exports published by site owners on GitHub in English, German, French, Spanish and Italian, normal and Compare mode, the newer `Chart.csv` and older `Dates.csv`, a Google Analytics Search Console report, and a raw BigQuery table. Test fixtures use the real header rows with short excerpts or rows written to match.

## Known gaps

- A standard export dates only the site totals. It is analysed as one period; rolling 28-day and monthly ranges, content decay and cannibalisation need dated rows (API, Apps Script, Looker Studio or BigQuery).
- An explicit date range in a non-English Filters table ("1 juin 2026-30 juin 2026") is not parsed. The chart table gives the length instead; a Compare-mode export without one falls back to 90 days, editable under Data & settings.
- Portuguese and Dutch headers are mapped from Google's interface wording and have not been checked against a real export. Other languages need the manual column mapping.
- Countries keep the label of their source: names in the export, three-letter codes from the API.
- Anonymised BigQuery rows (no query) are left out of query + page imports, so totals from that table are lower than the site total.
- The live pull needs your own Google Cloud OAuth client ID; there is no hosted Google sign-in.

## Run locally

```
npm install
npm run dev     # http://localhost:5173
npm test        # engine tests
npm run build
```

Cloud sync needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`; without them the app runs local-only.
