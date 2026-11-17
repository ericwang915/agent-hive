// Pure logic: engines and command lines, scheduling, output parsing, relay planning, git / worktree helpers. No Electron dependency.
'use strict'
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process')
const Team = require('./team')
const { upIds } = Team

const MAX_ROUNDS = 3, TEAM_MAX = 4
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bee'

// ───────── Engines ─────────
const m = (flag, a) => (a.model ? [flag, a.model] : [])
// Tools Claude Code lists but cannot run without its own UI; left on, bees try them and get an error
// Also off: Claude Code's own cross-session messaging and scheduling. A bee asked to "tell Wasabi" would otherwise message unrelated Claude sessions on this Mac
const HEADLESS_OFF = 'Artifact,ArtifactComments,ArtifactData,ExitPlanMode,ListAgents,SendMessage,CronCreate,CronDelete,CronList,ScheduleWakeup'
// Kept fixed (no names in it), so it never invalidates a session's prompt cache
const BEE_SYS = 'You are running as a "bee" inside Agent Hive, a desktop app that runs several coding agents side by side. The other bees are separate agents in their own folders; your tools cannot see or reach them. To pass something to another bee, write @Name followed by exactly what you need from it, on a line of its own in your reply: Agent Hive delivers it when the two of you share a group. Schedules are set in the Agent Hive app, not by you.'
// An MCP server's tools are named mcp__<server>__<tool>; disallowing "mcp__<server>" removes all of them from the session
const mcpPrefix = name => 'mcp__' + String(name).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')      // "claude.ai Interactive Brokers (IBKR)" → claude_ai_Interactive_Brokers_IBKR
// What a Claude Code session reports when it starts: its MCP servers (with how many tools each brings) and its skills
function parseInit(o) {
  if (!o || o.type !== 'system' || o.subtype !== 'init') return null
  const tools = Array.isArray(o.tools) ? o.tools.map(String) : []
  const servers = (Array.isArray(o.mcp_servers) ? o.mcp_servers : []).filter(s => s && s.name).map(s => {
    const name = String(s.name), pre = mcpPrefix(name) + '__'
    return { name, label: name.replace(/^claude\.ai /, '').replace(/^plugin:[^:]+:/, ''), source: s.source === 'claudeai' ? 'claude.ai' : s.source === 'plugin' ? 'plugin ' + (name.split(':')[1] || '') : String(s.source || ''), status: String(s.status || ''), tools: tools.filter(t => t.startsWith(pre)).length }
  })
  return { servers, skills: (Array.isArray(o.skills) ? o.skills : []).map(String).sort() }
}
const ENGINES = {
  claude: {
    label: 'Claude Code', cmd: 'claude', models: ['opus', 'sonnet', 'haiku', 'fable'],
    args: (a, p, ctx = {}) => ['-p', p, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--disallowedTools', [HEADLESS_OFF, ...(a.noMcp ? [] : a.mcpOff || []).map(mcpPrefix)].join(','), '--append-system-prompt', BEE_SYS, ...m('--model', a),
      ...(a.permission === 'full' ? ['--dangerously-skip-permissions']
        : a.permission === 'plan' ? ['--permission-mode', 'plan']
        : ['--permission-mode', 'acceptEdits',
          ...(a.permission === 'ask' && ctx.mcp ? ['--mcp-config', ctx.mcp, '--permission-prompt-tool', 'mcp__hive__approve'] : [])]),
      // built-in tools only: leave out the MCP servers from the user's own Claude Code setup (their tool lists ride along on every round)
      ...(a.noMcp ? ['--strict-mcp-config', ...(a.permission === 'ask' && ctx.mcp ? [] : ['--mcp-config', '{"mcpServers":{}}'])] : []),
      ...(a.sessionId ? ['--resume', a.sessionId] : [])],
  },
  codex: {
    label: 'Codex CLI', cmd: 'codex', models: ['gpt-5.3-codex', 'gpt-5.2'],
    args: (a, p) => ['exec', '--json', '--skip-git-repo-check', ...m('-m', a),
      ...(a.permission === 'full' ? ['--dangerously-bypass-approvals-and-sandbox'] : ['-s', 'workspace-write']),
      ...(a.sessionId ? ['resume', a.sessionId] : []), p],
  },
  gemini: {
    label: 'Gemini CLI', cmd: 'gemini', models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    args: (a, p) => ['-p', p, '-o', 'stream-json', '--skip-trust', ...m('-m', a),
      a.permission === 'full' ? '--yolo' : '--approval-mode=auto_edit',
      ...(a.sessionId ? ['--resume', 'latest'] : [])],
  },
  'cursor-agent': {
    label: 'Cursor Agent', cmd: 'cursor-agent', models: [],
    args: (a, p) => ['-p', p, '--output-format', 'stream-json', ...m('--model', a),
      ...(a.permission === 'full' ? ['--force'] : []),
      ...(a.sessionId ? ['--resume', a.sessionId] : [])],
  },
  grok: { label: 'Grok CLI', cmd: 'grok', template: 'grok -p {prompt}' },
  antigravity: { label: 'Antigravity', cmd: 'antigravity', template: 'antigravity chat {prompt}' },
  custom: { label: 'Custom command', cmd: '', template: '' },
}

