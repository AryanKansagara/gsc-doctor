import { useEffect, useState } from 'react'
import { SAMPLES } from './engine/sample.ts'
import { createBlankProject, createSampleProject } from './projectData.ts'
import { deleteProject, saveProject, useProjects, type Project } from './store.ts'
import { useSync } from './sync.ts'
import { ask, fmtN, go, Link, SyntheticBadge, toast } from './ui.tsx'

export default function Workspace() {
  const list = useProjects()
  const sync = useSync()
  const [busy, setBusy] = useState<string | null>(null)

  // /app?sample=acme opens (or creates) the sample straight away.
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const s = q.get('sample')
    const tab = q.get('tab')?.replace(/[^a-z]/g, '')
    if (!s || list === null || busy) return
    if (!SAMPLES.some(x => x.id === s)) return
    setBusy(s)
    void createSampleProject(s).then(p => go(`/app/p/${p.id}${tab ? '/' + tab : ''}`, { replace: true }))
  }, [list, busy])

  const openSample = async (id: string) => { setBusy(id); const p = await createSampleProject(id); go(`/app/p/${p.id}`) }
  const newProject = async () => {
    const name = `My site ${(list?.filter(p => !p.sampleId).length ?? 0) + 1}`
    const p = await createBlankProject(name)
    go(`/app/p/${p.id}/data`)
  }

  if (list === null || busy) return <div className="boot" role="status"><span className="spinner" /> {busy ? 'Generating the synthetic site' : 'Opening your sites'}</div>

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Sites</h1>
          <p className="muted">One workspace per Search Console property. Each keeps its imports, brand terms, worklist progress and monthly snapshots. {sync.user ? 'Synced to your account.' : 'Stored on this device.'}</p>
        </div>
        {list.length > 0 && <div className="row gap"><button type="button" className="btn primary" onClick={newProject}>New site</button></div>}
      </div>

      {list.length === 0 ? (
        <div className="onboard">
          <article className="onboard-card feature-card">
            <div className="eyebrow">Two minutes</div>
            <h2>Try the sample</h2>
            <p>Two synthetic sites with real-looking problems: three banana bread pages splitting one query, a guide sliding off page one, and a SaaS blog hit by a core update. Everything is clickable.</p>
            <div className="stack-sm">
              {SAMPLES.map(s => (
                <button key={s.id} type="button" className="sample-btn" onClick={() => void openSample(s.id)}>
                  <span><strong>{s.name}</strong><small>{s.blurb}</small></span><span aria-hidden="true">&rarr;</span>
                </button>
              ))}
            </div>
          </article>
          <article className="onboard-card">
            <div className="eyebrow">Your property</div>
            <h2>Import your data</h2>
            <p>Drop the Search Console Performance export (the zip or the Excel file), or query + page rows from the API, Sheets, Looker Studio or BigQuery. Tables are detected, columns mapped, and every bad row is reported with its line number.</p>
            <div className="row gap wrap">
              <button type="button" className="btn primary" onClick={newProject}>Import your data</button>
              <Link href="/docs" className="btn ghost">How to export</Link>
            </div>
            <p className="muted small">Files are parsed in your browser and stay on this device unless you sign in to sync.</p>
          </article>
        </div>
      ) : (
        <>
          <div className="project-grid">
            {list.map(p => <ProjectCard key={p.id} p={p} />)}
          </div>
          <div className="samples-row">
            <span className="muted small">Samples:</span>
            {SAMPLES.map(s => <button key={s.id} type="button" className="linkish small" onClick={() => void openSample(s.id)}>{s.name}</button>)}
          </div>
        </>
      )}
    </section>
  )
}

function ProjectCard({ p }: { p: Project }) {
  const [renaming, setRenaming] = useState(false)
  const last = [...p.snapshots].sort((a, b) => a.at - b.at || a.period.localeCompare(b.period)).at(-1)
  return (
    <article className="project-card">
      <div className="row between">
        {renaming ? (
          <form onSubmit={e => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('n')).trim(); if (v) void saveProject({ ...p, name: v }); setRenaming(false) }}>
            <input name="n" defaultValue={p.name} autoFocus aria-label="Project name" onBlur={e => e.currentTarget.form?.requestSubmit()} />
          </form>
        ) : <h3><Link href={`/app/p/${p.id}`}>{p.name}</Link></h3>}
        {p.sampleId && <SyntheticBadge />}
      </div>
      <dl className="mini-stats">
        <div><dt>Last snapshot</dt><dd>{last ? last.label : 'None yet'}</dd></div>
        <div><dt>Clicks / mo</dt><dd>{last ? fmtN(last.totals.clicks) : '—'}</dd></div>
        <div><dt>Open actions</dt><dd>{last ? last.actions.filter(a => !p.done?.includes(a.id)).length : '—'}</dd></div>
        <div><dt>Imports</dt><dd>{p.imports.length}</dd></div>
      </dl>
      {p.dataMissing && <p className="warn-text small">The raw export lives on another device. Re-import here to recompute.</p>}
      <div className="row between">
        <span className="muted small">Updated {new Date(p.updatedAt).toLocaleDateString()}</span>
        <div className="row gap-sm">
          <button type="button" className="btn ghost sm" onClick={() => setRenaming(true)}>Rename</button>
          <button type="button" className="btn danger-ghost sm" onClick={async () => {
            if (!(await ask(`Delete “${p.name}”?`, 'Removes the site, its imports and its snapshots from this device (and the cloud, if you are signed in). You can undo for a few seconds.', 'Delete site'))) return
            const undo = await deleteProject(p.id)
            toast(`Deleted ${p.name}`, { undo: () => void undo() })
          }}>Delete</button>
        </div>
      </div>
    </article>
  )
}

