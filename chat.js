// Chat window: timeline, Changes tab, approval cards, composer
'use strict'
const $ = s => document.querySelector(s)
const ID = new URLSearchParams(location.search).get('id')
let S = { engines: [], home: '', agents: [] }, A = null, tab = 'chat', atts = [], lastRole = '', changesData = null, changesLoading = false
const el = (cls, html) => { const d = document.createElement('div'); d.className = cls; if (html != null) d.innerHTML = html; return d }
const eng = () => S.engines.find(e => e.id === A.engine) || { label: A.engine, models: [], template: null }
const act = (name, text, opts) => call('action', ID, name, text, opts)
const hmTime = t => hmOf(new Date(t))
const baseDir = () => A.sessionCwd || A.workspace
const isLead = () => Team.isLead(S.agents, A)

// ───────── Timeline ─────────
const tl = $('#tl'), pane = $('#pane-chat')
const nearBottom = () => pane.scrollHeight - pane.scrollTop - pane.clientHeight < 120
const toBottom = () => { pane.scrollTop = pane.scrollHeight }
const WHY = { queen: () => 'From Queen', room: () => 'From group', schedule: () => 'Scheduled', resume: () => 'Auto-resume', handoff: e => `Relay from ${e.from || 'upstream'}`, feedback: e => `Review from ${e.from || 'Reviewer'}` }
const IMG_RE = /(?<![\w:/.~-])((?:~\/|\.{0,2}\/)?[\w\-.@\u4e00-\u9fa5]+(?:\/[\w\-.@\u4e00-\u9fa5]+)*\.(?:png|jpe?g|gif|webp|svg))(?![\w/])/gi

function galleryOf(text, html) {
  const seen = new Set(), out = []
  for (const mm of String(text).matchAll(IMG_RE)) {
    const p = resolvePath(mm[1], baseDir(), S.home)
    if (seen.has(p) || html.includes(esc(fileUrl(p)))) continue
    seen.add(p); out.push(p)
    if (out.length >= 8) break
  }
  if (!out.length) return null
  const g = el('gallery')
  for (const p of out) {
    const img = document.createElement('img')
    img.src = fileUrl(p); img.dataset.img = p; img.title = p; img.loading = 'lazy'
    img.addEventListener('error', () => { img.remove(); if (!g.children.length) g.remove() })      // missing paths leave no empty frame
    g.appendChild(img)
  }
  return g
}

