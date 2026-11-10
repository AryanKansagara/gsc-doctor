import { useState } from 'react'
import type { Settings as S } from './engine/types.ts'
import { deleteProject, getDefaults, getProjects, setDefaults } from './store.ts'
import { exportAll, RAW_SYNC_LIMIT, useSync } from './sync.ts'
import { ask, download, setTheme, toast, useDark } from './ui.tsx'

export default function Settings() {
  const [d, setD] = useState<S>(getDefaults)
  const dark = useDark()
  const sync = useSync()
  const save = (p: Partial<S>) => { const next = { ...d, ...p }; setD(next); setDefaults(next); toast('Saved', { tone: 'ok', ttl: 1500 }) }

  return (
    <section className="page narrow settings">
      <div className="eyebrow">Settings</div>
      <h1>Settings</h1>

      <div className="panel">
        <h2>Defaults for new sites</h2>
        <p className="muted small">Existing sites keep their own settings; change those on the site&rsquo;s Data &amp; settings tab.</p>
        <div className="inline-fields">
          <label className="field"><span>Page group depth</span><input type="number" min="1" max="4" value={d.groupDepth} onChange={e => save({ groupDepth: Math.min(4, Math.max(1, Number(e.target.value) || 1)) })} /></label>
          <label className="field"><span>Decay lookback (months)</span><input type="number" min="3" max="16" value={d.decayMonths} onChange={e => save({ decayMonths: Math.min(16, Math.max(3, Number(e.target.value) || 6)) })} /></label>
          <label className="field"><span>Minimum impressions / month</span><input type="number" min="0" max="100000" value={d.minImpressions} onChange={e => save({ minImpressions: Math.max(0, Number(e.target.value) || 0) })} /></label>
        </div>
      </div>

      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg-control" role="radiogroup" aria-label="Theme">
          <button type="button" role="radio" aria-checked={!dark} className={!dark ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
          <button type="button" role="radio" aria-checked={dark} className={dark ? 'on' : ''} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>

      <div className="panel">
        <h2>Your data</h2>
        <p>Sites live in this browser (IndexedDB). {sync.user ? <>Signed in as <b>{sync.user.email}</b>: settings, titles, done items, snapshots and raw rows under {(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB per site sync to your account.</> : 'Sign in from the account menu (top right) to sync across devices. It is optional.'}</p>
        <div className="row gap wrap">
          <button type="button" className="btn ghost" onClick={async () => download(`search-console-doctor-export-${new Date().toISOString().slice(0, 10)}.json`, await exportAll())}>Export all my data (JSON)</button>
          <button type="button" className="btn danger-ghost" onClick={async () => {
            const list = getProjects()
            if (!list.length) { toast('Nothing to delete'); return }
            if (!(await ask('Delete all local sites?', `Removes ${list.length} site${list.length > 1 ? 's' : ''} from this browser${sync.user ? ' and from your cloud account' : ''}. You can undo for a few seconds.`, 'Delete everything'))) return
            const undos = await Promise.all(list.map(p => deleteProject(p.id)))
            toast(`Deleted ${list.length} sites`, { undo: () => { for (const u of undos) void u() } })
          }}>Delete all sites</button>
        </div>
      </div>

      <div className="panel">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>8</kbd></dt><dd>Switch site sections</dd></div>
          <div><dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Older / newer window</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Save a monthly snapshot</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Printable client report</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last delete</dd></div>
          <div><dt><kbd>?</kbd></dt><dd>Show shortcuts on a site page</dd></div>
        </dl>
      </div>
    </section>
  )
}
