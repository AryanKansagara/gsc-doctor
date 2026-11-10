import { useMemo, useState } from 'react'
import {
  brandMatcher, checkTitle, compareSnapshots, dailyTotals, diagnose, dropWindow, expectedCtr, KIND_LABEL, redirectCsv, shortUrl, suggestTitle,
  type Action, type ActionKind, type Analysis, type DropRow, type QueryPoint,
} from './engine/analyze.ts'
import { toCsv } from './engine/parse.ts'
import { UPDATES, UPDATES_CHECKED } from './engine/updates.ts'
import { CtrScatter, FixCard, PartsBar, PartsLegend, Spark, Timeline } from './charts.tsx'
import type { Tab, TabProps } from './Project.tsx'
import { deleteSnapshotCloud } from './sync.ts'
import type { Project } from './store.ts'
import { ask, CopyButton, download, Empty, fmtDate, fmtK, fmtN, fmtPct, Link, signed, toast } from './ui.tsx'

export default function Tabs(p: TabProps & { tab: Tab }) {
  switch (p.tab) {
    case 'worklist': return <Worklist {...p} />
    case 'cannibal': return <Cannibal {...p} />
    case 'decay': return <DecayTab {...p} />
    case 'drops': return <Drops {...p} />
    case 'queries': return <Queries {...p} />
    case 'history': return <History {...p} />
    default: return <Overview {...p} />
  }
}

const delta = (cur: number, prev: number | undefined, f: (n: number) => string, lowerIsBetter = false) => {
  if (prev === undefined || !Number.isFinite(prev) || !Number.isFinite(cur)) return null
  const d = cur - prev
  const good = lowerIsBetter ? d < 0 : d > 0
  return <span className={`delta ${Math.abs(d) < 1e-9 ? '' : good ? 'up' : 'down'}`}>{signed(d, f)}</span>
}

const slug = (s: string) => s.replace(/\W+/g, '-').toLowerCase().replace(/^-|-$/g, '')

// ---------- Overview ----------

function Kpis({ a }: { a: Analysis }) {
  const c = a.totals.cur, p = a.totals.prev ?? undefined
  return (
    <div className="kpis gsc">
      <div className="kpi clicks"><small>Clicks / month</small><b>{fmtK(c.clicks)}</b>{delta(c.clicks, p?.clicks, n => fmtK(n))}</div>
      <div className="kpi impressions"><small>Impressions / month</small><b>{fmtK(c.impressions)}</b>{delta(c.impressions, p?.impressions, n => fmtK(n))}</div>
      <div className="kpi ctr"><small>Average CTR</small><b>{fmtPct(c.ctr, 1)}</b>{delta(c.ctr, p?.ctr, n => fmtPct(n, 2))}</div>
      <div className="kpi position"><small>Average position</small><b>{fmtN(c.position, 1)}</b>{delta(c.position, p?.position, n => fmtN(n, 1), true)}</div>
    </div>
  )
}