function addEntry(e, live) {
  const stick = nearBottom()
  $('#empty') && $('#empty').remove()
  let node = null
  switch (e.role) {
    case 'user': {
      const tag = WHY[e.why] ? `<span class="u-tag">${esc(WHY[e.why](e))}</span>` : ''
      node = el('step user', `<div class="u-meta">${tag}<time>${hmTime(e.t)}</time></div><div class="u-box${e.text.length > 700 ? ' clip' : ''}">${esc(e.text)}</div>`)
      break
    }
    case 'assistant': {
      const html = renderMd(e.text, baseDir(), S.home)
      node = el('step a', `${lastRole === 'assistant' ? '' : `<span class="mark">${beeSvg(A.color, 'happy', 18)}</span>`}<div class="md">${html}</div>`)
      const g = galleryOf(e.text, html)
      if (g) node.appendChild(g)
      break
    }
    case 'tool':
      node = el('step tool wait', `<span class="dot"></span><div class="t-head"><b>${esc(e.name)}</b> ${esc(String(e.input && e.input.description || '').slice(0, 160))}</div>
        <div class="io"><div class="in"><span class="k">IN</span><span class="v">${esc(String(e.desc || '').split('\n')[0].slice(0, 400))}</span></div></div>`)
      node.dataset.tid = e.tid || ''
      node.title = String(e.desc || '').slice(0, 1200)
      break
    case 'out': {
      const waiting = [...tl.querySelectorAll('.step.tool.wait')]
      const t = waiting.find(n => e.tid && n.dataset.tid === e.tid) || (e.tid ? [...tl.querySelectorAll('.step.tool')].reverse().find(n => n.dataset.tid === e.tid && !n.querySelector('.out')) : null) || waiting[0]
      if (t) {
        t.classList.remove('wait')
        const text = String(e.text || '').trimEnd()
        if (text) {
          const o = el('out' + (text.split('\n').length > 4 || text.length > 320 ? ' long' : ''), `<span class="k">OUT</span><span class="v">${esc(text)}</span>`)
          t.querySelector('.io').appendChild(o)
        }
      }
      break
    }
    case 'error': node = el('step err', `<span class="dot"></span><div class="e-text">${esc(e.text)}</div>`); break
    case 'log': {
      const last = tl.lastElementChild
      if (last && last.classList.contains('logblk')) { last.textContent += '\n' + e.text; last.scrollTop = last.scrollHeight }
      else node = el('logblk', esc(e.text))
      break
    }
    case 'system': node = el('sys', esc(e.text)); break
    case 'run': {
      tl.querySelectorAll('.step.tool.wait').forEach(n => n.classList.remove('wait'))
      const tok = e.tin || e.tout ? `${fmtTok(e.tin || 0)} tok in / ${fmtTok(e.tout || 0)} tok out` : ''
      const parts = e.interrupted ? ['Round interrupted', fmtDur(e.ms || 0)] : ['Round done', fmtDur(e.ms || 0), e.usd ? '$' + e.usd.toFixed(e.usd < 0.1 ? 3 : 2) : '', tok, e.code ? `exit ${e.code}` : e.code == null && e.signal ? e.signal : '']
      node = el('runline', `<span>${parts.filter(Boolean).map(esc).join(' · ')}</span><time>${hmTime(e.t)}</time>`)
      if (live) { loadChanges(true) }
      break
    }
  }
  if (node) tl.appendChild(node)
  if (e.role !== 'out' && e.role !== 'log' && e.role !== 'system') lastRole = e.role
  if (live) { updWorking(); if (stick || e.role === 'user') toBottom() }
}

function updWorking() {
  const on = A.status === 'running' && !tl.querySelector('.step.tool.wait')
  let w = $('#working')
  if (on && !w) { w = el('', '<span class="dot"></span>Working…'); w.id = 'working'; tl.after(w) }
  if (!on && w) w.remove()
}

// ───────── Header ─────────
function renderHead() {
  document.title = `${A.name} · ${A.task}`
  const key = [A.color, A.status].join()
  if ($('#h-bee')._k !== key) { $('#h-bee')._k = key; $('#h-bee').innerHTML = beeOf(A, 26) }
  $('#h-name').textContent = A.name
  $('#h-task').textContent = '· ' + A.task
  $('#h-n').textContent = A.changes && A.changes.files ? A.changes.files : ''
  $('#h-pill').innerHTML = pill(A.status)
  const b = (a, icon, title) => `<button class="btn sm icon ghost" data-h="${a}" title="${title}">${ICON[icon]}</button>`
  const html = (A.status === 'running' ? b('pause', 'pause', 'Pause') : '')
    + (A.status === 'paused' || (A.needsSetup && A.status !== 'setup') || (['stopped', 'error', 'sleeping'].includes(A.status) && A.lastRunAt) ? b('continue', 'play', A.needsSetup ? 'Retry clone' : 'Resume') : '')
    + (['running', 'paused', 'setup'].includes(A.status) ? b('stop', 'stop', 'Stop') : '') + b('reveal', 'finder', 'Show in Finder')
  if ($('#h-btns')._h !== html) { $('#h-btns')._h = html; $('#h-btns').innerHTML = html }
}
$('#h-btns').addEventListener('click', e => {
  const h = (e.target.closest('[data-h]') || {}).dataset
  if (!h) return
  if (h.h === 'reveal') call('reveal', ID)
  else if (h.h === 'stop') { if (confirm(`Stop ${A.name}?`)) act('stop') }
  else act(h.h)
})
function setTab(t) {
  tab = t
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t))
  $('#pane-chat').hidden = t !== 'chat'; $('#pane-changes').hidden = t !== 'changes'
  if (t === 'changes') loadChanges()
  else $('#input').focus()
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab) })

