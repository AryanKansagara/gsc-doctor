import { useMemo, useState } from 'react'
import { expectedCtr, KIND_LABEL, shortUrl, type Analysis, type Curve, type QueryPoint } from './engine/analyze.ts'
import { updateEnd, type Update } from './engine/updates.ts'
import { fmtDate, fmtN, fmtPct } from './ui.tsx'

// ---------- Position vs CTR scatter with the site's expected curve ----------

const X_MAX = 40
const xs = (p: number, w: number) => 40 + (Math.log(Math.min(X_MAX, Math.max(1, p))) / Math.log(X_MAX)) * (w - 56)

export function CtrScatter({ points, curve, picked, onPick, height = 360, width = 640, glowMin = 20 }: { points: QueryPoint[]; curve: Curve; picked?: string | null; onPick?(q: QueryPoint): void; height?: number; width?: number; glowMin?: number }) {
  const W = width, H = height, top = 14, bottom = 34
  const yMax = useMemo(() => Math.min(0.6, Math.max(0.08, expectedCtr(curve, 1) * 1.25, ...points.filter(p => p.position <= X_MAX && !p.branded && p.impressions >= 30).map(p => p.ctr))) , [points, curve])
  const ys = (c: number) => top + (1 - Math.min(c, yMax) / yMax) * (H - top - bottom)
  const maxImp = Math.max(1, ...points.map(p => p.impressions))
  const path = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i <= 80; i++) { const p = Math.exp(Math.log(X_MAX) * i / 80); out.push(`${i ? 'L' : 'M'}${xs(p, W).toFixed(1)},${ys(expectedCtr(curve, p)).toFixed(1)}`) }
    return out.join('')
  }, [curve, W, H, yMax])
  const sorted = useMemo(() => [...points].filter(p => p.position <= X_MAX).sort((a, b) => b.impressions - a.impressions), [points])
  const yTicks = [0, yMax / 4, yMax / 2, yMax * 3 / 4, yMax]
  return (
    <svg className="scatter" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Average position against click-through rate for each query, with this site's expected CTR curve">
      <defs>
        <filter id="glow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="3.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <linearGradient id="under" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--c-clicks)" stopOpacity=".16" /><stop offset="1" stopColor="var(--c-clicks)" stopOpacity="0" /></linearGradient>
      </defs>
      {yTicks.map(t => <g key={t}><line x1={40} x2={W - 16} y1={ys(t)} y2={ys(t)} className="grid" /><text x={34} y={ys(t) + 4} className="tick" textAnchor="end">{fmtPct(t, t < 0.1 && t > 0 ? 1 : 0)}</text></g>)}
      {[1, 2, 3, 5, 10, 20, 40].map(p => <g key={p}><line x1={xs(p, W)} x2={xs(p, W)} y1={top} y2={H - bottom} className="grid v" /><text x={xs(p, W)} y={H - bottom + 16} className="tick" textAnchor="middle">{p}</text></g>)}
      <text x={W - 16} y={H - 4} className="axis" textAnchor="end">Average position (log scale)</text>
      <path d={`${path}L${xs(X_MAX, W)},${H - bottom}L${xs(1, W)},${H - bottom}Z`} fill="url(#under)" />
      <path d={path} className="curve" />
      {sorted.map(p => {
        const r = 3 + 13 * Math.sqrt(p.impressions / maxImp)
        const glow = p.gap >= glowMin && !p.branded
        const on = picked === p.query
        return (
          <circle key={p.query} cx={xs(p.position, W)} cy={ys(p.ctr)} r={r}
            className={`pt${glow ? ' glow' : ''}${p.branded ? ' brand' : ''}${on ? ' on' : ''}`}
            filter={glow ? 'url(#glow)' : undefined}
            tabIndex={glow && onPick ? 0 : -1} role={glow && onPick ? 'button' : undefined}
            aria-label={glow ? `${p.query}: position ${p.position.toFixed(1)}, CTR ${fmtPct(p.ctr, 1)}, expected ${fmtPct(p.expected, 1)}` : undefined}
            onClick={() => onPick?.(p)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(p) } }}>
            <title>{`${p.query}\nPosition ${p.position.toFixed(1)} · CTR ${fmtPct(p.ctr, 1)} (expected ${fmtPct(p.expected, 1)})\n${fmtN(p.impressions)} impressions / month`}</title>
          </circle>
        )
      })}
    </svg>
  )
}