// Templates are split on whitespace and never go through a shell; {prompt} is replaced by the prompt, or appended if absent
function templateArgs(tpl, prompt) {
  const parts = String(tpl || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) throw new Error('Command template is empty')
  const has = parts.some(x => x.includes('{prompt}'))
  const out = parts.map(x => x.split('{prompt}').join(prompt))
  if (!has) out.push(prompt)
  return out
}

function command(a, prompt, ctx) {
  const e = ENGINES[a.engine]
  if (!e) throw new Error('Unknown engine: ' + a.engine)
  if (e.args) return { cmd: e.cmd, args: e.args(a, prompt, ctx) }
  const out = templateArgs(a.template || e.template, prompt)
  return { cmd: out[0], args: out.slice(1) }
}

const cmdOf = a => { const e = ENGINES[a.engine] || {}; return e.args ? e.cmd : String(a.template || e.template || '').trim().split(/\s+/)[0] || '' }
const validModel = s => s === '' || s == null || (/^[\w.:/[\]=,-]+$/.test(s) && !s.startsWith('-'))

function onPath(cmd, PATH = process.env.PATH || '') {
  if (!cmd) return false
  const ok = p => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile() } catch { return false } }
  return cmd.includes('/') ? ok(cmd) : PATH.split(path.delimiter).some(d => d && ok(path.join(d, cmd)))
}

// ───────── Scheduling ─────────
// Returns the key of the slot that should fire, or null; each key fires only once
function slotKey(s, d = new Date()) {
  if (!s) return null
  switch (s.mode) {
    case 'interval': return 'i' + Math.floor(d.getTime() / (Math.max(1, s.every || 60) * 60000))
    case 'adhoc': return s.at && `${ymd(d)}T${hm(d)}` >= s.at ? 'adhoc ' + s.at : null
    case 'daily': break
    case 'weekdays': if (d.getDay() === 0 || d.getDay() === 6) return null; break
    case 'weekly': if (!(s.days || []).includes(d.getDay())) return null; break
    case 'monthly': {
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      if (d.getDate() !== Math.min(s.dom || 1, last)) return null
      break
    }
    default: return null
  }
  return hm(d) < (s.time || '09:00') ? null : `${ymd(d)} ${s.time || '09:00'}`
}

// ───────── Output parsing ─────────
const num = v => (typeof v === 'number' && isFinite(v) ? v : 0)
function usageOf(o) {
  if (!o || (o.type !== 'result' && o.type !== 'turn.completed')) return null
  const u = o.usage || o.stats || {}
  return {
    tin: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens) + num(u.cached_input_tokens),
    tout: num(u.output_tokens),
    usd: num(o.total_cost_usd),
  }
}