// ───────── Changes ─────────
async function loadChanges(quiet) {
  if (tab !== 'changes' || changesLoading) return
  changesLoading = true
  if (!changesData && !quiet) $('#changes').innerHTML = '<div class="note">Reading changes…</div>'
  const r = await call('changes', ID)
  changesLoading = false
  if (r) { changesData = r; renderChanges() }
}
function diffHtml(chunk) {
  const lines = chunk.split('\n'), at = lines.findIndex(l => l.startsWith('@@'))
  if (at < 0) return `<div class="h">${esc(lines.find(l => /^(Binary|new file|deleted file|rename)/.test(l)) || 'No text changes')}</div>`
  return lines.slice(at).map(l => `<div class="${l[0] === '+' ? 'p' : l[0] === '-' ? 'm' : l.startsWith('@@') ? 'h' : ''}">${esc(l) || ' '}</div>`).join('')
}
function renderChanges() {
  const c = changesData, box = $('#changes')
  if (!c.repo) { box.innerHTML = `<div class="note">Not a git repo<br><br><button class="btn sm" data-c="term">${ICON.terminal}Open in Terminal</button></div>`; return }
  const chunks = {}
  for (const part of c.diff.split(/^(?=diff --git )/m)) { const mm = part.match(/^diff --git a\/.* b\/(.*)$/m); if (mm) chunks[mm[1]] = part }
  const n = c.files.length, running = A.status === 'running' || A.status === 'paused', msg = $('#c-msg') ? $('#c-msg').value : ''
  const open = new Set([...box.querySelectorAll('details[open]')].map(d => d.dataset.f)), had = box.querySelector('details')
  box.innerHTML = `
  <div class="cbar"><div class="br grow ell">${ICON.branch}${esc(c.branch || '(no commits yet)')}${c.isolated ? `<span>· ${c.ahead} ahead of ${esc(c.mainBranch)}</span>` : ''}</div>
    <button class="btn sm ghost" data-c="refresh">${ICON.refresh}Refresh</button><button class="btn sm ghost" data-c="term">${ICON.terminal}Terminal</button>
    ${c.isolated ? `<button class="btn sm" data-c="merge" ${c.ahead > 0 && !n && !running ? '' : 'disabled'} title="${n ? 'Commit first' : c.ahead ? '' : 'No new commits on the branch'}">${ICON.merge}Merge into ${esc(c.mainBranch)}</button>` : ''}
    ${c.origin ? `<button class="btn sm" data-c="pr" ${n ? 'disabled title="Commit first"' : ''}>${ICON.pr}Open PR</button>` : ''}
    ${n ? `<button class="btn sm danger" data-c="discard">Discard</button>` : ''}</div>
  ${n ? `<div class="commit"><input type="text" id="c-msg" placeholder="Commit message" spellcheck="false" value="${esc(msg)}"><button class="btn primary" data-c="commit" ${running ? 'disabled title="Wait for this round to finish"' : ''}>Commit ${n} file${n === 1 ? '' : 's'}</button></div>` : ''}
  ${n ? c.files.map(f => `<details class="file" data-f="${esc(f.file)}" ${(had ? open.has(f.file) : n <= 6) ? 'open' : ''}><summary><span class="grow ell">${esc(f.file)}</span>${f.binary ? '<span class="faint">binary</span>' : `<span class="add">+${f.add}</span><span class="del">−${f.del}</span>`}</summary><div class="diff">${diffHtml(chunks[f.file] || chunks[f.file.replace(/^.* => /, '')] || '')}</div></details>`).join('')
    : `<div class="note">No changes${c.isolated && c.ahead ? `<br>${c.ahead} commit${c.ahead === 1 ? '' : 's'} not merged into ${esc(c.mainBranch)} yet` : ''}</div>`}`
}
$('#changes').addEventListener('click', async e => {
  const b = e.target.closest('[data-c]')
  if (!b || b.disabled) return
  const k = b.dataset.c, again = async ok => { if (ok) { changesData = null; await loadChanges() } }
  if (k === 'refresh') return loadChanges()
  if (k === 'term') return call('terminal', ID)
  if (k === 'commit') { const m = $('#c-msg').value.trim(); if (!m) return $('#c-msg').focus(); b.disabled = true; const ok = await call('commit', ID, m); if (ok) { $('#c-msg').value = ''; toast('Committed') } return again(true) }
  if (k === 'discard') { if (confirm('Discard all uncommitted changes? This cannot be undone.')) again(await call('discard', ID)); return }
  if (k === 'merge') { b.disabled = true; const ok = await call('mergeBack', ID); if (ok) toast(`Merged into ${changesData.mainBranch}`); return again(true) }
  if (k === 'pr') { b.disabled = true; b.textContent = 'Pushing…'; const r = await call('openPr', ID); if (r) toast(r.url ? `Pushed ${r.branch}, opening the PR` : `Pushed ${r.branch}`); return again(true) }
})
$('#changes').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'c-msg' && !e.isComposing) $('[data-c="commit"]').click() })

