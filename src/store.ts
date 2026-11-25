import { useSyncExternalStore } from 'react'
import type { Snapshot } from './engine/analyze.ts'
import type { TableKind } from './engine/parse.ts'
import { DEFAULT_SETTINGS, type Fact, type Settings } from './engine/types.ts'

export type Dataset = Fact[]

export interface ImportMeta { id: string; kind: TableKind | 'api'; fileName: string; rows: number; skipped: number; at: number; range?: [string, string] | null }

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  settings: Settings
  snapshots: Snapshot[]
  imports: ImportMeta[]
  /** Built-in synthetic site; its data is regenerated instead of stored. */
  sampleId?: string
  /** Current page titles and meta descriptions, typed in the title helper (or known for samples). */
  titles?: Record<string, { title: string; meta?: string }>
  /** Worklist items marked done, by action id */
  done?: string[]
  /** True when this device has no copy of the raw rows (synced from another device). */
  dataMissing?: boolean
}

// ---------- Tiny IndexedDB wrapper (falls back to memory in private modes) ----------

const DB = 'gsc-doctor'
let dbp: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  return dbp ??= new Promise(res => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' })
        req.result.createObjectStore('data')
      }
      req.onsuccess = () => res(req.result)
      req.onerror = () => res(null)
    } catch { res(null) }
  })
}
const mem = { projects: new Map<string, unknown>(), data: new Map<string, unknown>() }

async function tx<T>(store: 'projects' | 'data', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  if (!d) throw new Error('no-idb')
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode)
    const r = fn(t.objectStore(store))
    // A request can succeed and its transaction still fail (disk full), so only a completed one counts.
    t.oncomplete = () => res(r.result)
    t.onabort = t.onerror = () => rej(t.error ?? r.error ?? new Error('The browser stopped the write.'))
  })
}

// What could not be written is kept in `mem` for the session and read from there first.
const failHooks = new Set<(message: string) => void>()
/** Called with a message for the user whenever something is only kept until the tab closes. */
export const onSaveFailure = (f: (message: string) => void) => { failHooks.add(f); return () => { failHooks.delete(f) } }
export const reason = (e: unknown) => (e as { name?: string } | null)?.name === 'QuotaExceededError' ? 'this browser\u2019s storage is full' : 'this browser could not use its storage'
let warned = false
function notStored(e: unknown) {
  if (!dbOpen) { if (warned) return; warned = true }
  const m = dbOpen ? `Not saved: ${reason(e)}. The change lasts until this tab closes.` : 'This browser does not let the app store data. Everything here lasts until this tab closes.'
  failHooks.forEach(f => f(m))
}
let dbOpen = true

async function idbGetAll<T>(store: 'projects'): Promise<T[]> {
  let stored: T[] = []
  try { stored = await tx(store, 'readonly', s => s.getAll()) as T[] } catch { /* memory only */ }
  return [...stored.filter(v => !mem[store].has((v as { id: string }).id)), ...mem[store].values() as Iterable<T>]
}
async function idbGet<T>(store: 'projects' | 'data', key: string): Promise<T | undefined> {
  if (mem[store].has(key)) return mem[store].get(key) as T
  try { return await tx(store, 'readonly', s => s.get(key)) as T | undefined } catch { return undefined }
}
/** Writes, or throws. Without any database (private modes) it keeps the value for the session and resolves to false. */
async function idbWrite(store: 'projects' | 'data', value: unknown, key?: string): Promise<boolean> {
  const id = key ?? (value as { id: string }).id
  dbOpen = !!await db()
  if (!dbOpen) { mem[store].set(id, value); notStored(null); return false }
  await tx(store, 'readwrite', s => key === undefined ? s.put(value) : s.put(value, key))
  mem[store].delete(id)
  return true
}
/** Writes, or keeps the value for the session and tells the user. */
async function idbPut(store: 'projects' | 'data', value: unknown, key?: string) {
  try { await idbWrite(store, value, key) } catch (e) { mem[store].set(key ?? (value as { id: string }).id, value); notStored(e) }
}
async function idbDel(store: 'projects' | 'data', key: string) {
  mem[store].delete(key)
  try { await tx(store, 'readwrite', s => s.delete(key)) } catch (e) { if (await db()) failHooks.forEach(f => f(`Not deleted from this device: ${reason(e)}.`)) }
}

