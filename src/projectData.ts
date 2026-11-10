import { useEffect, useMemo, useState } from 'react'
import { analyze, fmtMonth, resolveWindow, snapshot, windowOptions } from './engine/analyze.ts'
import { generate, SAMPLES } from './engine/sample.ts'
import type { Fact } from './engine/types.ts'
import { getData, getDefaults, getProjects, saveProject, useProjects, uuid, type Dataset, type Project } from './store.ts'

export const sampleFacts = (id: string): Fact[] | null => SAMPLES.some(s => s.id === id) ? generate(id) : null

export async function createSampleProject(sampleId: string): Promise<Project> {
  const existing = getProjects().find(p => p.sampleId === sampleId)
  if (existing) return existing
  const def = SAMPLES.find(s => s.id === sampleId)!
  const ds = generate(sampleId)
  const settings = { ...getDefaults(), brandTerms: def.brand }
  // A few closed months, so History has something to compare.
  const snapshots = ['2026-05', '2026-08', '2026-10'].map(m => snapshot(analyze(ds, m, settings), uuid(), m, fmtMonth(m)))
  const now = Date.now()
  return saveProject({
    id: uuid(), name: def.name, createdAt: now, updatedAt: now, settings, snapshots, sampleId,
    titles: Object.fromEntries(Object.entries(def.titles).map(([k, v]) => [k, { title: v }])),
    imports: [{ id: uuid(), kind: 'rows', fileName: 'synthetic query + page rows (Oct 2025 to Nov 2026)', rows: ds.length, skipped: 0, at: now, range: ['2025-10-01', '2026-11-07'] }],
  })
}

export async function createBlankProject(name: string): Promise<Project> {
  const now = Date.now()
  return saveProject({ id: uuid(), name, createdAt: now, updatedAt: now, settings: getDefaults(), snapshots: [], imports: [] })
}

export function useProject(id: string) {
  const list = useProjects()
  const project = list?.find(p => p.id === id) ?? null
  const [ds, setDs] = useState<Dataset | null>(null)
  const importsKey = project ? project.imports.map(i => i.id).join(',') : ''
  useEffect(() => {
    if (!project) return
    let live = true
    if (project.sampleId) { setDs(sampleFacts(project.sampleId) ?? []); return }
    void getData(project.id).then(d => { if (live) setDs(d ?? []) })
    return () => { live = false }
  }, [project?.id, project?.sampleId, importsKey])
  const update = (patch: Partial<Project>) => project && saveProject({ ...project, ...patch })
  return { loading: list === null || (project !== null && ds === null), project, ds, update }
}

export function useAnalysis(ds: Fact[] | null, project: Project | null, win: string) {
  return useMemo(() => ds?.length && project ? analyze(ds, win, project.settings) : null, [ds, project?.settings, win])
}

export const winOptions = (ds: Fact[] | null) => ds?.length ? windowOptions(ds) : ['export']
export const winLabel = (ds: Fact[] | null, k: string) => ds?.length ? resolveWindow(ds, k).label : k

export function winFromUrl(opts: string[]) {
  const q = new URLSearchParams(location.search).get('w')
  return q && opts.includes(q) ? q : opts[0]
}