// ───────── Approvals ─────────
function renderApprovals() {
  const list = A.approvals || [], key = list.map(x => x.id).join()
  const box = $('#approvals')
  if (box._k === key) return
  box._k = key
  box.innerHTML = list.map(r => `<div class="approval"><div class="ttl">${esc(A.name)} wants to use ${esc(r.tool)}${r.desc ? ` <span>· ${esc(r.desc)}</span>` : ''}</div><pre>${esc(r.input)}</pre>
    <div class="acts"><button class="btn primary" data-ap="${r.id}" data-ok="1">Allow</button><button class="btn" data-ap="${r.id}" data-ok="1" data-always="1">Always allow ${esc(r.tool)}</button><button class="btn danger" data-ap="${r.id}">Deny</button></div></div>`).join('')
  const first = box.querySelector('.btn.primary')
  if (first) first.focus()
}
$('#approvals').addEventListener('click', e => { const b = e.target.closest('[data-ap]'); if (b) call('decide', ID, b.dataset.ap, !!b.dataset.ok, !!b.dataset.always) })

// ───────── Composer ─────────
const input = $('#input')
const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(240, input.scrollHeight) + 'px' }
function renderAtts() { $('#atts').innerHTML = atts.map((a, i) => `<span class="att" title="${esc(a.path)}"><span class="ell">${esc(a.name)}</span><button data-rm="${i}" title="Remove">×</button></span>`).join(''); updSend() }
$('#atts').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { atts.splice(+b.dataset.rm, 1); renderAtts() } })
const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s) }
async function addFiles(files) {
  for (const f of files) {
    if (f.size > 50 * 1024 * 1024) { toast(`${f.name} is over 50MB, not added`, 'err'); continue }
    const r = await call('attach', ID, f.name || 'pasted.png', b64(await f.arrayBuffer()))
    if (r) atts.push(r)
  }
  renderAtts()
}
async function pickFiles() {
  const paths = await call('pickFiles', ID)
  for (const p of Array.isArray(paths) ? paths : []) { const r = await call('attachPath', ID, p); if (r) atts.push(r) }
  renderAtts(); input.focus()
}
input.addEventListener('paste', e => { const fs = [...(e.clipboardData ? e.clipboardData.files : [])]; if (fs.length) { e.preventDefault(); addFiles(fs) } })
const comp = $('#composer')
window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); comp.classList.add('drop') } })
window.addEventListener('dragleave', e => { if (!e.relatedTarget) comp.classList.remove('drop') })
window.addEventListener('drop', e => { e.preventDefault(); comp.classList.remove('drop'); const fs = [...(e.dataTransfer ? e.dataTransfer.files : [])]; if (fs.length) addFiles(fs) })
$('#attach').addEventListener('click', pickFiles)

function updSend() {
  const empty = !input.value.trim() && !atts.length, busy = A.status === 'running' || A.status === 'paused'
  const s = $('#send'), stop = empty && busy
  s.className = stop ? 'stop' : ''
  s.title = stop ? 'Stop' : 'Send'
  s.disabled = empty && !busy || A.status === 'setup'
  const html = stop ? ICON.stop : ICON.send
  if (s._h !== html) { s._h = html; s.innerHTML = html }
}
async function send() {
  const text = input.value.trim()
  if (!text && !atts.length) return
  if (A.status === 'setup') return toast('Still setting up the repo')
  if (text.startsWith('/') && !text.includes('\n') && runSlash(text)) return
  const full = (text || 'Take a look at these attachments.') + (atts.length ? `\n\nAttachments (read these paths directly):\n${atts.map(a => '- ' + a.path).join('\n')}` : '')
  input.value = ''; atts = []; renderAtts(); grow(); hideSlash()
  await act('run', full, { relay: !!(A.chatRelay && isLead()) })
}
$('#send').addEventListener('click', () => { if ($('#send').classList.contains('stop')) act('stop'); else send() })