function Overview({ project, ds, a, win }: TabProps) {
  const daily = useMemo(() => dailyTotals(ds), [ds])
  const glowing = a.points.filter(p => p.gap >= 20 && !p.branded).sort((x, y) => y.gap - x.gap)
  const [picked, setPicked] = useState<QueryPoint | null>(null)
  const pick = picked ?? glowing[0] ?? null
  const b = a.brand
  const bShare = (x: { clicks: number }, y: { clicks: number }) => x.clicks + y.clicks ? x.clicks / (x.clicks + y.clicks) : 0
  const q = win ? `?w=${win}` : ''
  return (
    <>
      {project.sampleId && <div className="banner"><span><strong>Synthetic site.</strong> Generated rows with known problems, so you can see what each section finds. <Link href={`/app/p/${project.id}/data`}>Import your own export</Link> to start a real site.</span></div>}
      <Kpis a={a} />
      {!a.has.queryPage && <div className="banner warn"><span><strong>No query + page rows yet.</strong> The Performance export has queries and pages in separate tables, so cannibalisation and per-page CTR fixes are limited. <Link href="/docs#query-page">Get query + page rows</Link> (free, about 5 minutes).</span></div>}
      {daily.length > 1 && <div className="panel">
        <div className="panel-head"><h2>Clicks over time</h2><span className="muted small">7-day average · Google updates checked {UPDATES_CHECKED}</span></div>
        <Timeline daily={daily} updates={UPDATES} bands={a.win.cur ? [{ from: a.win.cur[0], to: a.win.cur[1], label: 'current' }] : []} />
      </div>}
      <div className="grid-scatter">
        <div className="panel">
          <div className="panel-head"><h2>Position vs CTR</h2><span className="muted small">Curve fitted from this site ({a.curve.kind === 'isotonic' ? 'isotonic' : a.curve.kind === 'log' ? 'log fit, sparse data' : 'industry prior, too little data'}). Glowing points are under it.</span></div>
          <CtrScatter points={a.points} curve={a.curve} picked={pick?.query} onPick={setPicked} />
        </div>
        <div className="panel">
          {pick ? <FixCard point={pick} a={a} /> : <Empty title="Nothing glows">Every query with real impressions gets the CTR this site normally gets at its position.</Empty>}
          {glowing.length > 1 && <div className="stack-sm" style={{ marginTop: 14 }}>
            <div className="muted tiny">Biggest gaps</div>
            {glowing.slice(0, 5).map(g => <button type="button" key={g.query} className={`gap-row${pick?.query === g.query ? ' on' : ''}`} onClick={() => setPicked(g)}><span className="break">{g.query}</span><b>+{fmtN(g.gap)}</b></button>)}
          </div>}
        </div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Top actions</h2><Link href={`/app/p/${project.id}/worklist${q}`} className="small">Full worklist ({a.actions.length})</Link></div>
          {a.actions.length ? <ol className="action-mini">{a.actions.filter(x => !project.done?.includes(x.id)).slice(0, 6).map(x => <li key={x.id}><span className={`kind-dot ${x.kind}`} aria-hidden="true" /><span className="grow break">{x.title}</span><b className="tab-nums">+{fmtN(x.gain)}</b></li>)}</ol> : <p className="muted">No actions cleared the thresholds. Lower the minimum impressions on Data &amp; settings.</p>}
          <p className="muted tiny">Expected clicks per month if the fix works. Ranked by gain divided by effort.</p>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Branded vs non-branded</h2>{!project.settings.brandTerms.length && <Link href={`/app/p/${project.id}/data`} className="small">Add brand terms</Link>}</div>
          {project.settings.brandTerms.length ? <>
            <div className="split-bar" aria-hidden="true"><span style={{ width: `${bShare(b.brand.cur, b.nonBrand.cur) * 100}%` }} /></div>
            <table><thead><tr><th /><th className="num">Clicks</th><th className="num">Previous</th><th className="num">Change</th></tr></thead><tbody>
              {([['Branded', b.brand], ['Non-branded', b.nonBrand]] as const).map(([l, r]) => <tr key={l}><th scope="row">{l}</th><td className="num">{fmtN(r.cur.clicks)}</td><td className="num">{fmtN(r.prev.clicks)}</td><td className="num">{r.prev.clicks ? delta(r.cur.clicks / r.prev.clicks - 1, 0, n => fmtPct(n, 0)) : '—'}</td></tr>)}
            </tbody></table>
            <p className="muted tiny">Terms: {project.settings.brandTerms.join(', ')}. Brand queries are left out of the CTR curve; they always over-perform.</p>
          </> : <p className="muted small">Add your brand names (and misspellings) to split traffic people would find anyway from traffic you earned.</p>}
        </div>
      </div>
    </>
  )
}

// ---------- Worklist ----------

