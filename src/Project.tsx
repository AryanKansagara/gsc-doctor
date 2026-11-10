import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { snapshot, windowMonth, fmtMonth, type Analysis } from './engine/analyze.ts'
import type { Fact } from './engine/types.ts'
import { useAnalysis, useProject, winFromUrl, winLabel, winOptions } from './projectData.ts'
import { uuid, type Project } from './store.ts'
import { Empty, go, isTyping, Link, Modal, SyntheticBadge, toast } from './ui.tsx'

const Tabs = lazy(() => import('./Tabs.tsx'))
const DataTab = lazy(() => import('./Import.tsx'))

export const TABS = [['overview', 'Overview'], ['worklist', 'Worklist'], ['cannibal', 'Cannibalisation'], ['decay', 'Decay'], ['drops', 'Drops'], ['queries', 'Queries & pages'], ['history', 'History'], ['data', 'Data & settings']] as const
export type Tab = (typeof TABS)[number][0]

export interface TabProps { project: Project; ds: Fact[]; win: string; a: Analysis; update(p: Partial<Project>): void }

export default function ProjectView({ id, tab: rawTab }: { id: string; tab: string }) {
  const { loading, project, ds, update } = useProject(id)
  const tab = (TABS.some(t => t[0] === rawTab) ? rawTab : 'overview') as Tab
  const opts = useMemo(() => winOptions(ds), [ds])
  const win = winFromUrl(opts)
  const a = useAnalysis(ds, project, win)
  const [help, setHelp] = useState(false)

  useEffect(() => { if (project) document.title = `${project.name} · Search Console Doctor` }, [project?.name])

  const q = win === opts[0] ? '' : `?w=${win}`
  const setTab = (t: Tab) => go(`/app/p/${id}${t === 'overview' ? '' : '/' + t}${q}`, { keepScroll: true })
  const setWin = (w: string) => go(`${location.pathname}?w=${w}`, { replace: true, keepScroll: true })

  const saveSnapshot = () => {
    if (!project || !ds?.length || !a) return
    const period = windowMonth(a.win, ds)
    const prev = project.snapshots.find(s => s.period === period)
    const label = /^\d{4}-\d{2}$/.test(win) ? fmtMonth(win) : `${fmtMonth(period)} (${a.win.label.toLowerCase()})`
    const snap = snapshot(a, uuid(), period, label)
    const snapshots = [...project.snapshots.filter(s => s.period !== period), snap].sort((x, y) => x.period.localeCompare(y.period))
    void update({ snapshots })
    toast(prev ? `Replaced the ${fmtMonth(period)} snapshot` : `Saved a snapshot for ${fmtMonth(period)}`, { tone: 'ok', undo: () => void update({ snapshots: project.snapshots }) })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= TABS.length) { e.preventDefault(); setTab(TABS[n - 1][0]) }
      else if (e.key === '?') setHelp(true)
      else if (e.key === 's') saveSnapshot()
      else if (e.key === 'p') go(`/app/p/${id}/report${q}`)
      else if (e.key === '[' || e.key === ']') {
        const i = opts.indexOf(win)
        const j = e.key === '[' ? i + 1 : i - 1
        if (opts[j]) setWin(opts[j])
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  if (loading) return <div className="boot" role="status"><span className="spinner" /> Reading Search Console rows</div>
  if (!project) return (
    <section className="page narrow center">
      <Empty title="Site not found"><p className="muted">It may have been deleted, or it lives on another device.</p><Link href="/app" className="btn primary">All sites</Link></Empty>
    </section>
  )
  const empty = !ds?.length

  return (
    <section className="page">
      <div className="proj-head">
        <div>
          <div className="eyebrow"><Link href="/app">Sites</Link></div>
          <h1 className="row gap wrap">{project.name} {project.sampleId && <SyntheticBadge />}</h1>
          {a && <p className="muted small" style={{ margin: 0 }}>{a.win.label}{a.win.cur ? ` · ${a.win.cur[0]} to ${a.win.cur[1]}` : ''} · compared with the previous {a.win.days} days · {a.actions.length} actions</p>}
        </div>
        {!empty && (
          <div className="toolbar">
            <label className="sr-only" htmlFor="win">Date range</label>
            <select id="win" value={win} onChange={e => setWin(e.target.value)}>
              {opts.map(o => <option key={o} value={o}>{winLabel(ds, o)}</option>)}
            </select>
            <button type="button" className="btn outline" onClick={saveSnapshot} title="Save a monthly snapshot (S)">Save snapshot</button>
            <Link href={`/app/p/${id}/report${q}`} className="btn primary" title="Client report (P)">Report</Link>
          </div>
        )}
      </div>
      <nav className="tabs" aria-label="Site sections">
        {TABS.map(([t, l], i) => <Link key={t} href={`/app/p/${id}${t === 'overview' ? '' : '/' + t}${q}`} aria-current={t === tab ? 'page' : undefined} title={`${l} (${i + 1})`}>{l}</Link>)}
      </nav>
      <Suspense fallback={<div className="boot"><span className="spinner" /></div>}>
        {tab === 'data' || empty || !a
          ? <DataTab project={project} ds={ds ?? []} update={update} />
          : <Tabs tab={tab} project={project} ds={ds!} win={win} a={a} update={update} />}
      </Suspense>
      <Modal open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts">
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>8</kbd></dt><dd>Switch sections</dd></div>
          <div><dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Older / newer date range</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Save a snapshot for this month</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Open the printable client report</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last delete</dd></div>
        </dl>
      </Modal>
    </section>
  )
}