// Slash commands
const SLASH = [
  ['/model', 'Switch model', arg => (arg ? setModel(arg) : toggleModelMenu(true))],
  ['/new', 'New session', () => act('newSession')],
  ['/stop', 'Stop', () => act('stop')],
  ['/diff', 'View changes', () => setTab('changes')],
  ['/attach', 'Attach file', pickFiles],
  ['/term', 'Open terminal', () => call('terminal', ID)],
]
let slashSel = 0, slashList = []
function runSlash(text) {
  const [cmd, ...rest] = text.split(/\s+/), c = SLASH.find(x => x[0] === cmd)
  if (!c) return false
  input.value = ''; grow(); hideSlash(); updSend()
  c[2](rest.join(' '))
  return true
}
const hideSlash = () => { $('#slash').hidden = true }
function updSlash() {
  const v = input.value
  if (!/^\/\S*$/.test(v)) return hideSlash()
  slashList = SLASH.filter(x => x[0].startsWith(v))
  if (!slashList.length) return hideSlash()
  slashSel = Math.min(slashSel, slashList.length - 1)
  const m = $('#slash')
  m.style.left = comp.offsetLeft + 'px'
  m.innerHTML = slashList.map((x, i) => `<button class="mi${i === slashSel ? ' on' : ''}" data-s="${i}"><code>${x[0]}</code><span>${x[1]}</span></button>`).join('')
  m.hidden = false
}
$('#slash').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) { runSlash(slashList[+b.dataset.s][0]); input.focus() } })

input.addEventListener('input', () => { grow(); slashSel = 0; updSlash(); updSend() })
input.addEventListener('keydown', e => {
  if (e.isComposing) return
  if (!$('#slash').hidden) {
    if (e.key === 'ArrowDown' || e.key === 'Tab') { e.preventDefault(); slashSel = (slashSel + 1) % slashList.length; return updSlash() }
    if (e.key === 'ArrowUp') { e.preventDefault(); slashSel = (slashSel + slashList.length - 1) % slashList.length; return updSlash() }
    if (e.key === 'Escape') return hideSlash()
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); return void runSlash(slashList[slashSel][0]) }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
})

// Model pill
async function setModel(m) { if (await call('setModel', ID, m)) toast(`Model: ${m || 'default'}`) }
function toggleModelMenu(open = $('#model-menu').hidden) {
  const m = $('#model-menu'), e = eng()
  if (e.template !== null) open = false
  m.hidden = !open
  if (!open) return
  m.style.left = Math.max(0, comp.offsetLeft + $('#model-pill').offsetLeft - 8) + 'px'
  m.innerHTML = [['', 'Default model'], ...e.models.map(x => [x, x])].map(([v, l]) => `<button class="mi" data-m="${esc(v)}">${esc(l)}${(A.model || '') === v ? '<span class="ck">✓</span>' : ''}</button>`).join('')
    + `<input type="text" id="model-custom" placeholder="Custom model, Enter to confirm" spellcheck="false" value="${esc(e.models.includes(A.model) ? '' : A.model || '')}">`
}
$('#model-pill').addEventListener('click', e => { e.stopPropagation(); toggleModelMenu() })
$('#model-menu').addEventListener('click', e => { e.stopPropagation(); const b = e.target.closest('[data-m]'); if (b) { setModel(b.dataset.m); toggleModelMenu(false) } })
$('#model-menu').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'model-custom' && !e.isComposing) { setModel(e.target.value.trim()); toggleModelMenu(false); input.focus() } if (e.key === 'Escape') toggleModelMenu(false) })
document.addEventListener('click', () => { toggleModelMenu(false) })