// ---------- Daily clicks with Google update bands ----------

export function Timeline({ daily, updates, bands = [], height = 200, metric = 'clicks' }: { daily: { date: string; clicks: number; impressions: number }[]; updates: Update[]; bands?: { from: string; to: string; label: string }[]; height?: number; metric?: 'clicks' | 'impressions' }) {
  const [hover, setHover] = useState<number | null>(null)
  if (daily.length < 2) return <p className="muted small">Not enough dated rows for a timeline. Import the Dates table or dated rows.</p>
  const W = 900, H = height, top = 34, bottom = 22
  const t0 = Date.parse(daily[0].date), t1 = Date.parse(daily[daily.length - 1].date)
  const x = (d: string) => 6 + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - 12)
  // 7-day average keeps weekday swings from hiding the trend.
  const smooth = daily.map((_, i) => { const s = daily.slice(Math.max(0, i - 6), i + 1); return s.reduce((a, b) => a + b[metric], 0) / s.length })
  const max = Math.max(...smooth) * 1.1 || 1
  const y = (v: number) => top + (1 - v / max) * (H - top - bottom)
  const line = smooth.map((v, i) => `${i ? 'L' : 'M'}${x(daily[i].date).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const vis = updates.filter(u => updateEnd(u) >= daily[0].date && u.start <= daily[daily.length - 1].date).sort((a, b) => a.start.localeCompare(b.start))
  // Labels closer than ~80px drop to a second row so neighbouring updates stay readable.
  const rows: number[] = []
  let lastX = -1e9, lastRow = 1
  for (const u of vis) { const lx = x(u.start < daily[0].date ? daily[0].date : u.start); const r = lx - lastX < 80 && lastRow === 0 ? 1 : 0; rows.push(r); lastX = lx; lastRow = r }
  const months = daily.filter(d => d.date.endsWith('-01'))
  const h = hover !== null ? daily[hover] : null
  return (
    <div className="timeline">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily ${metric}, 7-day average, with Google ranking updates marked`}
        onMouseMove={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const fx = (e.clientX - r.left) / r.width * W; setHover(Math.max(0, Math.min(daily.length - 1, Math.round((fx - 6) / (W - 12) * (daily.length - 1))))) }}
        onMouseLeave={() => setHover(null)}>
        {bands.map(b => <rect key={b.label} x={x(b.from)} width={Math.max(2, x(b.to) - x(b.from))} y={top} height={H - top - bottom} className="band" />)}
        {vis.map((u, ui) => (
          <g key={u.name} className={`upd ${u.kind}`}>
            <rect x={x(u.start < daily[0].date ? daily[0].date : u.start)} width={Math.max(2, x(updateEnd(u) > daily[daily.length - 1].date ? daily[daily.length - 1].date : updateEnd(u)) - x(u.start < daily[0].date ? daily[0].date : u.start))} y={top} height={H - top - bottom} />
            <text x={x(u.start < daily[0].date ? daily[0].date : u.start) + 3} y={rows[ui] ? top - 5 : top - 19}>{u.name.replace(/ update$/, '').replace(/^(\w+) (\d{4}) /, (_, m: string, yr: string) => `${m.slice(0, 3)} \u2019${yr.slice(2)} `)}</text>
            <title>{`${u.name}: ${u.start} to ${updateEnd(u)}`}</title>
          </g>
        ))}
        {months.map(m => <g key={m.date}><line x1={x(m.date)} x2={x(m.date)} y1={H - bottom} y2={H - bottom + 4} className="grid" /><text x={x(m.date) + 2} y={H - 6} className="tick">{new Date(m.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</text></g>)}
        <path d={`${line}L${x(daily[daily.length - 1].date)},${H - bottom}L${x(daily[0].date)},${H - bottom}Z`} className={`area ${metric}`} />
        <path d={line} className={`line ${metric}`} />
        {h && <g><line x1={x(h.date)} x2={x(h.date)} y1={top} y2={H - bottom} className="cursor" /><circle cx={x(h.date)} cy={y(smooth[hover!])} r={4} className={`dot ${metric}`} /></g>}
      </svg>
      <div className="timeline-read" aria-live="polite">{h ? <><b>{fmtDate(h.date)}</b> · {fmtN(h.clicks)} clicks · {fmtN(h.impressions)} impressions · 7-day avg {fmtN(smooth[hover!])} {metric}</> : <span className="muted">Hover for daily numbers. Shaded: Google ranking updates (rollout dates from the Search Status Dashboard).</span>}</div>
    </div>
  )
}

