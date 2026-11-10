// node scripts/qa-sync.mjs : signs up a throwaway account, round-trips a site and a snapshot through the same tables the app syncs to, then deletes the account
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => l.split('=')))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
const email = `qa-gsc-doctor-${Date.now()}@example.com`, password = 'qa-' + Math.random().toString(36).slice(2) + 'X9!'
const ok = (label, r) => { if (r.error) { console.log('FAIL', label, r.error.message); process.exitCode = 1 } else console.log('ok  ', label) }
const up = await sb.auth.signUp({ email, password }); ok('sign up ' + email, up)
if (!up.data.session) ok('sign in', await sb.auth.signInWithPassword({ email, password }))
const id = crypto.randomUUID(), vid = crypto.randomUUID()
ok('upsert site', await sb.from('projects').upsert({ id, app: 'gsc-doctor', name: 'QA site', data: { project: { id, name: 'QA site', settings: { brandTerms: ['acme'], groupDepth: 1, decayMonths: 6, minImpressions: 30 } } }, updated_at: new Date().toISOString() }))
ok('insert snapshot', await sb.from('project_versions').insert({ id: vid, project_id: id, label: 'October 2026', data: { id: vid, period: '2026-10', totals: { clicks: 10 } } }))
const rows = await sb.from('projects').select('id,name,data').eq('app', 'gsc-doctor'); ok('read back', rows)
console.log(rows.data?.length === 1 && rows.data[0].data.project.settings.brandTerms[0] === 'acme' ? 'ok   round trip matches' : 'FAIL round trip')
const vs = await sb.from('project_versions').select('id').in('project_id', [id]); console.log(vs.data?.length === 1 ? 'ok   snapshot round trip' : 'FAIL snapshot')
ok('delete account', await sb.rpc('delete_my_account'))
const after = await sb.auth.signInWithPassword({ email, password }); console.log(after.error ? 'ok   account gone (' + after.error.message + ')' : 'FAIL account still exists')