$('#relay-toggle').addEventListener('click', () => act('chatRelay', '', { on: !A.chatRelay }))

const PERM = { ask: 'Ask', safe: 'Auto-edit', full: 'Allow all' }
function renderFoot() {
  const e = eng(), lead = isLead(), next = Team.downOf(S.agents, A.id).map(x => x.name).join(', ')
  const pillText = `${e.label}${e.template === null ? ' · ' + (A.model || 'default') + ' ▾' : ''}`
  $('#model-pill').textContent = pillText
  $('#model-pill').disabled = e.template !== null
  $('#perm').textContent = PERM[A.permission === 'ask' && A.engine !== 'claude' ? 'safe' : A.permission] || ''
  const rt = $('#relay-toggle')
  rt.hidden = !lead
  rt.className = 'tool' + (A.chatRelay ? ' on' : '')
  rt.textContent = A.chatRelay ? `Relay → ${next}` : 'No relay'
  rt.title = A.chatRelay ? 'Click to turn off: only this bee handles the message' : 'Click to turn on: hands off downstream when done, running the whole relay'
  // Hint line (by priority)
  const mate = S.agents.find(m => m.id !== A.id && m.workspace === A.workspace && ['running', 'paused'].includes(m.status) && !Team.layerOf(S.agents, A.id).includes(m))
  const q = A.queue ? A.queue.length : 0, ups = Team.upIds(A).length, leadBee = Team.leadOf(S.agents, A.id)
  $('#hint').textContent = mate && A.status !== 'running' ? `${mate.name} is using this folder; your message will queue${q ? ` (${q})` : ''}`
    : A.status === 'running' ? 'Sending a message interrupts the current round'
    : A.status === 'paused' ? 'Paused'
    : A.status === 'setup' ? 'Setting up the repo…'
    : lead ? (A.chatRelay ? `Hands off to ${next} when done` : 'Chat only, no handoff')
    : ups ? `Only ${A.name} handles this; nothing is passed on. Ask ${leadBee ? leadBee.name : 'the lead'} to run the whole chain`
    : q ? `${q} queued` : ''
  updSend(); updTimer()
}
function updTimer() { $('#timer').textContent = A && A.status === 'running' && A.runStart ? fmtDur(Date.now() - A.runStart) : '' }
setInterval(updTimer, 1000)

function renderAll() { renderHead(); renderApprovals(); renderFoot(); updWorking() }

// Images, long messages, long output
document.addEventListener('click', e => {
  const img = e.target.closest('img[data-img]')
  if (img) return void call('openImage', ID, img.dataset.img)
  const u = e.target.closest('.u-box.clip')
  if (u) return u.classList.remove('clip')
  const o = e.target.closest('.out.long:not(.open)')
  if (o) o.classList.add('open')
})
document.addEventListener('keydown', e => {
  if (e.metaKey && e.key === '1') { e.preventDefault(); setTab('chat') }
  if (e.metaKey && e.key === '2') { e.preventDefault(); setTab('changes') }
})

// ───────── Boot ─────────
async function boot() {
  S = await hive.call('init')
  A = S.agents.find(a => a.id === ID)
  if (!A) { document.body.innerHTML = '<div class="note" style="padding:80px;text-align:center">This bee is gone</div>'; return }
  if (new URLSearchParams(location.search).get('tab') === 'changes') setTab('changes')
  const log = await hive.call('log', ID)
  if (Array.isArray(log) && log.length) log.forEach(e => addEntry(e, false))
  else tl.innerHTML = `<div id="empty">${beeSvg(A.color, 'happy', 56, false, 'idle')}<b class="round">${esc(A.name)}</b> is ready</div>`
  renderAll(); toBottom(); input.focus()
  hive.on('agents', list => {
    const me = list.find(a => a.id === ID)
    if (!me) return window.close()
    const was = A.status
    S.agents = list; A = me
    renderAll()
    if (tab === 'changes' && was !== A.status && changesData) renderChanges()
  })
  hive.on('entry', ({ id, entry }) => { if (id === ID) addEntry(entry, true) })
  hive.on('tab', t => setTab(t === 'changes' ? 'changes' : 'chat'))
}
boot()