const str = v => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v))
function descOf(input) {
  if (input == null) return ''
  if (typeof input !== 'object') return String(input)
  for (const k of ['command', 'file_path', 'path', 'url', 'query', 'pattern', 'description', 'prompt'])
    if (typeof input[k] === 'string' && input[k]) return input[k]
  const j = JSON.stringify(input)
  return j === '{}' ? '' : j
}
const toolEntry = (name, input, tid) => {
  const desc = descOf(input)
  return { role: 'tool', name: name || 'tool', input, desc, tid, text: `${name || 'tool'}(${desc.split('\n')[0].slice(0, 200)})` }
}
const outEntry = (v, tid) => ({ role: 'out', tid, text: resultText(v).slice(0, 4000) })
function resultText(c) {
  if (Array.isArray(c)) return c.map(x => (x && typeof x === 'object' ? (x.type === 'text' ? x.text || '' : x.type === 'image' ? '[image]' : str(x)) : str(x))).join('\n')
  return str(c)
}

// Should this session be compacted before its next round? → the reason shown to the user, or ''.
// st: {compactAt (percent, 0 = off), compactCold}. A big session that sat idle has lost its prompt cache, so the next round re-reads all of it at full price
const BIG = 100000, COLD_MS = 3600000
function compactWhy(a, st = {}, now = Date.now()) {
  const c = a.context
  if (a.engine !== 'claude' || !a.sessionId || !c || !c.used) return ''
  const pct = c.window ? c.used / c.window * 100 : 0
  if (st.compactAt > 0 && pct >= st.compactAt) return `Context is ${Math.round(pct)}% full (${kTok(c.used)} tokens): compacting first`
  const idle = now - (a.lastEndAt || a.lastRunAt || now)
  if (st.compactCold !== false && c.used >= BIG && idle > COLD_MS) return `This session holds ${kTok(c.used)} tokens and sat idle for ${Math.round(idle / 3600000)} h: compacting first so the round does not re-read all of it`
  return ''
}

// How full the context is, from Claude Code's stream: {used} after each model call or compaction, {window} from the result
function contextOf(o) {
  if (!o || o.parent_tool_use_id) return null          // a sub-agent's calls have their own context
  if (o.type === 'assistant' && o.message && o.message.usage) {
    const u = o.message.usage, used = num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens)
    return used ? { used } : null
  }
  if (o.type === 'system' && o.subtype === 'compact_boundary') { const m = o.compact_metadata || {}; return num(m.post_tokens) ? { used: num(m.post_tokens) } : null }
  if (o.type === 'result' && o.modelUsage && typeof o.modelUsage === 'object') {
    const w = Math.max(0, ...Object.values(o.modelUsage).map(m => num(m && m.contextWindow)))
    return w ? { window: w } : null
  }
  return null
}
const kTok = n => (n >= 1000 ? (n / 1000).toFixed(n < 100000 ? 1 : 0) + 'k' : String(n))