// ---------- Small pieces ----------

export function Spark({ values, w = 120, h = 30, tone = 'clicks' }: { values: number[]; w?: number; h?: number; tone?: string }) {
  if (values.length < 2) return null
  const max = Math.max(...values) || 1
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 3 - v / max * (h - 6)).toFixed(1)}`).join('')
  return <svg className={`spark ${tone}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={d} /></svg>
}

/** Diverging bar of the three parts of a click change. */
export function PartsBar({ demand, rank, ctr, scale }: { demand: number; rank: number; ctr: number; scale: number }) {
  const segs = [['demand', demand], ['rank', rank], ['ctr', ctr]] as const
  const s = Math.max(1, scale)
  let neg = 0, pos = 0
  return (
    <div className="parts" aria-label={`Demand ${Math.round(demand)}, rank ${Math.round(rank)}, CTR ${Math.round(ctr)} clicks`}>
      <div className="parts-axis" />
      {segs.map(([k, v]) => {
        const w = Math.abs(v) / s * 50
        const left = v < 0 ? 50 - (neg += w) : 50 + (pos += w) - w
        return <span key={k} className={`seg ${k}`} style={{ left: `${left}%`, width: `${w}%` }} title={`${k}: ${Math.round(v)} clicks`} />
      })}
    </div>
  )
}

export const PartsLegend = () => (
  <div className="legend small"><span><i className="seg demand" />Demand (impressions)</span><span><i className="seg rank" />Rank (position moved)</span><span><i className="seg ctr" />CTR (snippet, SERP features)</span></div>
)

export function FixCard({ point, a, compact }: { point: QueryPoint; a: Analysis; compact?: boolean }) {
  const action = a.actions.find(x => x.queries.includes(point.query))
  return (
    <div className="fixcard">
      <div className="muted tiny">Query</div>
      <h3 className="break">{point.query}</h3>
      {point.page && <div className="muted small break">{shortUrl(point.page)}{point.pages > 1 ? ` · ${point.pages} pages rank` : ''}</div>}
      <dl className="mini-stats three">
        <div><dt>Position</dt><dd>{fmtN(point.position, 1)}</dd></div>
        <div><dt>CTR</dt><dd>{fmtPct(point.ctr, 1)}</dd></div>
        <div><dt>Expected</dt><dd>{fmtPct(point.expected, 1)}</dd></div>
      </dl>
      {action ? <>
        <div className={`kind-chip ${action.kind}`}>{KIND_LABEL[action.kind]}</div>
        <p className="small strong" style={{ margin: '8px 0 4px' }}>{action.title}</p>
        {!compact && <p className="small muted">{action.steps[0]}</p>}
        <div className="gain"><b>+{fmtN(action.gain)}</b> clicks / month expected</div>
      </> : <>
        <p className="small">CTR is {point.ctr >= point.expected ? 'at or above' : 'a little below'} what this site gets at position {fmtN(point.position, 1)}.</p>
        <div className="gain"><b>+{fmtN(point.gap)}</b> clicks / month if it matched the curve</div>
      </>}
    </div>
  )
}

