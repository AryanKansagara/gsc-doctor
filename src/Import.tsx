import { useMemo, useRef, useState } from 'react'
import { addDays } from './engine/updates.ts'
import { autoMap, detectKind, factsToCsv, FIELDS, filtersNote, KIND_LABEL, mergeFacts, readFile, validate, type Mapping, type Table, type TableKind } from './engine/parse.ts'
import type { Fact, Settings } from './engine/types.ts'
import { createBlankProject } from './projectData.ts'
import { putData, saveProject, uuid, type Project } from './store.ts'
import { RAW_SYNC_LIMIT, useSync } from './sync.ts'
import { ask, download, go, Link, toast } from './ui.tsx'

interface Pending { id: string; file: string; table: Table; map: Mapping; kind: TableKind }

export default function DataTab({ project, ds, update }: { project: Project; ds: Fact[]; update(p: Partial<Project>): void }) {
  const [pending, setPending] = useState<Pending[]>([])
  const [note, setNote] = useState('')
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sync = useSync()
  const rawSize = useMemo(() => project.sampleId ? 0 : JSON.stringify(ds).length, [ds, project.sampleId])

  const readFiles = async (files: FileList | File[]) => {
    setBusy(true)
    const next: Pending[] = []
    for (const f of [...files]) {
      if (f.size > 150_000_000) { toast(`${f.name} is over 150 MB. Export a shorter date range.`, { tone: 'error' }); continue }
      try {
        const tables = await readFile(f.name, await f.arrayBuffer())
        const n = filtersNote(tables)
        if (n) setNote(n)
        for (const t of tables) {
          if (t.rows.length < 2) continue
          const map = autoMap(t.rows[0])
          next.push({ id: uuid(), file: tables.length > 1 ? `${f.name} › ${t.name}` : f.name, table: t, map, kind: detectKind(t, map) })
        }
        if (!tables.some(t => t.rows.length > 1)) toast(`${f.name} has no data rows.`, { tone: 'error' })
      } catch (e) { toast(`${f.name}: ${e instanceof Error ? e.message : 'could not be read'}`, { tone: 'error' }) }
    }
    setPending(p => [...p, ...next])
    setBusy(false)
  }

  /** Samples are read-only: importing into one starts a new site. */
  const target = async () => project.sampleId ? createBlankProject('My site') : project

  const commit = async (items: { p: Pending; facts: Fact[]; skipped: number; range: [string, string] | null }[]) => {
    const t = await target()
    let merged = project.sampleId ? [] : ds
    for (const i of items) merged = mergeFacts(merged, i.facts)
    await putData(t.id, merged)
    const metas = items.map(i => ({ id: uuid(), kind: i.p.kind, fileName: i.p.file, rows: i.facts.length, skipped: i.skipped, at: Date.now(), range: i.range }))
    await saveProject({ ...t, imports: [...(project.sampleId ? [] : project.imports), ...metas], dataMissing: false })
    setPending(x => x.filter(y => !items.some(i => i.p.id === y.id)))
    toast(`Imported ${items.reduce((s, i) => s + i.facts.length, 0).toLocaleString()} rows from ${items.length} table${items.length > 1 ? 's' : ''}`, { tone: 'ok' })
    if (project.sampleId) go(`/app/p/${t.id}`)
  }

  const ready = pending.filter(p => p.kind !== 'ignored' && p.kind !== 'unknown')
  const setS = (patch: Partial<Settings>) => update({ settings: { ...project.settings, ...patch } })

  return (
    <>
      {project.dataMissing && <div className="banner warn"><span><strong>This site&rsquo;s raw rows are on another device.</strong> Settings, titles and snapshots synced; exports over {(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB stay where they were imported. Re-import here to recompute.</span></div>}
      {!ds.length && !pending.length && (
        <div className="banner"><span><strong>Start here.</strong> In Search Console open Performance → Search results, set the date range, click Export → Download CSV (or Excel), and drop the zip below. For cannibalisation, add <Link href="/docs#query-page">query + page rows</Link>.</span></div>
      )}
      <div className="panel">
        <div className="panel-head"><h2>Import</h2><span className="muted small">Search Console zip or Excel export · query + page CSV (API, Sheets, Looker Studio, BigQuery)</span></div>
        {project.sampleId && <p className="muted small">This is a synthetic sample, so it is read-only. Importing here starts a new site. Want to rehearse? <button type="button" className="linkish" onClick={() => download(`${project.sampleId}-rows.csv`, factsToCsv(ds.filter(f => f.g === 'query|page' && f.date! >= '2026-08-01')))}>Download 3 months of sample rows</button> and drop them back in.</p>}
        <div className={`drop${drag ? ' over' : ''}`} role="button" tabIndex={0} aria-label="Choose Search Console export files to import"
          onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
          onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); void readFiles(e.dataTransfer.files) }}>
          <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
          <h3>{busy ? 'Reading files' : 'Drop exports here, or click to choose'}</h3>
          <p className="muted small" style={{ margin: 0 }}>.zip, .xlsx, .csv. Parsed in your browser. Re-importing the same dates replaces them instead of double counting.</p>
          <input ref={input} type="file" accept=".zip,.xlsx,.csv,.tsv,.txt" multiple hidden onChange={e => { if (e.target.files) void readFiles(e.target.files); e.target.value = '' }} />
        </div>
        {note && <p className="small muted" style={{ marginTop: 10 }}>Export filters: {note}</p>}
      </div>

      {ready.length > 1 && <div className="panel tint row between wrap gap">
        <span className="small">{ready.length} tables recognised. {pending.length - ready.length > 0 && `${pending.length - ready.length} not used.`}</span>
        <button type="button" className="btn primary" onClick={() => void commit(ready.map(p => { const v = validate(p.table, p.map); return { p, facts: v.facts, skipped: v.skipped, range: v.range } }).filter(i => i.facts.length))}>Import all ready tables</button>
      </div>}

      {pending.map(p => <PendingTable key={p.id} p={p} onChange={n => setPending(x => x.map(y => y.id === p.id ? n : y))} onCancel={() => setPending(x => x.filter(y => y.id !== p.id))} onCommit={(facts, skipped, range) => commit([{ p, facts, skipped, range }])} />)}

      <LivePull onRows={facts => commit([{ p: { id: uuid(), file: 'Search Console API (live pull)', table: { name: '', rows: [], lines: [] }, map: {}, kind: 'rows' }, facts, skipped: 0, range: null }])} />

      <div className="panel">
        <div className="panel-head"><h2>Site settings</h2><span className="muted small">Changes recompute everything instantly</span></div>
        <label className="field"><span>Brand terms (comma separated, include misspellings)</span>
          <input defaultValue={project.settings.brandTerms.join(', ')} placeholder="acme, acme corp, acmee" onBlur={e => setS({ brandTerms: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} />
        </label>
        <div className="inline-fields">
          <label className="field"><span>Page group depth</span><input type="number" min="1" max="4" value={project.settings.groupDepth} onChange={e => setS({ groupDepth: Math.min(4, Math.max(1, Number(e.target.value) || 1)) })} /></label>
          <label className="field"><span>Decay lookback (months)</span><input type="number" min="3" max="16" value={project.settings.decayMonths} onChange={e => setS({ decayMonths: Math.min(16, Math.max(3, Number(e.target.value) || 6)) })} /></label>
          <label className="field"><span>Min impressions / month</span><input type="number" min="0" value={project.settings.minImpressions} onChange={e => setS({ minImpressions: Math.max(0, Number(e.target.value) || 0) })} /></label>
        </div>
      </div>

      {(project.imports.length > 0 || ds.length > 0) && (
        <div className="panel">
          <div className="panel-head"><h2>Imported data</h2><span className="muted small">{ds.length.toLocaleString()} rows{rawSize ? ` · ${(rawSize / 1e6).toFixed(2)} MB` : ''}</span></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Source</th><th>Type</th><th className="num">Rows</th><th className="num">Skipped</th><th>Dates</th><th>When</th></tr></thead>
            <tbody>{[...project.imports].reverse().map(i => <tr key={i.id}><th scope="row" className="break">{i.fileName}</th><td className="small">{i.kind === 'api' ? 'API' : KIND_LABEL[i.kind]}</td><td className="num">{i.rows.toLocaleString()}</td><td className="num">{i.skipped}</td><td className="small">{i.range ? `${i.range[0]} to ${i.range[1]}` : 'undated'}</td><td className="small">{new Date(i.at).toLocaleString()}</td></tr>)}</tbody>
          </table></div>
          <p className="muted small">{sync.user
            ? rawSize > RAW_SYNC_LIMIT ? `These rows are over ${(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB, so they stay on this device. Settings, titles, done items and snapshots still sync.` : 'Synced to your account with settings, titles and snapshots.'
            : 'Stored in this browser only. Sign in to sync across devices.'}</p>
          <div className="row gap wrap">
            <button type="button" className="btn sm outline" onClick={() => download(`${project.name.replace(/\W+/g, '-').toLowerCase()}-rows.csv`, factsToCsv(ds))}>Download normalised CSV</button>
            {!project.sampleId && <button type="button" className="btn sm danger-ghost" onClick={async () => {
              if (!(await ask('Clear imported data?', 'Removes every imported row from this site on this device. Settings and snapshots stay. You can undo for a few seconds.', 'Clear data'))) return
              const before = ds, imports = project.imports
              await putData(project.id, [])
              update({ imports: [] })
              toast('Cleared imported data', { undo: async () => { await putData(project.id, before); update({ imports }) } })
            }}>Clear imported data</button>}
          </div>
        </div>
      )}
    </>
  )
}

function PendingTable({ p, onChange, onCancel, onCommit }: { p: Pending; onChange(p: Pending): void; onCancel(): void; onCommit(f: Fact[], skipped: number, range: [string, string] | null): Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const usable = p.kind !== 'ignored'
  const v = useMemo(() => usable ? validate(p.table, p.map) : null, [p, usable])
  const headers = p.table.rows[0] ?? []
  if (!v) return <div className="panel slim row between"><span className="small"><b className="break">{p.file}</b> · {KIND_LABEL[p.kind]}</span><button type="button" className="btn ghost sm" onClick={onCancel}>Dismiss</button></div>
  const errors = v.issues.filter(i => i.level === 'error')
  const setMap = (map: Mapping) => onChange({ ...p, map, kind: detectKind(p.table, map) })
  return (
    <div className="panel">
      <div className="panel-head"><h2 className="break">{p.file}</h2><span className="badge">{KIND_LABEL[p.kind]}</span></div>
      <h3 className="small strong">Column mapping</h3>
      <div className="map-grid">
        {FIELDS.map(f => (
          <label key={f.key} className="field"><span>{f.label}{f.required ? ' *' : ''}</span>
            <select value={p.map[f.key] ?? ''} onChange={e => { const map = { ...p.map }; if (e.target.value === '') delete map[f.key]; else map[f.key] = Number(e.target.value); setMap(map) }}>
              <option value="">Not mapped</option>
              {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
            </select>
          </label>
        ))}
      </div>
      <h3 className="small strong" style={{ marginTop: 8 }}>Validation</h3>
      <p className="small">
        <strong className="good-text">{v.facts.length.toLocaleString()} rows ready</strong> of {v.total.toLocaleString()}
        {v.skipped > 0 && <>, <strong className="error">{v.skipped} skipped</strong></>}
        {v.issues.length > errors.length && <>, {v.issues.length - errors.length} warnings</>}.
        {' '}Grain: {v.dims.length ? v.dims.join(' + ') : 'site totals'}{v.dated ? ', by date' : ''}{v.compare ? ', with a previous period' : ''}.
        {v.range && <> Dates {v.range[0]} to {v.range[1]}.</>}
      </p>
      {v.issues.length > 0 && (
        <div className="issues" role="log" aria-label="Validation issues">
          {v.issues.slice(0, 200).map((i, k) => <div key={k} className={i.level === 'error' ? 'error-row' : ''}><span className="ln">line {i.line}</span><span>{i.message}</span></div>)}
          {v.issues.length > 200 && <div><span className="ln" /><span className="muted">and {v.issues.length - 200} more</span></div>}
        </div>
      )}
      <div className="row gap" style={{ marginTop: 14 }}>
        <button type="button" className="btn primary" disabled={!v.facts.length || busy} onClick={async () => { setBusy(true); await onCommit(v.facts, v.skipped, v.range); setBusy(false) }}>Import {v.facts.length.toLocaleString()} rows</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ---------- Optional live pull: your own OAuth client ID, token flow in the browser, no secret ----------

declare global { interface Window { google?: { accounts: { oauth2: { initTokenClient(c: { client_id: string; scope: string; callback(r: { access_token?: string; error?: string }): void }): { requestAccessToken(): void } } } } } }

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const API = 'https://www.googleapis.com/webmasters/v3'

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve()
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load Google sign-in')); document.head.appendChild(s) })
}

async function pullRows(token: string, site: string, start: string, end: string, dims: string[], onProgress: (n: number) => void): Promise<Fact[]> {
  const out: Fact[] = []
  const g = dims.filter(d => d !== 'date').join('|')
  for (let startRow = 0; startRow < 250_000; startRow += 25_000) {
    const r = await fetch(`${API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ startDate: start, endDate: end, dimensions: dims, type: 'web', rowLimit: 25_000, startRow }) })
    if (!r.ok) throw new Error(`Search Console API ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const rows = ((await r.json()).rows ?? []) as { keys: string[]; clicks: number; impressions: number; position: number }[]
    for (const row of rows) {
      const f: Fact = { g, clicks: row.clicks, impressions: row.impressions, position: row.position }
      dims.forEach((d, i) => { (f as unknown as Record<string, string>)[d] = d === 'page' ? row.keys[i].replace(/#.*$/, '') : d === 'device' ? row.keys[i][0] + row.keys[i].slice(1).toLowerCase() : d === 'country' ? row.keys[i].toUpperCase() : row.keys[i] })
      out.push(f)
    }
    onProgress(out.length)
    if (rows.length < 25_000) break
  }
  return out
}

function LivePull({ onRows }: { onRows(f: Fact[]): Promise<void> }) {
  const [clientId, setClientId] = useState(() => localStorage.getItem('gsc-doctor.clientId') ?? '')
  const [token, setToken] = useState<string | null>(null)
  const [sites, setSites] = useState<string[]>([])
  const [site, setSite] = useState('')
  const [months, setMonths] = useState(6)
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState(false)

  const connect = async () => {
    try {
      localStorage.setItem('gsc-doctor.clientId', clientId.trim())
      await loadGis()
      window.google!.accounts.oauth2.initTokenClient({ client_id: clientId.trim(), scope: SCOPE, callback: async r => {
        if (!r.access_token) { setStatus(r.error ?? 'Sign-in was cancelled.'); return }
        setToken(r.access_token)
        const res = await fetch(`${API}/sites`, { headers: { Authorization: `Bearer ${r.access_token}` } })
        const list = res.ok ? ((await res.json()).siteEntry ?? []).map((s: { siteUrl: string }) => s.siteUrl) : []
        setSites(list); setSite(list[0] ?? '')
        setStatus(list.length ? '' : 'No properties on this account.')
      } }).requestAccessToken()
    } catch (e) { setStatus(e instanceof Error ? e.message : String(e)) }
  }
  const pull = async () => {
    if (!token || !site) return
    // Search Console data lags about two days.
    const end = addDays(new Date().toISOString().slice(0, 10), -3)
    const start = addDays(end, -Math.round(months * 30.44))
    try {
      const all: Fact[] = []
      for (const dims of [['date'], ['date', 'page'], ['date', 'device'], ['date', 'country'], ['date', 'query', 'page']]) {
        setStatus(`Pulling ${dims.slice(1).join(' + ') || 'daily totals'}…`)
        all.push(...await pullRows(token, site, start, end, dims, n => setStatus(`Pulling ${dims.slice(1).join(' + ') || 'daily totals'}: ${n.toLocaleString()} rows`)))
      }
      setStatus('')
      await onRows(all)
    } catch (e) { setStatus(e instanceof Error ? e.message : String(e)) }
  }
  return (
    <div className="panel">
      <div className="panel-head"><h2>Live pull from the Search Console API</h2><button type="button" className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Set up'}</button></div>
      <p className="muted small" style={{ margin: 0 }}>Optional. Uses your own free Google Cloud OAuth client ID and Google&rsquo;s browser token flow: no secret, no server, the token stays in this tab. <Link href="/docs#live">Setup steps</Link>.</p>
      {open && <div style={{ marginTop: 12 }}>
        <label className="field"><span>OAuth client ID (Web application, this site&rsquo;s origin authorised)</span><input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" /></label>
        <div className="row gap wrap">
          <button type="button" className="btn outline" disabled={!/\.apps\.googleusercontent\.com$/.test(clientId.trim())} onClick={() => void connect()}>{token ? 'Reconnect' : 'Connect Google account'}</button>
          {token && sites.length > 0 && <>
            <select aria-label="Property" value={site} onChange={e => setSite(e.target.value)} style={{ width: 'auto' }}>{sites.map(s => <option key={s}>{s}</option>)}</select>
            <select aria-label="Months" value={months} onChange={e => setMonths(+e.target.value)} style={{ width: 'auto' }}>{[3, 6, 12, 16].map(m => <option key={m} value={m}>Last {m} months</option>)}</select>
            <button type="button" className="btn primary" onClick={() => void pull()}>Pull rows</button>
          </>}
        </div>
        {status && <p className="small" role="status" style={{ marginTop: 8 }}>{status}</p>}
      </div>}
    </div>
  )
}