// onPartial: the reply as it is being written ({text}), {thinking: true} while the model thinks, null once the full message has arrived
function makeParser(emit, onSession = () => {}, onUsage = () => {}, onContext = () => {}, onPartial = () => {}) {
  let buf = '', delta = '', plain = [], live = ''
  // Plain-text CLIs: consecutive non-JSON lines become one reply (keeps Markdown tables and lists intact)
  const flushPlain = () => { const t = plain.join('\n').trim(); plain = []; if (t) emit({ role: 'assistant', text: t }) }
  const flush = () => { flushPlain(); if (delta.trim()) emit({ role: 'assistant', text: delta }); delta = '' }
  function line(l) {
    let o = null
    if (l.trim()) try { o = JSON.parse(l) } catch {}
    if (!o || typeof o !== 'object' || Array.isArray(o)) { if (l.trim() || plain.length) plain.push(l); return }
    flushPlain()
    if (o.type === 'stream_event') {
      const ev = o.event || {}
      if (o.parent_tool_use_id) return
      if (ev.type === 'content_block_start') { const k = (ev.content_block || {}).type; if (k === 'text') live = ''; else if (k === 'thinking') onPartial({ thinking: true }) }
      else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { live += str(ev.delta.text); onPartial({ text: live }) }
      return
    }
    const sub = o.parent_tool_use_id ? { sub: true } : {}          // from a sub-agent the bee started
    const sid = o.session_id || o.thread_id || o.sessionId
    if (sid && typeof sid === 'string') onSession(sid)
    const u = usageOf(o)
    if (u) onUsage(u)
    const cx = contextOf(o)
    if (cx) onContext(cx)
    // Gemini: accumulate deltas, flush on the first non-delta
    if (o.type === 'message' && o.role === 'assistant' && o.delta) { delta += str(o.content); return }
    flush()
    switch (o.type) {
      case 'message':
        if (o.role === 'assistant' && o.content) emit({ role: 'assistant', text: str(o.content) })
        break
      case 'tool_use': emit(toolEntry(o.tool_name || o.name, o.parameters || o.input, o.tool_id || o.id)); break
      case 'tool_result': emit(outEntry(o.output != null ? o.output : o.error || '', o.tool_id || o.tool_use_id)); break
      case 'assistant':
        if (!sub.sub) { live = ''; onPartial(null) }
        for (const c of (o.message && Array.isArray(o.message.content) ? o.message.content : [])) {
          if (c.type === 'text' && c.text && c.text.trim()) emit({ role: 'assistant', text: c.text, ...sub })
          else if (c.type === 'tool_use') emit({ ...toolEntry(c.name, c.input, c.id), ...sub })
        }
        break
      case 'user':
        for (const c of (o.message && Array.isArray(o.message.content) ? o.message.content : []))
          if (c.type === 'tool_result') emit({ ...outEntry(c.content, c.tool_use_id), ...sub })
        break
      case 'system':
        if (o.subtype === 'status' && o.status === 'compacting') emit({ role: 'system', text: 'Compacting the conversation…' })
        else if (o.subtype === 'compact_boundary') {
          const m = o.compact_metadata || {}
          emit({ role: 'system', text: `${m.trigger === 'auto' ? 'Context was full; compacted' : 'Compacted'}${num(m.pre_tokens) && num(m.post_tokens) ? `: ${kTok(num(m.pre_tokens))} → ${kTok(num(m.post_tokens))} tokens` : ''}` })
        }
        break
      case 'item.completed': {
        const it = o.item || {}, t = it.type || it.item_type
        if (t === 'agent_message' && it.text) emit({ role: 'assistant', text: it.text })
        else if (t === 'command_execution') {
          emit(toolEntry('Bash', { command: str(it.command) }, it.id))
          emit(outEntry(it.aggregated_output || '', it.id))
        } else if (t === 'file_change') {
          const files = (it.changes || []).map(c => c.path).filter(Boolean)
          emit(toolEntry('Edit', { file_path: files.join(', ') || str(it.path) }, it.id))
        }
        break
      }
      case 'result':
        if (o.is_error) emit({ role: 'error', text: str(o.result || o.error || o.subtype || 'Something went wrong') })
        break
      case 'error': emit({ role: 'error', text: str(o.message || o.error || 'Something went wrong') }); break
      case 'turn.failed': emit({ role: 'error', text: str((o.error && o.error.message) || o.error || o.message || 'This turn failed') }); break
    }
  }
  return {
    feed(chunk) {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop()
      lines.forEach(line)
    },
    flush,           // called by the owner when output pauses, so plain text shows up promptly
    end() { if (buf) line(buf); buf = ''; flush() },
  }
}

// ───────── Relay ─────────
const PRESETS = {
  review: { label: 'Review', prompt: '{from} just finished a round of work. Its summary:\n\n{reply}\n\nReview the changes in the workspace (use git status / git diff). List bugs, edge cases, security issues and anything that could be simpler, ordered by severity. Do not edit the code yourself.' },
  merge: { label: 'Merge', prompt: '{from} have all finished. Their results:\n\n{reply}\n\nCompare and cross-check these results: where they agree, where they differ, and whose is more reliable, then give one final answer. If diffs of their changes in separate worktrees are attached above, apply the final solution you choose in the current workspace.' },
  test: { label: 'Tests', prompt: '{from} just finished a round of work. Its summary:\n\n{reply}\n\nAdd tests for these changes and run them. Report what passed, what failed and why.' },
}
const VERDICT_LINE = 'End with the verdict on its own line: VERDICT: APPROVE (looks good) or VERDICT: CHANGES (needs changes).'

