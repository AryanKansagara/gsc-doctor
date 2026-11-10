import { useEffect, useState } from 'react'
import { analyze, type Analysis, type QueryPoint } from './engine/analyze.ts'
import { generate, SAMPLES } from './engine/sample.ts'
import { DEFAULT_SETTINGS } from './engine/types.ts'
import { CtrScatter, FixCard } from './charts.tsx'
import { fmtK, fmtN, fmtPct, Link } from './ui.tsx'

function useSampleAnalysis(id: string) {
  const [a, setA] = useState<Analysis | null>(null)
  useEffect(() => {
    setA(null)
    // Runs the real engine on the synthetic site after first paint.
    const t = setTimeout(() => { const s = SAMPLES.find(x => x.id === id)!; setA(analyze(generate(id), 'l28', { ...DEFAULT_SETTINGS, brandTerms: s.brand })) }, 30)
    return () => clearTimeout(t)
  }, [id])
  return a
}

const QUOTES = [
  ['“I check Search Console every week. Then what do I actually do?”', 'r/SEO, on the gap between looking at the report and knowing the next move'],
  ['“Is there a way to find keyword cannibalisation without spending hours filtering queries one by one?”', 'r/DigitalMarketing'],
  ['“Sudden drop in impressions and clicks. Was it an update, or did we break something?”', 'r/bigseo'],
]

const FEATURES = [
  ['CTR gaps, measured on your own curve', 'An isotonic CTR-by-position curve fitted from your queries, not a 2019 industry chart. Every query under it gets an opportunity in clicks per month and a title rewrite.', 'ctr'],
  ['Cannibalisation with a redirect plan', 'Queries where several pages split impressions and Google keeps swapping the leader. Scored, clustered, with a canonical pick and a 301 / canonical map as CSV, .htaccess or nginx.', 'cannibal'],
  ['Content decay on a robust trend', 'Theil–Sen slope of monthly clicks per page, steady slide vs sudden step, and the exact queries each page lost.', 'decay'],
  ['Drop diagnosis that adds up', 'Every lost click split into demand, rank and CTR, by page group, page, query, device, country and brand. Sitewide or one folder, overlaid on dated Google updates.', 'drop'],
  ['A worklist, not a dashboard', 'Ranked by expected clicks per effort, with evidence, steps, a done checkbox, a CSV and a printable monthly client report.', 'striking'],
  ['Your data stays yours', 'Parsed in the browser, stored in IndexedDB, works signed out. Optional account sync, export everything, delete everything.', 'lock'],
]

export function Landing() {
  const [site, setSite] = useState(SAMPLES[0].id)
  const a = useSampleAnalysis(site)
  const [picked, setPicked] = useState<QueryPoint | null>(null)
  useEffect(() => setPicked(null), [site])
  const glowing = a ? a.points.filter(p => p.gap >= 20 && !p.branded).sort((x, y) => y.gap - x.gap) : []
  const pick = picked ?? glowing[0] ?? null
  const c = a?.totals.cur
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <div className="eyebrow">For content marketers, SEO freelancers and small-site owners</div>
            <h1>You opened Search Console. <span className="accent">Now what?</span></h1>
            <p className="lede">Drop in your Search Console export and get a prioritised worklist: titles to rewrite, pages to consolidate, guides to refresh, and an honest answer to &ldquo;why did traffic drop?&rdquo;. Each item comes with its evidence and the clicks it should win back.</p>
            <div className="hero-ctas">
              <Link href={`/app?sample=${site}`} className="btn primary lg">Try the sample</Link>
              <Link href="/app" className="btn tonal lg">Import your export</Link>
            </div>
            <p className="hero-note">Free. No sign-up. Your export is processed in your browser. <Link href="/docs">How to export</Link></p>
          </div>
          <div className="console" aria-label="Live demo on a synthetic site">
            <div className="console-bar">
              <div className="seg-control sm" role="radiogroup" aria-label="Sample site">
                {SAMPLES.map(s => <button key={s.id} type="button" role="radio" aria-checked={site === s.id} className={site === s.id ? 'on' : ''} onClick={() => setSite(s.id)}>{s.name.split(' (')[0]}</button>)}
              </div>
              <span className="badge synthetic">Synthetic · last 28 days</span>
            </div>
            <div className="metric-tabs" aria-hidden={!c}>
              <div className="mt clicks"><small>Total clicks</small><b>{c ? fmtK(c.clicks) : '…'}</b></div>
              <div className="mt impressions"><small>Total impressions</small><b>{c ? fmtK(c.impressions) : '…'}</b></div>
              <div className="mt ctr"><small>Average CTR</small><b>{c ? fmtPct(c.ctr, 1) : '…'}</b></div>
              <div className="mt position"><small>Average position</small><b>{c ? fmtN(c.position, 1) : '…'}</b></div>
            </div>
            <div className="console-body">
              <div className="console-chart">
                {a ? <CtrScatter points={a.points} curve={a.curve} picked={pick?.query} onPick={setPicked} height={330} width={560} /> : <div className="chart-skel"><span className="spinner" /> Fitting the CTR curve</div>}
                <p className="tiny muted center" style={{ margin: '4px 0 0' }}>Each dot is a query. The line is the CTR this site normally earns at that position. <b>Glowing dots are below it: click one.</b></p>
              </div>
              <div className="console-side">{a && pick ? <FixCard point={pick} a={a} compact /> : <div className="chart-skel" />}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="eyebrow">The problem</div>
          <h2>Search Console tells you what happened. It never says what to do next.</h2>
          <p>The Performance report is a list of numbers. The work that moves traffic (rewriting the right titles, merging pages that compete, refreshing the guide that is slipping, ruling out a core update) means hours of filtering, pivot tables and guesswork.</p>
        </div>
        <div className="quotes">{QUOTES.map(([q, s]) => <figure className="quote" key={s}><blockquote>{q}</blockquote><figcaption className="src">Paraphrased from {s}</figcaption></figure>)}</div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="eyebrow">What you get</div>
          <h2>Five analyses, one ranked list of moves</h2>
        </div>
        <div className="features">{FEATURES.map(([t, d, k]) => <article className="feature" key={t}><span className={`f-icon ${k}`} aria-hidden="true" /><h3>{t}</h3><p>{d}</p></article>)}</div>
      </section>

      <section className="section">
        <div className="steps">
          <div className="step"><b>1</b><h3>Export</h3><p>Performance → Export → CSV or Excel. Optional: query + page rows from a 5-minute Apps Script, Looker Studio or BigQuery. <Link href="/docs">Exact steps</Link>.</p></div>
          <div className="step"><b>2</b><h3>Drop it in</h3><p>Tables are detected, columns mapped, and every bad row is listed with its line number before anything is imported.</p></div>
          <div className="step"><b>3</b><h3>Work the list</h3><p>Fix, tick done, save a monthly snapshot, and send the client a printable report showing what changed.</p></div>
        </div>
        <div className="cta-band">
          <h2>Find the clicks you are already ranking for.</h2>
          <div className="row gap wrap center-x"><Link href={`/app?sample=${site}`} className="btn primary lg">Open the sample site</Link><Link href="/docs" className="btn tonal lg">Read the method</Link></div>
        </div>
      </section>
    </>
  )
}
