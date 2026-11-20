// Event triggers: a bee runs when something happens (a commit, a GitHub event, another bee finishing). Pure logic, no Electron
'use strict'

const TYPES = ['commit', 'github', 'bee'], WHAT = ['pr', 'comment', 'ci'], ON = ['done', 'error', 'any']
const BRANCH = /^[\w./-]{1,120}$/

// What the settings form sent → a clean event, or an error the user can read
function parseEvent(c, agents = [], selfId = '') {
  c = c || {}
  const type = TYPES.includes(c.type) ? c.type : 'commit'
  const e = { type, cooldown: Math.min(1440, Math.max(0, Math.round(+c.cooldown >= 0 ? +c.cooldown : 5))) }
  if (type === 'commit') {
    e.branch = String(c.branch || '').trim()
    if (e.branch && (!BRANCH.test(e.branch) || e.branch.startsWith('-'))) throw new Error('That branch name cannot be used')
    e.remote = !!c.remote
  } else if (type === 'github') {
    e.what = WHAT.filter(w => (Array.isArray(c.what) ? c.what : []).includes(w))
    if (!e.what.length) throw new Error('Pick at least one GitHub event')
  } else {
    e.ids = [...new Set((Array.isArray(c.ids) ? c.ids : []).map(String))].filter(id => id !== selfId && agents.some(a => a.id === id)).slice(0, 20)
    if (!e.ids.length) throw new Error('Pick the bee to wait for')
    e.on = ON.includes(c.on) ? c.on : 'done'
    const when = String(c.when || '').replace(/\s+/g, ' ').trim().slice(0, 500)
    if (when) { e.when = when; if (c.unsure === 'start') e.unsure = 'start' }
  }
  return e
}

// GitHub: what is new since the last look. st: {prs, runs, since} from before (missing = first look, which only takes note). snap: what gh returned now.
// → {lines: what to tell the bee, st: the state to keep}
const FAILED = ['failure', 'timed_out', 'startup_failure']
function ghDiff(st, snap, what, now = Date.now()) {
  st = st || {}
  const lines = [], next = { ...st }, one = s => String(s || '').replace(/\s+/g, ' ').trim()
  if (what.includes('pr') && Array.isArray(snap.prs)) {
    const seen = new Set(st.prs || [])
    if (st.prs) for (const p of snap.prs) if (!seen.has(p.number)) lines.push(`New pull request #${p.number}: ${one(p.title)}${p.author && p.author.login ? ` (by ${p.author.login})` : ''} ${p.url || ''}`.trim())
    next.prs = [...new Set([...(st.prs || []), ...snap.prs.map(p => p.number)])].slice(-300)
  }
  if (what.includes('ci') && Array.isArray(snap.runs)) {
    const failed = snap.runs.filter(r => r.status === 'completed' && FAILED.includes(r.conclusion)), seen = new Set(st.runs || [])
    if (st.runs) for (const r of failed) if (!seen.has(r.databaseId)) lines.push(`CI failed: ${one(r.name)}${r.headBranch ? ` on ${r.headBranch}` : ''} ${r.url || ''}`.trim())
    next.runs = [...new Set([...(st.runs || []), ...failed.map(r => r.databaseId)])].slice(-300)
  }
  if (what.includes('comment') && Array.isArray(snap.comments)) {
    const since = st.since || 0, fresh = snap.comments.filter(c => Date.parse(c.created_at) > since).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    if (st.since) for (const c of fresh.slice(-10)) lines.push(`New comment by ${(c.user && c.user.login) || 'someone'}: ${one(c.body).slice(0, 300)} ${c.html_url || ''}`.trim())
    next.since = Math.max(since, ...fresh.map(c => Date.parse(c.created_at)), st.since ? 0 : now)
  }
  return { lines, st: next }
}

// Does bee b's event fire when bee a ends a round this way? outcome: 'done' | 'error'
const beeMatch = (b, a, outcome) => !!(b && a && b.id !== a.id && b.schedule && b.schedule.mode === 'event' && b.schedule.event && b.schedule.event.type === 'bee'
  && (b.schedule.event.ids || []).includes(a.id) && (b.schedule.event.on === 'any' || b.schedule.event.on === outcome))

// The prompt of an event run: the bee's standing instruction, then what happened
const eventPrompt = (prompt, title, lines) => `${String(prompt || '').trim()}\n\n--- What happened ---\n${title}${lines && lines.length ? '\n' + lines.join('\n') : ''}`

module.exports = { TYPES, WHAT, ON, parseEvent, ghDiff, beeMatch, eventPrompt }