function relayPrompt(after, from, reply) {
  let p = String((after && after.prompt) || PRESETS.review.prompt)
  if (!p.includes('{reply}')) p += '\n\nResult from {from}:\n\n{reply}'
  p = p.split('{from}').join(from).split('{reply}').join(String(reply || '').slice(-16000))
  if (after && after.loop && !/VERDICT/.test(p)) p += '\n\n' + VERDICT_LINE
  return p
}
function verdictOf(text) {
  const all = [...String(text || '').matchAll(/VERDICT:\s*\**\s*(APPROVE|CHANGES)/gi)]
  return all.length ? all[all.length - 1][1].toUpperCase() : null
}
const feedbackPrompt = (name, reply) =>
  `Review feedback from ${name}:\n\n${String(reply || '').slice(-6000)}\n\nRevise the code based on this feedback. When done, briefly say what you changed; if you think a point needs no change, explain why.`

const OFF = { paused: 'is paused', stopped: 'is stopped', setup: 'is still setting up its repo' }

// What to do after a bee finishes a clean run. Pure function; returns steps:
//   {run: id, prompt, why, round, flow, from} | {log: id, text, quiet?} | {inbox: id, value} (null = clear); quiet = no notification
function relayPlan(agents, a, reply, ctx = {}) {
  if (['chat', 'queen', 'room'].includes(ctx.why)) return []   // chats, Queen dispatches and group mentions never trigger a relay
  const ups = upIds(a)
  if (ups.length && ctx.why !== 'handoff') return []        // side chats with a downstream bee do not advance the relay
  const by = id => agents.find(x => x.id === id)
  const round = ctx.round || 0, flow = ctx.flow || null, steps = []

  if (ups.length && a.after.loop) {
    const v = verdictOf(reply), lead = Team.leadOf(agents, a.id)
    if (v === 'CHANGES') {
      if (round + 1 >= MAX_ROUNDS) steps.push({ log: a.id, text: `${MAX_ROUNDS} rounds without approval, stopped for you to take a look` })
      else if (!lead || lead.id === a.id || OFF[lead.status]) steps.push({ log: a.id, text: `Lead ${lead ? lead.name + ' ' + (OFF[lead.status] || '') : 'is gone'}; feedback not sent, relay stopped here` })
      else steps.push({ run: lead.id, prompt: feedbackPrompt(a.name, reply), why: 'feedback', round: round + 1, flow, from: a.name })
      return steps
    }
    if (!v) return [{ log: a.id, text: 'No VERDICT given, relay stopped here' }]
    steps.push({ log: a.id, text: `Approved (round ${round + 1})` })
  }

  const next = agents.filter(b => upIds(b).includes(a.id))
  if (!next.length) {
    if (ups.length) steps.push({ log: a.id, text: 'Chain finished' })
    return steps
  }
  for (const b of next) {
    if (OFF[b.status] || b.needsSetup) { steps.push({ log: b.id, text: `${b.name} ${OFF[b.status] || 'is not ready'}, skipped relay from ${a.name}` }); continue }
    let box = b.inbox
    if (box && box.flow === flow && box.round > round) continue          // stale late result
    if (!box || box.flow !== flow || box.round !== round) box = { flow, round, got: {} }
    box = { flow, round, got: { ...box.got, [a.id]: { name: a.name, reply } } }
    const need = upIds(b).filter(by)
    const missing = need.filter(id => !box.got[id])
    if (missing.length) {
      steps.push({ inbox: b.id, value: box }, { log: b.id, quiet: true, text: `Got ${a.name}'s result, still waiting for ${missing.map(id => by(id).name).join(', ')}` })
      continue
    }
    const got = need.map(id => box.got[id])
    const cut = Math.floor(15000 / got.length)
    const combined = got.length === 1 ? got[0].reply : got.map(g => `### ${g.name}'s result\n\n${String(g.reply || '').slice(-cut)}`).join('\n\n')
    const from = got.map(g => g.name).join(', ')
    steps.push({ inbox: b.id, value: null }, { run: b.id, prompt: relayPrompt(b.after, from, combined), why: 'handoff', round, flow, from })
  }
  return steps
}