export function TitleHelper({ project, page, query, update }: { project: Project; page: string; query: string; update(p: Partial<Project>): void }) {
  const saved = project.titles?.[page]
  const [title, setTitle] = useState(saved?.title ?? '')
  const [meta, setMeta] = useState(saved?.meta ?? '')
  const checks = checkTitle(title, query, meta)
  const brand = project.settings.brandTerms[0] ? project.settings.brandTerms[0].replace(/\b\w/g, c => c.toUpperCase()) : ''
  const sug = suggestTitle(title || query, query, brand)
  const persist = () => update({ titles: { ...project.titles, [page]: { title, meta } } })
  return (
    <div className="title-helper">
      <label className="field"><span>Current title of {shortUrl(page)}</span><input value={title} onChange={e => setTitle(e.target.value)} onBlur={persist} placeholder="Paste the <title> from the page" /></label>
      <label className="field"><span>Meta description (optional)</span><textarea rows={2} value={meta} onChange={e => setMeta(e.target.value)} onBlur={persist} /></label>
      <ul className="checks">{checks.map((c, i) => <li key={i} className={c.level}>{c.message}</li>)}</ul>
      <div className="suggest"><div className="muted tiny">Suggested title, query first</div><div className="row gap-sm between"><code className="break">{sug}</code><CopyButton text={sug} /></div></div>
      <div className="serp" aria-label="Search result preview">
        <div className="serp-url">{page.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/').join(' › ')}</div>
        <div className="serp-title">{sug}</div>
        <div className="serp-desc">{meta || 'Write a description that answers the query and gives a reason to click.'}</div>
      </div>
    </div>
  )
}

const EFFORT = ['', 'Low effort', 'Medium effort', 'High effort']

function ActionCard({ x, project, update, rank }: { x: Action; project: Project; update(p: Partial<Project>): void; rank: number }) {
  const [open, setOpen] = useState(rank < 2)
  const done = !!project.done?.includes(x.id)
  const toggle = () => {
    const prev = project.done ?? []
    void update({ done: done ? prev.filter(d => d !== x.id) : [...prev, x.id] })
    if (!done) toast('Marked done', { tone: 'ok', undo: () => void update({ done: prev }) })
  }
  return (
    <article className={`action${done ? ' done' : ''}`}>
      <div className="action-head">
        <span className="action-rank">{rank + 1}</span>
        <div className="grow">
          <div className="row gap-sm wrap"><span className={`kind-chip ${x.kind}`}>{KIND_LABEL[x.kind]}</span><span className="muted tiny">{EFFORT[x.effort]}</span></div>
          <h3 className="break">{x.title}</h3>
        </div>
        <div className="action-gain"><b>+{fmtN(x.gain)}</b><small>clicks / month</small></div>
      </div>
      <div className="row gap-sm">
        <button type="button" className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide details' : 'Evidence and steps'}</button>
        <label className="row gap-sm small"><input type="checkbox" checked={done} onChange={toggle} /> Done</label>
      </div>
      {open && <div className="action-body">
        <div>
          <h4>Evidence</h4>
          <ul className="small">{x.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
          <h4>Steps</h4>
          <ol className="small">{x.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
        {(x.kind === 'ctr' || x.kind === 'striking') && /^https?:/.test(x.target) && <TitleHelper project={project} page={x.target} query={x.queries[0]} update={update} />}
      </div>}
    </article>
  )
}

export const worklistCsv = (actions: Action[], done: string[] = []) => toCsv([['rank', 'type', 'action', 'target', 'expected_clicks_per_month', 'effort', 'queries', 'evidence', 'done'],
  ...actions.map((x, i) => [i + 1, KIND_LABEL[x.kind], x.title, x.target, Math.round(x.gain), x.effort, x.queries.join('; '), x.evidence.join(' | '), done.includes(x.id) ? 'yes' : ''])])

function Worklist({ project, a, update }: TabProps) {
  const [kind, setKind] = useState<ActionKind | 'all'>('all')
  const [showDone, setShowDone] = useState(false)
  const list = a.actions.filter(x => (kind === 'all' || x.kind === kind) && (showDone || !project.done?.includes(x.id)))
  const total = list.reduce((s, x) => s + x.gain, 0)
  const counts = (k: ActionKind) => a.actions.filter(x => x.kind === k).length
  return (
    <>
      <div className="panel">
        <div className="row between wrap gap">
          <div className="seg-control" role="radiogroup" aria-label="Action type">
            <button type="button" role="radio" aria-checked={kind === 'all'} className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>All {a.actions.length}</button>
            {(Object.keys(KIND_LABEL) as ActionKind[]).map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KIND_LABEL[k]} {counts(k)}</button>)}
          </div>
          <div className="row gap-sm wrap">
            <label className="row gap-sm small"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show done ({project.done?.length ?? 0})</label>
            <button type="button" className="btn outline sm" onClick={() => download(`${slug(project.name)}-worklist.csv`, worklistCsv(a.actions, project.done))}>Worklist CSV</button>
            {a.redirects.length > 0 && <button type="button" className="btn outline sm" onClick={() => download(`${slug(project.name)}-redirect-map.csv`, redirectCsv(a.redirects))}>Redirect map CSV</button>}
          </div>
        </div>
        <p className="muted small" style={{ margin: '12px 0 0' }}>{list.length} actions worth about <b>{fmtN(total)}</b> clicks a month if they work. Gains assume this site&rsquo;s own CTR curve; consolidation assumes the merged page ranks where the best one does.</p>
      </div>
      {list.length ? list.map((x, i) => <ActionCard key={x.id} x={x} rank={i} project={project} update={update} />) : <div className="panel"><Empty title="All clear">Nothing left in this list. Lower the minimum impressions, or compare another month.</Empty></div>}
    </>
  )
}

// ---------- Cannibalisation ----------

function Cannibal({ project, a }: TabProps) {
  if (!a.has.queryPage) return <div className="panel"><Empty title="Needs query + page rows">Cannibalisation means several of your pages ranking for the same query. The Performance export never pairs queries with pages, so pull query + page rows (API, Sheets add-on, Looker Studio or BigQuery). <p><Link href="/docs#query-page" className="btn primary">Show me how</Link></p></Empty></div>
  if (!a.clusters.length) return <div className="panel"><Empty title="No cannibalisation found">No non-branded query has two or more pages each taking 10%+ of its impressions with an unstable leader.</Empty></div>
  const htaccess = a.redirects.filter(r => r.action === '301').map(r => `Redirect 301 ${shortUrl(r.from)} ${r.to}`).join('\n')
  const nginx = a.redirects.filter(r => r.action === '301').map(r => `location = ${shortUrl(r.from)} { return 301 ${r.to}; }`).join('\n')
  return (
    <>
      <div className="panel tint">
        <p className="small" style={{ margin: 0 }}>Score = 60% how evenly impressions split between pages + 40% how often the leading page changed week to week (last 12 weeks). The canonical is the page with the most clicks on the contested queries.</p>
      </div>
      {a.clusters.map(cl => (
        <div className="panel" key={cl.canonical}>
          <div className="panel-head"><h2 className="break">Keep {shortUrl(cl.canonical)}</h2><span className="gain"><b>+{fmtN(cl.gain)}</b> clicks / month</span></div>
          {cl.items.map(c => (
            <div key={c.query} className="cann">
              <div className="row between wrap gap-sm"><h3 className="break">&ldquo;{c.query}&rdquo;</h3><span className="row gap-sm"><span className={`score s${Math.min(9, Math.floor(c.score / 10))}`}>{c.score}</span><span className="muted small">{fmtN(c.impressions)} impr. / mo · leader changed {fmtPct(c.flipRate)} of {c.weeks} weeks</span></span></div>
              <div className="share-bar" aria-hidden="true">{c.pages.map((p, i) => <span key={p.page} className={`s${i}`} style={{ width: `${p.share * 100}%` }} title={`${shortUrl(p.page)} ${fmtPct(p.share)}`} />)}</div>
              <div className="table-wrap"><table>
                <thead><tr><th>Page</th><th className="num">Impr. share</th><th className="num">Clicks / mo</th><th className="num">Position</th><th className="num">Weeks leading</th></tr></thead>
                <tbody>{c.pages.map((p, i) => <tr key={p.page}><th scope="row" className="break"><i className={`sw s${i}`} />{shortUrl(p.page)}{p.page === cl.canonical && <span className="badge good">canonical</span>}</th><td className="num">{fmtPct(p.share)}</td><td className="num">{fmtN(p.clicks)}</td><td className="num">{fmtN(p.position, 1)}</td><td className="num">{p.topWeeks}</td></tr>)}</tbody>
              </table></div>
            </div>
          ))}
        </div>
      ))}
      <div className="panel">
        <div className="panel-head"><h2>Redirect and canonical plan</h2><button type="button" className="btn primary sm" onClick={() => download(`${slug(project.name)}-redirect-map.csv`, redirectCsv(a.redirects))}>Download CSV</button></div>
        <div className="table-wrap"><table>
          <thead><tr><th>From</th><th>To</th><th>Action</th><th>Why</th></tr></thead>
          <tbody>{a.redirects.map(r => <tr key={r.from}><th scope="row" className="break">{shortUrl(r.from)}</th><td className="break">{shortUrl(r.to)}</td><td><span className={`badge ${r.action === '301' ? 'bad' : ''}`}>{r.action === '301' ? '301 redirect' : 'canonical + links'}</span></td><td className="small">{r.reason}</td></tr>)}</tbody>
        </table></div>
        {htaccess && <div className="grid-2" style={{ marginTop: 12 }}>
          <div><div className="code"><div className="code-head"><span>.htaccess (Apache)</span><CopyButton text={htaccess} /></div><pre><code>{htaccess}</code></pre></div></div>
          <div><div className="code"><div className="code-head"><span>nginx</span><CopyButton text={nginx} /></div><pre><code>{nginx}</code></pre></div></div>
        </div>}
        <p className="muted tiny">Merge the content first, then redirect. Keep redirects in place for at least a year.</p>
      </div>
    </>
  )
}

// ---------- Decay ----------

function DecayTab({ a }: TabProps) {
  if (!a.has.dated) return <div className="panel"><Empty title="Needs dated page rows">Decay needs clicks per page per month. Import dated rows (API, Sheets, Looker Studio or BigQuery) with a date and page column. <p><Link href="/docs#query-page" className="btn primary">How to export</Link></p></Empty></div>
  if (!a.decay.length) return <div className="panel"><Empty title="No decaying pages">No page lost 25%+ of its baseline clicks over the lookback window on a robust (Theil–Sen) trend.</Empty></div>
  return (
    <>
      <div className="panel tint"><p className="small" style={{ margin: 0 }}>Monthly clicks per page; trend = Theil–Sen slope (median of all pairwise slopes, so one odd month cannot fake a decline). Flagged when the trend loses 25%+ of the first-half baseline. Expected gain assumes a refresh wins back half the loss.</p></div>
      {a.decay.map(d => (
        <div className="panel" key={d.page}>
          <div className="panel-head"><h2 className="break">{shortUrl(d.page)}</h2><span className="gain"><b>+{fmtN(d.gain)}</b> clicks / month</span></div>
          <div className="decay-row">
            <div className="decay-chart">
              <Spark values={d.series} w={260} h={64} />
              <div className="row between tiny muted"><span>{d.months[0]}</span><span>{d.months[d.months.length - 1]}</span></div>
            </div>
            <dl className="mini-stats three">
              <div><dt>Baseline</dt><dd>{fmtN(d.baseline)}</dd></div>
              <div><dt>Last month</dt><dd>{fmtN(d.last)}</dd></div>
              <div><dt>Trend</dt><dd className="down">{fmtPct(d.change)}</dd></div>
            </dl>
            <span className={`badge ${d.pattern === 'step' ? 'bad' : ''}`}>{d.pattern === 'step' ? 'Sudden step: check updates and site changes' : 'Steady slide: competitors are fresher'}</span>
          </div>
          {d.lost.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>Query lost</th><th className="num">Clicks / mo before</th><th className="num">Last month</th><th className="num">Position before</th><th className="num">Now</th></tr></thead>
            <tbody>{d.lost.map(l => <tr key={l.query}><th scope="row" className="break">{l.query}</th><td className="num">{fmtN(l.before)}</td><td className="num">{fmtN(l.after)}</td><td className="num">{fmtN(l.posBefore, 1)}</td><td className="num">{Number.isFinite(l.posAfter) ? fmtN(l.posAfter, 1) : 'gone'}</td></tr>)}</tbody>
          </table></div>}
        </div>
      ))}
    </>
  )
}

// ---------- Drops ----------

const CAUSE: Record<DropRow['cause'], string> = { demand: 'Demand', rank: 'Rank', ctr: 'CTR' }
const DIM_LABEL: Record<string, string> = { group: 'Page groups', page: 'Pages', query: 'Queries', device: 'Devices', country: 'Countries', brand: 'Branded vs non-branded' }

function Drops({ project, ds, a }: TabProps) {
  const auto = useMemo(() => dropWindow(ds), [ds])
  const [mode, setMode] = useState<'auto' | 'window'>(auto ? 'auto' : 'window')
  const w = mode === 'auto' && auto ? auto : a.win
  const isBrand = useMemo(() => brandMatcher(project.settings.brandTerms), [project.settings.brandTerms])
  const d = useMemo(() => diagnose(ds, w, a.curve, project.settings, isBrand), [ds, w, a.curve, project.settings, isBrand])
  const daily = useMemo(() => dailyTotals(ds), [ds])
  const [dim, setDim] = useState<string>('group')
  const rows = d.by[dim as keyof typeof d.by] ?? []
  const scale = Math.max(1, ...rows.slice(0, 12).map(r => Math.max(Math.abs(r.demand) + Math.abs(r.rank) + Math.abs(r.ctr), 1)))
  if (!d.window.cur && !d.total.prev.clicks) return <div className="panel"><Empty title="Needs two periods">Import dated rows, or a Performance export in Compare mode, to diagnose a drop. <p><Link href="/docs#compare" className="btn primary">How</Link></p></Empty></div>
  return (
    <>
      <div className="panel">
        <div className="row between wrap gap">
          <div className="seg-control" role="radiogroup" aria-label="Comparison">
            {auto && <button type="button" role="radio" aria-checked={mode === 'auto'} className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')}>Around the detected drop</button>}
            <button type="button" role="radio" aria-checked={mode === 'window'} className={mode === 'window' ? 'on' : ''} onClick={() => setMode('window')}>{a.win.label} vs previous</button>
          </div>
          {d.window.cur && <span className="muted small">Before {d.window.prev![0]} to {d.window.prev![1]} · after {d.window.cur[0]} to {d.window.cur[1]}</span>}
        </div>
        <div className={`verdict ${d.scope}`}>
          <b>{d.scope === 'cluster' ? 'Page cluster' : d.scope === 'sitewide' ? 'Sitewide' : d.scope === 'mixed' ? 'Mixed' : 'No drop'}</b>
          <span>{d.scopeText}</span>
        </div>
        {d.changePoint && <p className="small">Biggest step down starts <b>{fmtDate(d.changePoint.date)}</b>: 14-day average {fmtN(d.changePoint.before)} → {fmtN(d.changePoint.after)} clicks a day ({fmtPct(d.changePoint.rel)}).{' '}
          {d.updates.length ? <>Overlaps <b>{d.updates.map(u => u.name).join(', ')}</b>.</> : 'No Google ranking update was rolling out then: look at your own changes first (deploys, robots.txt, noindex, migrations, tracking).'}</p>}
        {daily.length > 1 && <Timeline daily={daily} updates={UPDATES} bands={d.window.cur ? [{ from: d.window.prev![0], to: d.window.prev![1], label: 'before' }, { from: d.window.cur[0], to: d.window.cur[1], label: 'after' }] : []} height={170} />}
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Where the clicks went</h2><span className="muted small">{fmtN(d.total.prev.clicks)} → {fmtN(d.total.cur.clicks)} clicks ({fmtPct(d.rel, 1)})</span></div>
        <div className="parts-total">
          {(['demand', 'rank', 'ctr'] as const).map(k => <div key={k} className={`kpi ${k}`}><small>{k === 'demand' ? 'Fewer impressions (demand, visibility)' : k === 'rank' ? 'Lower positions (rank)' : 'Lower CTR at the same rank'}</small><b>{signed(d.total[k], n => fmtN(n))}</b></div>)}
        </div>
        <p className="muted tiny">The three parts add up exactly to the change. Rank is the CTR change this site&rsquo;s curve predicts from the position move; CTR is the rest (titles, rich results, AI answers, SERP features). Falling off page one also cuts impressions, so a rank problem often shows up under demand too.</p>
        <div className="seg-control" role="radiogroup" aria-label="Split by">
          {Object.keys(d.by).map(k => <button key={k} type="button" role="radio" aria-checked={dim === k} className={dim === k ? 'on' : ''} onClick={() => setDim(k)}>{DIM_LABEL[k]}</button>)}
        </div>
        <PartsLegend />
        <div className="table-wrap"><table>
          <thead><tr><th>{DIM_LABEL[dim]}</th><th className="num">Before</th><th className="num">After</th><th className="num">Change</th><th className="num">Position</th><th style={{ minWidth: 160 }}>Split</th><th>Main cause</th></tr></thead>
          <tbody>{rows.slice(0, 25).map(r => <tr key={r.key}><th scope="row" className="break">{dim === 'page' ? shortUrl(r.key) : r.key}</th><td className="num">{fmtN(r.prev.clicks)}</td><td className="num">{fmtN(r.cur.clicks)}</td><td className="num">{delta(r.cur.clicks, r.prev.clicks, n => fmtN(n))}</td><td className="num small">{fmtN(r.prev.position, 1)} → {fmtN(r.cur.position, 1)}</td><td><PartsBar demand={r.demand} rank={r.rank} ctr={r.ctr} scale={scale} /></td><td>{Math.abs(r.delta) >= 1 ? <span className={`cause ${r.cause}`}>{CAUSE[r.cause]}</span> : '—'}</td></tr>)}</tbody>
        </table></div>
        <p className="muted tiny">Query rows exclude anonymised queries, so they sum to less than the total. Search Console counts clicks; analytics tools count sessions and lose consented-out visitors, so the two never match exactly.</p>
      </div>
    </>
  )
}

// ---------- Queries & pages ----------

function Queries({ project, a }: TabProps) {
  const csv = () => toCsv([['query', 'top_page', 'clicks_per_month', 'impressions_per_month', 'ctr', 'expected_ctr', 'position', 'opportunity_clicks', 'branded'],
    ...a.points.sort((x, y) => y.gap - x.gap).map(p => [p.query, p.page ?? '', Math.round(p.clicks), Math.round(p.impressions), p.ctr.toFixed(4), p.expected.toFixed(4), p.position.toFixed(1), Math.round(p.gap), p.branded ? 'yes' : ''])])
  return (
    <>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Striking distance</h2><span className="muted small">Positions 8 to 20</span></div>
          {a.striking.length ? <div className="table-wrap"><table>
            <thead><tr><th>Query</th><th className="num">Impr. / mo</th><th className="num">Pos.</th><th className="num">If position 5</th></tr></thead>
            <tbody>{a.striking.slice(0, 20).map(s => <tr key={s.query}><th scope="row" className="break">{s.query}{s.page && <div className="muted tiny">{shortUrl(s.page)}</div>}</th><td className="num">{fmtN(s.impressions)}</td><td className="num">{fmtN(s.position, 1)}</td><td className="num good-text">+{fmtN(s.potential)}</td></tr>)}</tbody>
          </table></div> : <p className="muted">No non-branded queries between positions 8 and 20 with enough impressions.</p>}
        </div>
        <div className="panel">
          <div className="panel-head"><h2>CTR gaps</h2><span className="muted small">Top 7, CTR under 75% of expected</span></div>
          {a.gaps.length ? <div className="table-wrap"><table>
            <thead><tr><th>Query</th><th className="num">Pos.</th><th className="num">CTR</th><th className="num">Expected</th><th className="num">Gap / mo</th></tr></thead>
            <tbody>{a.gaps.slice(0, 20).map(s => <tr key={s.query}><th scope="row" className="break">{s.query}{s.page && <div className="muted tiny">{shortUrl(s.page)}</div>}</th><td className="num">{fmtN(s.position, 1)}</td><td className="num">{fmtPct(s.ctr, 1)}</td><td className="num">{fmtPct(s.expected, 1)}</td><td className="num good-text">+{fmtN(s.gap)}</td></tr>)}</tbody>
          </table></div> : <p className="muted">Every top-7 query gets at least 75% of the CTR this site normally gets at its position.</p>}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Expected CTR curve</h2><span className="muted small">{a.curve.kind === 'isotonic' ? 'Isotonic (never rises with position), weighted by √impressions, last 6 months, non-branded' : a.curve.kind === 'log' ? 'Log fit (too few positions for isotonic)' : 'Industry prior (too little data)'}</span></div>
        <div className="curve-table">{[1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map(p => <div key={p}><small>#{p}</small><b>{fmtPct(expectedCtr(a.curve, p), 1)}</b></div>)}</div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Page groups</h2><span className="muted small">By URL path, depth {project.settings.groupDepth}</span></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Group</th><th className="num">Pages</th><th className="num">Clicks / mo</th><th className="num">Change</th></tr></thead>
            <tbody>{a.groups.map(g => <tr key={g.group}><th scope="row">{g.group}</th><td className="num">{g.pages}</td><td className="num">{fmtN(g.clicks)}</td><td className="num">{g.prevClicks ? delta(g.clicks / g.prevClicks - 1, 0, n => fmtPct(n)) : '—'}</td></tr>)}</tbody>
          </table></div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Top pages</h2><button type="button" className="btn outline sm" onClick={() => download(`${slug(project.name)}-queries.csv`, csv())}>Queries CSV</button></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Page</th><th className="num">Clicks / mo</th><th className="num">Pos.</th><th className="num">Change</th></tr></thead>
            <tbody>{a.pages.slice(0, 15).map(p => <tr key={p.page}><th scope="row" className="break">{shortUrl(p.page)}</th><td className="num">{fmtN(p.clicks)}</td><td className="num">{fmtN(p.position, 1)}</td><td className="num">{delta(p.clicks, p.prevClicks, n => fmtN(n))}</td></tr>)}</tbody>
          </table></div>
        </div>
      </div>
    </>
  )
}

// ---------- History ----------

function History({ project, update }: TabProps) {
  const snaps = project.snapshots
  const [ai, setAi] = useState(Math.max(0, snaps.length - 2))
  const [bi, setBi] = useState(snaps.length - 1)
  if (snaps.length === 0) return <div className="panel"><Empty title="No snapshots yet">Press <kbd>S</kbd> or &ldquo;Save snapshot&rdquo; once a month. Each one keeps the totals, the worklist and top pages, so next month you can see what got fixed.</Empty></div>
  const A = snaps[Math.min(ai, snaps.length - 1)], B = snaps[Math.min(bi, snaps.length - 1)]
  const c = A && B && A.id !== B.id ? compareSnapshots(A, B) : null
  const remove = async (id: string) => {
    const s = snaps.find(x => x.id === id)!
    if (!(await ask(`Delete the ${s.label} snapshot?`, 'You can undo for a few seconds.', 'Delete'))) return
    void update({ snapshots: snaps.filter(x => x.id !== id) })
    void deleteSnapshotCloud(id)
    toast(`Deleted ${s.label}`, { undo: () => void update({ snapshots: snaps }) })
  }
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h2>Snapshots</h2><span className="muted small">{snaps.length} saved</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Month</th><th className="num">Clicks / mo</th><th className="num">Impr. / mo</th><th className="num">CTR</th><th className="num">Position</th><th className="num">Brand share</th><th className="num">Actions</th><th /></tr></thead>
          <tbody>{snaps.map(s => <tr key={s.id}><th scope="row">{s.label}</th><td className="num">{fmtN(s.totals.clicks)}</td><td className="num">{fmtK(s.totals.impressions)}</td><td className="num">{fmtPct(s.totals.ctr, 1)}</td><td className="num">{fmtN(s.totals.position, 1)}</td><td className="num">{fmtPct(s.brandShare)}</td><td className="num">{s.actions.length}</td><td><button type="button" className="btn danger-ghost sm" onClick={() => void remove(s.id)}>Delete</button></td></tr>)}</tbody>
        </table></div>
      </div>
      {snaps.length > 1 && <div className="panel">
        <div className="panel-head">
          <h2>Compare</h2>
          <div className="row gap-sm">
            <select aria-label="From snapshot" value={ai} onChange={e => setAi(+e.target.value)}>{snaps.map((s, i) => <option key={s.id} value={i}>{s.label}</option>)}</select>
            <span className="muted">→</span>
            <select aria-label="To snapshot" value={bi} onChange={e => setBi(+e.target.value)}>{snaps.map((s, i) => <option key={s.id} value={i}>{s.label}</option>)}</select>
          </div>
        </div>
        {c ? <>
          <div className="kpis gsc">
            <div className="kpi clicks"><small>Clicks / month</small><b>{signed(c.clicks, n => fmtN(n))}</b><span className={`delta ${c.clicks >= 0 ? 'up' : 'down'}`}>{fmtPct(c.clicksRel, 1)}</span></div>
            <div className="kpi impressions"><small>Impressions / month</small><b>{signed(c.impressions, n => fmtK(n))}</b></div>
            <div className="kpi ctr"><small>CTR</small><b>{signed(c.ctr * 100, n => n.toFixed(2) + ' pt')}</b></div>
            <div className="kpi position"><small>Position</small><b>{signed(c.position, n => fmtN(n, 1))}</b></div>
          </div>
          <div className="grid-3">
            <div><h3 className="small strong good-text">Resolved ({c.resolved.length})</h3><ul className="small plain">{c.resolved.slice(0, 10).map(x => <li key={x.id}>{x.title}</li>)}</ul></div>
            <div><h3 className="small strong">Still open ({c.open.length})</h3><ul className="small plain">{c.open.slice(0, 10).map(x => <li key={x.id}>{x.title}</li>)}</ul></div>
            <div><h3 className="small strong warn-text">New ({c.added.length})</h3><ul className="small plain">{c.added.slice(0, 10).map(x => <li key={x.id}>{x.title}</li>)}</ul></div>
          </div>
          <h3 className="small strong" style={{ marginTop: 16 }}>Biggest page moves</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Page</th><th className="num">{A.label}</th><th className="num">{B.label}</th><th className="num">Change</th></tr></thead>
            <tbody>{c.movers.map(m => <tr key={m.page}><th scope="row" className="break">{shortUrl(m.page)}</th><td className="num">{fmtN(m.before)}</td><td className="num">{fmtN(m.after)}</td><td className="num">{delta(m.after, m.before, n => fmtN(n))}</td></tr>)}</tbody>
          </table></div>
        </> : <p className="muted">Pick two different snapshots.</p>}
      </div>}
    </>
  )
}
