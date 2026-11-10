# Search Console Doctor

Turns a Google Search Console export into a prioritised SEO worklist.

Live: https://gsc-doctor.vercel.app

## The pain

Content marketers, SEO freelancers and small-site owners open Search Console, see a table of clicks and positions, and ask "now what?". Finding cannibalised pages, decaying posts, titles that underperform their ranking, or the cause of a sudden drop means hours of filtering and pivot tables.

## What it does

- **Import**: the Performance export (zip of CSVs or Excel, normal or Compare mode) or query + page rows from the API, an Apps Script, Looker Studio or BigQuery. Tables are detected, columns mapped, and every rejected row is listed with its line number. Optional live pull with your own OAuth client ID (browser token flow, no secret).
- **Expected CTR curve** fitted from the site's own data (isotonic regression, √impressions weights, brand queries excluded). The gap to the curve is the opportunity in clicks per month.
- **Striking distance** queries at positions 8 to 20.
- **Cannibalisation**: queries where several pages split impressions and the leading page flips week to week. Scored, clustered, canonical picked, with a 301 / canonical redirect map (CSV, .htaccess, nginx).
- **Content decay**: Theil–Sen trend of monthly clicks per page, steady slide vs sudden step, and the queries each page lost.
- **Drop diagnosis**: every lost click split exactly into demand, rank and CTR, by page group, page, query, device, country and brand. Detects whether a drop is sitewide or one folder, finds the change point, and overlays dated Google core and spam updates.
- **Worklist** ranked by expected clicks per effort, with evidence, steps, a title/meta helper with SERP preview, done tracking and CSV export.
- **Monthly snapshots** with a compare view, and a printable client report.
- Local-first (IndexedDB), works signed out. Optional email/password account syncs sites across devices via Supabase.

Both sample sites are synthetic.

## Run locally

```
npm install
npm run dev     # http://localhost:5173
npm test        # engine tests
npm run build
```

Cloud sync needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`; without them the app runs local-only.