// ───────── git / worktree ─────────
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const IDENT = { GIT_AUTHOR_NAME: 'Agent Hive', GIT_AUTHOR_EMAIL: 'hive@localhost', GIT_COMMITTER_NAME: 'Agent Hive', GIT_COMMITTER_EMAIL: 'hive@localhost' }

function git(dir, args, opts = {}) {
  return execFileSync('git', args, {
    cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
  }).replace(/\s+$/, '')
}
const tryGit = (dir, args, opts) => { try { return git(dir, args, opts) } catch { return null } }

function repoInfo(dir) {
  try {
    if (!fs.statSync(dir).isDirectory()) return null
    const top = git(dir, ['rev-parse', '--show-toplevel'])
    return { top, prefix: git(dir, ['rev-parse', '--show-prefix']).replace(/\/$/, '') }
  } catch { return null }
}
const headOf = dir => tryGit(dir, ['rev-parse', '--verify', '-q', 'HEAD'])

// Save the workspace as it is now (untracked files included) as a commit, without touching the user's index / branch
function snapshot(dir, idx) {
  const top = git(dir, ['rev-parse', '--show-toplevel'])
  const real = path.resolve(dir, git(dir, ['rev-parse', '--git-path', 'index']))
  fs.mkdirSync(path.dirname(idx), { recursive: true })
  try { fs.copyFileSync(real, idx) } catch { fs.rmSync(idx, { force: true }) }   // copy the real index for speed
  const env = { GIT_INDEX_FILE: idx, ...IDENT }
  git(top, ['add', '-A', ':/'], { env })
  const tree = git(top, ['write-tree'], { env })
  const head = headOf(top)
  return git(top, ['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', 'hive snapshot'], { env })
}

function syncWorktree(top, wt, snap) {
  if (fs.existsSync(wt)) {
    git(wt, ['checkout', '--detach', '-f', snap])
    git(wt, ['clean', '-fd'])
  } else {
    fs.mkdirSync(path.dirname(wt), { recursive: true })
    tryGit(top, ['worktree', 'prune'])
    git(top, ['worktree', 'add', '--detach', '-f', wt, snap])
  }
}

function worktreeDiff(wt, base, idx, max = 8000) {
  const now = snapshot(wt, idx)
  const stat = git(wt, ['diff', '--stat', base, now])
  if (!stat) return ''
  return (stat + '\n\n' + git(wt, ['diff', base, now])).slice(0, max)
}

const wtPath = (a, top) => path.join(path.dirname(top), '.hive-worktrees', `${path.basename(top)}-${slug(a.name)}-${a.id.slice(0, 4)}`)

const validGitUrl = s => typeof s === 'string' && !s.startsWith('-') && /^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:|\/|~\/)\S+$/.test(s)
const validBranch = s => typeof s === 'string' && /^[\w./-]+$/.test(s) && !s.startsWith('-') && !s.includes('..')