// ---------- In-memory project list with subscribers ----------

let projects: Project[] = []
let loaded = false
const subs = new Set<() => void>()
const emit = () => { projects = [...projects]; subs.forEach(f => f()) }
const changeHooks = new Set<(p: Project) => void>()

export const onProjectChange = (f: (p: Project) => void) => { changeHooks.add(f); return () => changeHooks.delete(f) }

export async function loadProjects() {
  projects = (await idbGetAll<Project>('projects')).sort((a, b) => b.updatedAt - a.updatedAt)
  loaded = true
  emit()
}

export function useProjects() {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => loaded ? projects : null)
}

export const getProjects = () => projects
export const getProject = (id: string) => projects.find(p => p.id === id)

export async function saveProject(p: Project, opts: { touch?: boolean; silent?: boolean } = {}) {
  const next = opts.touch === false ? p : { ...p, updatedAt: Date.now() }
  await idbPut('projects', next)
  const i = projects.findIndex(x => x.id === p.id)
  if (i >= 0) projects[i] = next
  else projects.unshift(next)
  projects.sort((a, b) => b.updatedAt - a.updatedAt)
  emit()
  if (!opts.silent) changeHooks.forEach(f => f(next))
  return next
}

/** Deletes locally; returns an undo function that restores the project and its data. */
export async function deleteProject(id: string): Promise<() => Promise<void>> {
  const p = getProject(id)
  const data = await idbGet<Dataset>('data', id)
  projects = projects.filter(x => x.id !== id)
  emit()
  await idbDel('projects', id)
  await idbDel('data', id)
  addTombstone(id)
  return async () => {
    if (!p) return
    removeTombstone(id)
    if (data) await idbPut('data', data, id)
    await saveProject(p)
  }
}

export const getData = (id: string) => idbGet<Dataset>('data', id)
/** Like getData, but a failed read throws: merging into "nothing" would replace what is stored. */
export async function readData(id: string): Promise<Dataset | undefined> {
  if (mem.data.has(id) || !await db()) return mem.data.get(id) as Dataset | undefined
  return tx('data', 'readonly', s => s.get(id))
}
/** Stores rows or throws; false when they are only kept for the session (no database at all). */
export const putData = (id: string, ds: Dataset) => idbWrite('data', ds, id)
/** Puts rows back after an undo: if they cannot be written they are kept for the session. */
export const restoreData = (id: string, ds: Dataset) => idbPut('data', ds, id)

export const uuid = () => crypto.randomUUID()

// Tombstones keep a project deleted offline from coming back on the next sync.
const TOMB = 'gsc-doctor.tombstones'
export const tombstones = (): string[] => { try { return JSON.parse(localStorage.getItem(TOMB) ?? '[]') } catch { return [] } }
const addTombstone = (id: string) => localStorage.setItem(TOMB, JSON.stringify([...new Set([...tombstones(), id])]))
const removeTombstone = (id: string) => localStorage.setItem(TOMB, JSON.stringify(tombstones().filter(x => x !== id)))
export const clearTombstones = (ids: string[]) => localStorage.setItem(TOMB, JSON.stringify(tombstones().filter(x => !ids.includes(x))))

// ---------- App defaults (settings page) ----------

const DEF_KEY = 'gsc-doctor.defaults'
export function getDefaults(): Settings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(DEF_KEY) ?? '{}') } } catch { return { ...DEFAULT_SETTINGS } }
}
export const setDefaults = (d: Settings) => localStorage.setItem(DEF_KEY, JSON.stringify(d))
