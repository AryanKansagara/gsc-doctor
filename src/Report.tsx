import { useEffect, useMemo } from 'react'
import { brandMatcher, compareSnapshots, dailyTotals, diagnose, KIND_LABEL, shortUrl } from './engine/analyze.ts'
import { UPDATES } from './engine/updates.ts'
import { CtrScatter, Timeline } from './charts.tsx'
import { useAnalysis, useProject, winFromUrl, winOptions } from './projectData.ts'
import { worklistCsv } from './Tabs.tsx'
import { download, fmtK, fmtN, fmtPct, Link, signed, SyntheticBadge } from './ui.tsx'

export default function Report({ id }: { id: string }) {
  const { loading, project, ds } = useProject(id)
  const opts = useMemo(() => winOptions(ds), [ds])
  const win = winFromUrl(opts)
  const a = useAnalysis(ds, project, win)
  useEffect(() => { if (project && a) document.title = `SEO report · ${project.name} · ${a.win.label}` }, [project?.name, a?.win.label])
  const d = useMemo(() => a && ds && project ? diagnose(ds, a.win, a.curve, project.settings, brandMatcher(project.settings.brandTerms)) : null, [a, ds, project])
  const daily = useMemo(() => ds ? dailyTotals(ds).slice(-120) : [], [ds])

  if (loading) return <div className="boot"><span className="spinner" /> Building the report</div>
  if (!project || !a || !d) return <section className="page narrow center"><h1>Nothing to report</h1><p className="muted">Import data for this site first.</p><Link href="/app" className="btn primary">All sites</Link></section>
  const c = a.totals.cur, p = a.totals.prev
  const open = a.actions.filter(x => !project.done?.includes(x.id))
  const doneNow = a.actions.filter(x => project.done?.includes(x.id))
  const snaps = project.snapshots
  const cmp = snaps.length > 1 ? compareSnapshots(snaps[snaps.length - 2], snaps[snaps.length - 1]) : null
  const ch = (x: number, y?: number) => y ? ` (${signed((x / y - 1) * 100, n => n.toFixed(1) + '%')})` : ''
  const b = a.brand
  const summary = [
    `${fmtN(c.clicks)} clicks and ${fmtK(c.impressions)} impressions a month from Google Search${p ? `, ${c.clicks >= p.clicks ? 'up' : 'down'} ${fmtPct(Math.abs(c.clicks / p.clicks - 1), 1)} on the previous period` : ''}. Average CTR ${fmtPct(c.ctr, 1)}, average position ${fmtN(c.position, 1)}.`,
    project.settings.brandTerms.length ? `${fmtPct(b.brand.cur.clicks / Math.max(1, b.brand.cur.clicks + b.nonBrand.cur.clicks))} of clicks come from people searching for the brand; non-branded clicks ${b.nonBrand.prev.clicks ? `${b.nonBrand.cur.clicks >= b.nonBrand.prev.clicks ? 'grew' : 'fell'} ${fmtPct(Math.abs(b.nonBrand.cur.clicks / b.nonBrand.prev.clicks - 1), 1)}` : `were ${fmtN(b.nonBrand.cur.clicks)}`}.` : '',
    d.scope !== 'none' ? d.scopeText + (d.updates.length ? ` Timing overlaps the ${d.updates.map(u => u.name).join(' and ')}.` : '') : '',
    open.length ? `${open.length} recommended actions are worth about ${fmtN(open.reduce((s, x) => s + x.gain, 0))} extra clicks a month; the top three are below.` : 'No open actions this month.',
  ].filter(Boolean)

  return (
    <article className="report">
      <div className="report-actions">
        <Link href={`/app/p/${id}${location.search}`} className="btn ghost">Back to the site</Link>
        <button type="button" className="btn outline" onClick={() => download(`seo-worklist-${a.win.key}.csv`, worklistCsv(a.actions, project.done))}>Worklist CSV</button>
        <button type="button" className="btn primary" onClick={() => print()}>Print or save as PDF</button>
      </div>
      <div className="eyebrow">Monthly SEO report</div>
      <h1>{project.name}, {a.win.label} {project.sampleId && <SyntheticBadge />}</h1>
      <p className="muted">{a.win.cur ? `${a.win.cur[0]} to ${a.win.cur[1]}, compared with ${a.win.prev![0]} to ${a.win.prev![1]}` : 'Imported export period'} · Google Search, web results · prepared {new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}</p>
      <div className="kpis gsc">
        <div className="kpi clicks"><small>Clicks / month</small><b>{fmtK(c.clicks)}</b><span className="small">{p ? ch(c.clicks, p.clicks) : ''}</span></div>
        <div className="kpi impressions"><small>Impressions / month</small><b>{fmtK(c.impressions)}</b><span className="small">{p ? ch(c.impressions, p.impressions) : ''}</span></div>
        <div className="kpi ctr"><small>CTR</small><b>{fmtPct(c.ctr, 1)}</b></div>
        <div className="kpi position"><small>Position</small><b>{fmtN(c.position, 1)}</b></div>
      </div>
      <h2>Summary</h2>
      <ol>{summary.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {daily.length > 1 && <><h2>Clicks, last 120 days</h2><Timeline daily={daily} updates={UPDATES} height={170} /></>}
      <h2>Next actions</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>#</th><th>Action</th><th>Why</th><th className="num">Clicks / mo</th></tr></thead>
        <tbody>{open.slice(0, 8).map((x, i) => <tr key={x.id}><td>{i + 1}</td><td><span className={`kind-chip ${x.kind}`}>{KIND_LABEL[x.kind]}</span><div className="strong small break" style={{ marginTop: 4 }}>{x.title}</div></td><td className="small">{x.evidence[0]}</td><td className="num">+{fmtN(x.gain)}</td></tr>)}</tbody>
      </table></div>
      {doneNow.length > 0 && <><h2>Done this period</h2><ul>{doneNow.map(x => <li key={x.id}>{x.title}</li>)}</ul></>}
      {a.redirects.length > 0 && <><h2>Redirect plan</h2><div className="table-wrap"><table><thead><tr><th>From</th><th>To</th><th>Action</th></tr></thead><tbody>{a.redirects.map(r => <tr key={r.from}><td className="break">{shortUrl(r.from)}</td><td className="break">{shortUrl(r.to)}</td><td>{r.action === '301' ? '301 redirect' : 'canonical + internal links'}</td></tr>)}</tbody></table></div></>}
      <h2>Position vs CTR</h2>
      <p className="small muted">Each dot is a query (size = impressions). The line is the CTR this site normally earns at each position; dots well below it are title and snippet opportunities.</p>
      <CtrScatter points={a.points} curve={a.curve} height={300} />
      {cmp && <><h2>Since last snapshot ({snaps[snaps.length - 2].label} → {snaps[snaps.length - 1].label})</h2>
        <ul>
          <li>Clicks per month {signed(cmp.clicks, n => fmtN(n))} ({fmtPct(cmp.clicksRel, 1)})</li>
          <li>{cmp.resolved.length} actions resolved, {cmp.added.length} new, {cmp.open.length} still open</li>
        </ul>
      </>}
      <h2>Top pages</h2>
      <div className="table-wrap"><table><thead><tr><th>Page</th><th className="num">Clicks / mo</th><th className="num">Change</th><th className="num">Position</th></tr></thead>
        <tbody>{a.pages.slice(0, 10).map(pg => <tr key={pg.page}><td className="break">{shortUrl(pg.page)}</td><td className="num">{fmtN(pg.clicks)}</td><td className="num">{pg.prevClicks ? signed(pg.clicks - pg.prevClicks, n => fmtN(n)) : '—'}</td><td className="num">{fmtN(pg.position, 1)}</td></tr>)}</tbody></table></div>
      <p className="muted small" style={{ marginTop: 28 }}>Method: monthly figures are scaled from the selected range. Expected gains use this site&rsquo;s own CTR-by-position curve (isotonic fit, brand queries excluded). Google update dates from the Google Search Status Dashboard. Details at {location.host}/docs.{project.sampleId ? ' This site is synthetic.' : ''}</p>
    </article>
  )
}