// What binding a remote takes: {kind, cmds: [{cwd, args}]}; kind = clone | same | remote | init | error
function gitSteps(ws, url, branch) {
  let st = null
  try { st = fs.statSync(ws) } catch {}
  if (st && !st.isDirectory()) return { kind: 'error', error: 'This path is a file, not a folder', cmds: [] }
  const empty = !st || fs.readdirSync(ws).filter(f => f !== '.DS_Store').length === 0
  if (empty) return { kind: 'clone', cmds: [{ cwd: path.dirname(ws), args: ['clone', ...(branch ? ['--branch', branch] : []), '--', url, ws] }] }
  const info = repoInfo(ws)
  if (info && path.resolve(info.top) === fs.realpathSync(ws)) {
    const origin = tryGit(ws, ['remote', 'get-url', 'origin'])
    if (!origin) return { kind: 'remote', cmds: [{ cwd: ws, args: ['remote', 'add', 'origin', url] }] }
    if (sameUrl(origin, url)) return { kind: 'same', cmds: [] }
    return { kind: 'error', error: `This folder is already bound to another remote: ${origin}`, origin, cmds: [] }
  }
  return { kind: 'init', cmds: [{ cwd: ws, args: ['init'] }, { cwd: ws, args: ['remote', 'add', 'origin', url] }] }
}
const normUrl = u => String(u || '').trim().replace(/\/+$/, '').replace(/\.git$/, '')
const sameUrl = (a, b) => normUrl(a) === normUrl(b)
function gitPlanText(plan) {
  return {
    clone: 'Folder is empty; the repo will be cloned into it on hatch',
    remote: 'Folder is a git repo with no origin; origin will be added (no fetch, nothing overwritten)',
    init: 'Folder already has files; will run git init and add origin (no fetch, existing files untouched)',
    same: 'Folder is already bound to this remote; nothing to do',
    error: plan.error || 'Cannot bind',
  }[plan.kind]
}

// origin → {host, repo: 'owner/repo'}; null for local paths
function parseRemote(origin) {
  const s = String(origin || '').trim()
  const mm = s.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/) || s.match(/^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/)
  return mm ? { host: mm[1], repo: mm[2] } : null
}
function prUrl(origin, branch) {
  const r = parseRemote(origin)
  if (!r) return null
  const b = String(branch).split('/').map(encodeURIComponent).join('/')
  return /gitlab/i.test(r.host)
    ? `https://${r.host}/${r.repo}/-/merge_requests/new?merge_request[source_branch]=${b}`
    : `https://${r.host}/${r.repo}/compare/${b}?expand=1`
}
const repoLabel = url => { const r = parseRemote(url); return r ? r.repo : path.basename(String(url || '').replace(/\.git$/, '').replace(/\/+$/, '')) }

// ───────── Name pool ─────────
const NAMES = ['Bumble', 'Honey', 'Buzz', 'Pollen', 'Nectar', 'Clover', 'Maple', 'Sunny', 'Pip', 'Mochi', 'Peanut', 'Biscuit',
  'Waffle', 'Pudding', 'Daisy', 'Poppy', 'Willow', 'Hazel', 'Olive', 'Basil', 'Sage', 'Juniper', 'Fern', 'Moss', 'Pebble',
  'Sprout', 'Truffle', 'Cocoa', 'Latte', 'Miso', 'Tofu', 'Kiwi', 'Mango', 'Peach', 'Plum', 'Fig', 'Lemon', 'Ginger', 'Pepper',
  'Nutmeg', 'Saffron', 'Acorn', 'Bramble', 'Thistle', 'Marigold', 'Dandelion', 'Buttercup', 'Zinnia']
// Unused names first; once all are taken, append a number
function pickName(used = [], rnd = Math.random) {
  const taken = new Set(used.map(s => String(s).toLowerCase()))
  const free = NAMES.filter(n => !taken.has(n.toLowerCase()))
  if (free.length) return free[Math.floor(rnd() * free.length)]
  for (let i = 2; ; i++) { const n = NAMES[Math.floor(rnd() * NAMES.length)] + i; if (!taken.has(n.toLowerCase())) return n }
}

module.exports = { HEADLESS_OFF, BEE_SYS, mcpPrefix, parseInit,
  MAX_ROUNDS, TEAM_MAX, ENGINES, command, templateArgs, cmdOf, validModel, onPath, slotKey, usageOf, contextOf, compactWhy, BIG, makeParser, descOf,
  PRESETS, relayPrompt, verdictOf, feedbackPrompt, relayPlan,
  EMPTY_TREE, git, tryGit, repoInfo, headOf, snapshot, syncWorktree, worktreeDiff, wtPath,
  validGitUrl, validBranch, gitSteps, gitPlanText, sameUrl, parseRemote, prUrl, repoLabel,
  NAMES, pickName, slug, ymd, hm, pad,
}
