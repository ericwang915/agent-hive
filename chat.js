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
const WHY = { event: () => 'Event', squad: e => `Squad job from ${e.from || 'the group'}`, queen: () => 'From Queen', room: () => 'From group', schedule: () => 'Scheduled', resume: () => 'Auto-resume', handoff: e => `Relay from ${e.from || 'upstream'}`, feedback: e => `Review from ${e.from || 'Reviewer'}` }
const IMG_RE = /(?<![\w:/.~-])((?:~\/|\.{0,2}\/)?[\w\-.@\u4e00-\u9fa5]+(?:\/[\w\-.@\u4e00-\u9fa5]+)*\.(?:png|jpe?g|gif|webp|svg))(?![\w/])/gi

function galleryOf(text, html, stamp) {
  const seen = new Set(), out = []
  for (const mm of String(text).matchAll(IMG_RE)) {
    const p = resolvePath(mm[1], baseDir(), S.home)
    if (seen.has(p) || html.includes(esc(fileUrl(p)))) continue
    seen.add(p); out.push(p)
    if (out.length >= 8) break
  }
  if (!out.length) return null
  const g = el('gallery' + (out.length === 1 ? ' one' : ''))
  for (const p of out) {
    const img = document.createElement('img')
    img.src = fileUrl(p) + (stamp ? '?' + stamp : ''); img.dataset.img = p; img.title = p      // the stamp shows a re-made image, not the cached one
    img.addEventListener('error', () => { img.remove(); g.classList.toggle('one', g.children.length === 1); if (!g.children.length) g.remove() })      // missing paths leave no empty frame
    g.appendChild(img)
  }
  return g
}

// Paths written in the conversation become clickable once the main process confirms something is there
const PATHISH = /^(?:~\/|\.{0,2}\/)?[\w\-.@+\u4e00-\u9fa5]+(?:\/[\w\-.@+ \u4e00-\u9fa5]+)*\/?(?::\d+(?::\d+)?)?$/
let fpQueue = [], fpTimer = null
function markPaths(node) {
  for (const c of node.querySelectorAll('.md code')) {
    const t = c.textContent.trim()
    if (!c.closest('pre') && t.length < 300 && /[/.]/.test(t) && PATHISH.test(t)) c.dataset.fp = t
  }
  for (const a of node.querySelectorAll('.md a')) {
    let h = a.getAttribute('href') || ''
    if (!h || h.startsWith('#') || (/^[a-z][a-z0-9+.-]*:/i.test(h) && !/^file:/i.test(h))) continue
    try { h = decodeURIComponent(h) } catch {}
    a.dataset.fp = h; a.removeAttribute('target')
  }
  queuePaths(node)
}
function queuePaths(node) {
  fpQueue.push(...[...node.querySelectorAll('[data-fp]')].filter(n => !n._loc))
  if (fpQueue.length && !fpTimer) fpTimer = setTimeout(flushPaths, 40)
}
async function flushPaths() {
  const els = fpQueue.splice(0, 400)
  const r = await hive.call('locate', ID, els.map(n => n.dataset.fp))
  fpTimer = fpQueue.length ? setTimeout(flushPaths, 40) : null
  if (!Array.isArray(r)) return
  els.forEach((n, i) => {
    if (!r[i]) return
    n._loc = r[i]; n.classList.add('fp')
    n.title = `${r[i].rel || r[i].abs}\n${r[i].rel == null && r[i].dir ? 'Click to show in Finder' : 'Click to open · ⌘-click to show in Finder'}`
  })
}

// The reply while it is being written; the finished message replaces it
let liveNode = null, thinking = false
function setLive(p) {
  const stick = nearBottom()
  thinking = !!(p && p.thinking)
  if (p && p.text) {
    if (!liveNode) { liveNode = el('step a live', `${lastRole === 'assistant' ? '' : `<span class="mark">${beeFace(A, 18)}</span>`}<div class="md"></div>`); tl.appendChild(liveNode) }
    liveNode.querySelector('.md').innerHTML = renderMd(p.text, baseDir(), S.home)
  } else if (liveNode && !thinking) { liveNode.remove(); liveNode = null }
  updWorking()
  if (stick) toBottom()
}
// Edit and Write calls show what changed, like a diff
const diffLines = (s, sign, cls, max) => {
  const ls = String(s).replace(/\n$/, '').split('\n')
  return ls.slice(0, max).map(l => `<div class="${cls}">${sign} ${esc(l)}</div>`).join('') + (ls.length > max ? `<div class="h">… ${ls.length - max} more line${ls.length - max === 1 ? '' : 's'}</div>` : '')
}
function editDiff(name, i) {
  const pair = (o, n) => (o ? diffLines(o, '-', 'm', 30) : '') + (n ? diffLines(n, '+', 'p', 30) : '')
  const h = typeof i.old_string === 'string' && typeof i.new_string === 'string' ? pair(i.old_string, i.new_string)
    : Array.isArray(i.edits) ? i.edits.slice(0, 8).map(x => pair(String((x && x.old_string) || ''), String((x && x.new_string) || ''))).join('<div class="h">⋯</div>')
    : name === 'Write' && typeof i.content === 'string' ? diffLines(i.content, '+', 'p', 24) : ''
  return h ? `<div class="diff tdiff">${h}</div>` : ''
}

function addEntry(e, live) {
  const stick = nearBottom()
  if (live && liveNode) { liveNode.remove(); liveNode = null }
  const sub = e.sub ? ' sub' : ''
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
      node = el('step a' + sub, `${lastRole === 'assistant' || sub ? '' : `<span class="mark">${beeFace(A, 18)}</span>`}<div class="md">${html}</div>`)
      const g = galleryOf(e.text, html, e.t)
      if (g) node.appendChild(g)
      markPaths(node)
      break
    }
    case 'tool':
      node = el('step tool wait' + sub, `<span class="dot"></span><div class="t-head"><b>${esc(e.name)}</b> ${esc(String(e.input && e.input.description || '').slice(0, 160))}</div>
        <div class="io"><div class="in"><span class="k">IN</span><span class="v">${esc(String(e.desc || '').split('\n')[0].slice(0, 400))}</span></div></div>${e.input && typeof e.input === 'object' ? editDiff(e.name, e.input) : ''}`)
      node.dataset.tid = e.tid || ''
      node.title = String(e.desc || '').slice(0, 1200)
      { const fp = e.input && (e.input.file_path || e.input.path); if (typeof fp === 'string' && fp) { node.querySelector('.in .v').dataset.fp = fp; queuePaths(node) } }
      break
    case 'out': {
      const waiting = [...tl.querySelectorAll('.step.tool.wait')]
      const t = waiting.find(n => e.tid && n.dataset.tid === e.tid) || (e.tid ? [...tl.querySelectorAll('.step.tool')].reverse().find(n => n.dataset.tid === e.tid && !n.querySelector('.out')) : null) || waiting[0]
      if (t) {
        t.classList.remove('wait')
        queuePaths(t)          // a file this tool just created exists now
        const text = String(e.text || '').trimEnd()
        if (text) {
          const o = el('out' + (text.split('\n').length > 4 || text.length > 320 ? ' long' : ''), `<span class="k">OUT</span><span class="v">${esc(text)}</span>`)
          t.querySelector('.io').appendChild(o)
        }
        if (/^(Edit|MultiEdit|Write)$/.test(t.querySelector('.t-head b').textContent) && t.querySelector('.tdiff') && text.length < 400 && !/error/i.test(text)) { const o = t.querySelector('.out'); if (o) o.remove() }      // the diff already says it
        const g = t.querySelector('.gallery') ? null : galleryOf(t.title + '\n' + text, '', e.t)      // pictures the tool made or read
        if (g) t.appendChild(g)
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
    case 'system': { const m = e.gate && /^(.*?\.)( .*)?$/s.exec(e.text); node = el('sys', m ? `<b class="gate-${esc(e.gate)}">${esc(m[1])}</b>${esc(m[2] || '')}` : esc(e.text)); break }
    case 'run': {
      tl.querySelectorAll('.step.tool.wait').forEach(n => n.classList.remove('wait'))
      const tok = e.tin || e.tout ? `${fmtTok(e.tin || 0)} in / ${fmtTok(e.tout || 0)} out` : ''
      const parts = e.interrupted ? ['Round interrupted', fmtDur(e.ms || 0)] : ['Round done', fmtDur(e.ms || 0), e.usd ? '$' + e.usd.toFixed(e.usd < 0.1 ? 3 : 2) : '', tok, e.code ? `exit ${e.code}` : e.code == null && e.signal ? e.signal : '']
      node = el('runline', `<span>${parts.filter(Boolean).map(esc).join(' · ')}</span><time>${hmTime(e.t)}</time>`)
      if (live) { loadChanges(true); refreshFiles(); if (tab === 'media') loadMedia(true) }
      break
    }
  }
  if (node) tl.appendChild(node)
  if (e.role !== 'out' && e.role !== 'log' && e.role !== 'system' && !e.sub) lastRole = e.role
  if (e.role === 'user' && !WHY[e.why] && e.text && sent[sent.length - 1] !== e.text) sent.push(e.text)
  if (live) { updWorking(); if (stick || e.role === 'user') toBottom() }
}

function updWorking() {
  const on = A.status === 'running' && !tl.querySelector('.step.tool.wait') && !liveNode
  let w = $('#working')
  if (on && !w) { w = el('', '<span class="dot"></span><span class="wt"></span>'); w.id = 'working'; tl.after(w) }
  if (on) w.querySelector('.wt').textContent = thinking ? 'Thinking…' : 'Working…'
  if (!on && w) w.remove()
}

// ───────── Header ─────────
function renderHead() {
  document.title = `${A.name} · ${A.task}`
  const key = [A.color, A.status, rankOf(A.xp).i].join()
  if ($('#h-bee')._k !== key) { $('#h-bee')._k = key; $('#h-bee').innerHTML = beeOf(A, 26) }
  if ($('#h-rank')) $('#h-rank').innerHTML = rankChip(A)
  $('#h-name').textContent = A.name
  $('#h-task').textContent = '· ' + A.task; $('#h-task').title = 'Browse files'
  $('#h-n').textContent = A.changes && A.changes.files ? A.changes.files : ''
  $('#h-pill').innerHTML = pill(A.status)
  const b = (a, icon, title, on) => `<button class="btn sm icon ghost${on ? ' on' : ''}" data-h="${a}" title="${title}">${ICON[icon]}</button>`
  const html = (A.status === 'running' ? b('pause', 'pause', 'Pause') : '')
    + (A.status === 'paused' || (A.needsSetup && A.status !== 'setup') || (['stopped', 'error', 'sleeping'].includes(A.status) && A.lastRunAt) ? b('continue', 'play', A.needsSetup ? 'Retry clone' : 'Resume') : '')
    + (['running', 'paused', 'setup'].includes(A.status) ? b('stop', 'stop', 'Stop') : '') + b('edit', 'gear', 'Settings') + b('term', 'terminal', 'Terminal (⌃`)', !$('#term').hidden) + b('side', 'folder', 'Files sidebar (⌘B)')
  if ($('#h-btns')._h !== html) { $('#h-btns')._h = html; $('#h-btns').innerHTML = html }
}
$('#h-btns').addEventListener('click', e => {
  const h = (e.target.closest('[data-h]') || {}).dataset
  if (!h) return
  if (h.h === 'side') setSide($('#tree').hidden)
  else if (h.h === 'term') toggleTerm()
  else if (h.h === 'edit') hive.call('editBee', A.id)
  else if (h.h === 'stop') { if (confirm(`Stop ${A.name}?`)) act('stop') }
  else act(h.h)
})
function setTab(t) {
  tab = t
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t))
  for (const k of ['chat', 'changes', 'files', 'media']) $('#pane-' + k).hidden = t !== k
  if (t !== 'media') stopMedia()
  if (t === 'changes') loadChanges()
  else if (t === 'media') loadMedia()
  else if (t === 'files') setSide(true)
  else $('#input').focus()
}
$('#h-task').addEventListener('click', () => setSide(true))
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

// ───────── Files ─────────
// input: a name being typed in the tree ({kind: file | folder | rename, dir, from}); mode: tree | search
const F = { kids: new Map(), open: new Set(), sel: '', selDir: false, line: 0, ready: false, cur: null, input: null, mode: 'tree', q: '', found: null }
const parentOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const baseOf = p => p.slice(p.lastIndexOf('/') + 1)
const fmtSize = n => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
const ed = () => $('#ed')
const dirty = () => !!(F.cur && F.cur.kind === 'text' && ed() && ed().value !== F.cur.text)
async function loadDir(rel, quiet) {
  const r = quiet ? await hive.call('ls', ID, rel) : await call('ls', ID, rel)
  if (r && r.items) F.kids.set(rel, r)
  else { F.kids.delete(rel); F.open.delete(rel) }
  return !!(r && r.items)
}
const padOf = depth => `style="padding-left:${6 + depth * 14}px"`
const nameInput = depth => `<div class="tn edit" ${padOf(depth)}><span class="tw"></span>${F.input.kind === 'folder' ? ICON.folder : ''}<input type="text" id="t-name" spellcheck="false" autocomplete="off" value="${esc(F.input.kind === 'rename' ? baseOf(F.input.from) : '')}" placeholder="${F.input.kind === 'folder' ? 'Folder name' : F.input.kind === 'file' ? 'File name' : ''}"></div>`
function treeHtml(rel, depth) {
  const k = F.kids.get(rel)
  if (!k) return ''
  const pad = padOf(depth), inp = F.input
  return (inp && inp.kind !== 'rename' && inp.dir === rel ? nameInput(depth) : '') + k.items.map(it => {
    const p = rel ? rel + '/' + it.name : it.name, open = it.dir && F.open.has(p)
    if (inp && inp.kind === 'rename' && inp.from === p) return nameInput(depth) + (open ? treeHtml(p, depth + 1) : '')
    return `<div class="tn${p === F.sel ? ' on' : ''}" data-p="${esc(p)}"${it.dir ? ' data-d="1"' : ''} ${pad} title="${esc(p)}"><span class="tw">${it.dir ? (open ? '▾' : '▸') : ''}</span>${it.dir ? ICON.folder : ''}<span class="ell">${esc(it.name)}</span></div>${open ? treeHtml(p, depth + 1) : ''}`
  }).join('') + (k.more ? `<div class="tn more" ${pad}><span class="tw"></span>${k.more} more not shown</div>` : '')
}
const tbtn = (t, icon, title, on) => `<button class="btn sm icon ghost${on ? ' on' : ''}" data-t="${t}" title="${title}">${icon}</button>`
function renderTree() {
  const k = F.kids.get(''), head = `<div class="thead"><span class="grow ell">${esc(A.task)}</span>${tbtn('file', ICON.newFile, 'New file')}${tbtn('folder', ICON.newFolder, 'New folder')}${tbtn('search', ICON.search, 'Search in files ⇧⌘F', F.mode === 'search')}${tbtn('refresh', ICON.refresh, 'Refresh')}</div>`
  if (F.mode === 'search') {
    const keep = $('#t-q') ? [$('#t-q').selectionStart, $('#t-q').selectionEnd] : null
    $('#tree').innerHTML = head + `<div class="tsearch"><input type="text" id="t-q" spellcheck="false" autocomplete="off" placeholder="File name or text" value="${esc(F.q)}"></div><div id="t-found">${foundHtml()}</div>`
    if (keep) { $('#t-q').focus(); $('#t-q').setSelectionRange(keep[0], keep[1]) }
    return
  }
  $('#tree').innerHTML = head + (k && !k.items.length && !F.input ? '<div class="tn more"><span class="tw"></span>Empty folder</div>' : treeHtml('', 0))
  const inp = $('#t-name')
  if (inp) { inp.focus(); const dot = inp.value.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 ? dot : inp.value.length); inp.scrollIntoView({ block: 'nearest' }) }
}
// Search: file names first, then lines that contain the text
const markHit = h => `${esc(h.text.slice(0, h.col))}<b>${esc(h.text.slice(h.col, h.col + F.q.length))}</b>${esc(h.text.slice(h.col + F.q.length))}`
function foundHtml() {
  const f = F.found
  if (!F.q.trim()) return '<div class="tnote">Type to find files by name and lines by text. A capital letter makes it case-sensitive.</div>'
  if (!f) return '<div class="tnote">Searching…</div>'
  if (!f.names.length && !f.hits.length) return '<div class="tnote">Nothing found</div>'
  const groups = new Map()
  for (const h of f.hits) (groups.get(h.rel) || groups.set(h.rel, []).get(h.rel)).push(h)
  return (f.names.length ? '<div class="tsec">Files</div>' + f.names.map(p => `<div class="tn" data-p="${esc(p.replace(/\/$/, ''))}"${p.endsWith('/') ? ' data-d="1"' : ''} title="${esc(p)}">${p.endsWith('/') ? ICON.folder : ''}<span class="ell">${esc(baseOf(p.replace(/\/$/, '')))}</span><span class="tdir ell">${esc(parentOf(p.replace(/\/$/, '')))}</span></div>`).join('') : '')
    + (f.hits.length ? `<div class="tsec">Text${f.more ? ' · first 200 shown' : ` · ${f.hits.length}`}</div>` + [...groups].map(([rel, hs]) => `<div class="tn tfile" data-p="${esc(rel)}" title="${esc(rel)}"><span class="ell">${esc(baseOf(rel))}</span><span class="tdir ell">${esc(parentOf(rel))}</span><span class="tcount">${hs.length}</span></div>`
      + hs.map(h => `<div class="tn thit" data-p="${esc(rel)}" data-line="${h.line}"><span class="tl">${h.line}</span><span class="ell">${markHit(h)}</span></div>`).join('')).join('') : '')
}
let searchSeq = 0, searchTimer = null
function runSearch() {
  clearTimeout(searchTimer)
  const q = F.q, seq = ++searchSeq
  F.found = null
  if ($('#t-found')) $('#t-found').innerHTML = foundHtml()
  if (!q.trim()) return
  searchTimer = setTimeout(async () => {
    const [names, g] = await Promise.all([hive.call('findFiles', ID, q.trim()), hive.call('grepFiles', ID, q)])
    if (seq !== searchSeq) return
    F.found = { names: Array.isArray(names) ? names : [], hits: (g && g.hits) || [], more: !!(g && g.more) }
    if ($('#t-found')) $('#t-found').innerHTML = foundHtml()
  }, 180)
}
function setSearch(on, q) {
  setSide(true)
  F.mode = on ? 'search' : 'tree'; F.input = null
  if (on && typeof q === 'string' && q) { F.q = q; runSearch() }
  renderTree()
  if (on) { $('#t-q').focus(); $('#t-q').select() }
}

// The viewer is an editor for text files inside the folder. Line numbers and the text scroll together
const lineCount = t => t.split('\n').length
function renderView() {
  const v = $('#view'), c = F.cur
  if (!c) { v.innerHTML = '<div class="note">Pick a file to read or edit it</div>'; return }
  const canEdit = c.kind === 'text' && !c.cut && !c.outside
  const bar = `<div class="vbar"><button class="btn sm ghost vback" data-v="back" title="Back to the conversation (Esc)">← Chat</button><span class="vdot" id="v-dot" hidden title="Unsaved changes">●</span><span class="grow ell" title="${esc(c.abs)}">${esc(c.rel)}</span><span class="sz" id="v-sz">${fmtSize(c.size)}${c.cut ? ' · first 400 KB shown, read-only' : c.kind === 'text' && c.outside ? ' · outside the folder, read-only' : ''}</span>`
    + (c.kind === 'text' ? `<button class="btn sm icon ghost" data-v="find" title="Find ⌘F">${ICON.search}</button>` : '') + (canEdit ? `<button class="btn sm" data-v="save" id="v-save" disabled title="Save ⌘S">Save</button>` : '')
    + `<button class="btn sm icon ghost" data-v="reveal" title="Show in Finder">${ICON.finder}</button></div>`
  if (c.kind === 'image') v.innerHTML = `${bar}<div class="vbody"><div class="vimg"><img src="${esc(fileUrl(c.abs))}" alt=""></div></div>`
  else if (c.kind === 'binary') v.innerHTML = `${bar}<div class="vbody"><div class="note">Binary file, not shown</div></div>`
  else {
    const n = lineCount(c.text)
    const hl = F.line > 0 && F.line <= n ? `<div class="hl" id="v-hl" style="top:${10 + (F.line - 1) * 19}px"></div>` : ''
    v.innerHTML = `${bar}<div class="vfind" id="v-find" hidden><input type="text" id="f-q" spellcheck="false" autocomplete="off" placeholder="Find"><span id="f-n"></span><button class="btn sm icon ghost" data-v="prev" title="Previous ⇧↩">↑</button><button class="btn sm icon ghost" data-v="next" title="Next ↩">↓</button><button class="btn sm icon ghost" data-v="find-x" title="Close Esc">${ICON.x}</button></div>
      <div class="vbody"><div class="code">${hl}<div class="fhl" id="v-fhl" hidden></div><div class="ln" id="v-ln">${Array.from({ length: n }, (_, i) => i + 1).join('\n')}</div><textarea id="ed" spellcheck="false" wrap="off" autocomplete="off" autocapitalize="off"${canEdit ? '' : ' readonly'}></textarea></div></div>`
    ed().value = c.text
    if (hl) v.querySelector('.vbody').scrollTop = Math.max(0, (F.line - 6) * 19)
  }
}
function markDirty() {
  const d = dirty()
  if ($('#v-dot')) $('#v-dot').hidden = !d
  if ($('#v-save')) $('#v-save').disabled = !d
  const n = lineCount(ed().value), ln = $('#v-ln')
  if (ln && ln.childElementCount === 0 && ln.textContent.split('\n').length !== n) ln.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n')
  if ($('#v-hl')) $('#v-hl').remove()
}
async function saveFile(force) {
  const c = F.cur
  if (!c || !dirty()) return
  const text = ed().value, r = await call('writeFile', ID, c.rel, text, { mtime: c.mtime, force: !!force })
  if (!r) return
  if (r.changed) { if (confirm(`${baseOf(c.rel)} was changed on disk since you opened it, probably by the bee.\n\nSave your version over it?`)) return saveFile(true); return }
  c.text = text; c.size = r.size; c.mtime = r.mtime
  if ($('#v-sz')) $('#v-sz').textContent = fmtSize(c.size)
  markDirty(); toast('Saved')
  if (typeof loadChanges === 'function' && tab === 'changes') loadChanges(true)
}
// Leaving a file with unsaved edits asks first
const leaveOk = () => !dirty() || confirm(`Discard the unsaved changes to ${baseOf(F.cur.rel)}?`)
async function openFile(rel, line, quiet) {
  if (!quiet && F.cur && F.cur.rel !== rel && !leaveOk()) return false
  if (quiet && dirty()) return false                     // a round ended while you were typing: your text stays
  const r = quiet ? await hive.call('readFile', ID, rel) : await call('readFile', ID, rel)
  if (!r || r.error) { if (quiet) { if (F.sel === rel) F.sel = ''; F.cur = null; renderView() } return false }
  if (!quiet && F.cur && F.cur.rel === rel && dirty()) { F.line = line || 0; return true }      // same file, edits in progress: keep them
  const top = quiet && $('#view .vbody') ? $('#view .vbody').scrollTop : 0
  F.sel = rel; F.selDir = false; F.line = line || 0; F.cur = { ...r, rel, outside: /^(\/|~)/.test(rel) }
  renderView()
  if (quiet && $('#view .vbody')) $('#view .vbody').scrollTop = top
  return true
}
async function openFiles() {
  if (F.ready) return
  F.ready = true
  await loadDir('')
  renderTree()
}
// The folder tree sits to the left of every tab
function setSide(on) {
  $('#tree').hidden = !on
  try { localStorage.setItem('hive-side', on ? '1' : '0') } catch {}
  if (on) openFiles()
}
// Jump to a file or folder: open its parents, select it, scroll it into view
async function showPath(rel, dir, line) {
  if (dir) setSide(true)
  else setTab('files')
  if (!F.kids.has('')) await loadDir('')
  const chain = []
  for (let p = dir ? rel : parentOf(rel); p; p = parentOf(p)) chain.unshift(p)
  for (const p of chain) { if (!F.kids.has(p) && !(await loadDir(p))) break; F.open.add(p) }
  if (dir) { F.sel = rel; F.selDir = true }
  else await openFile(rel, line)
  renderTree()
  const on = $('#tree .tn.on')
  if (on) on.scrollIntoView({ block: 'nearest' })
}
// After a round: re-read the open folders and the open file
async function refreshFiles() {
  if (!F.ready) return
  await loadDir('', true)
  for (const p of [...F.open].sort()) await loadDir(p, true)
  if (F.cur && !F.cur.outside) { const keep = F.sel, kd = F.selDir; await openFile(F.cur.rel, F.line, true); if (F.cur) { F.sel = keep; F.selDir = kd } }
  if (F.input) return
  renderTree()
  if (F.mode === 'search' && F.q.trim()) runSearch()
}

// New file / new folder / rename: a name typed right in the tree
const targetDir = () => (F.sel && !F.sel.startsWith('/') ? (F.selDir ? F.sel : parentOf(F.sel)) : '')
async function startNew(kind, dir = targetDir()) {
  setSide(true); F.mode = 'tree'
  if (dir && !F.kids.has(dir) && !(await loadDir(dir))) dir = ''
  for (let p = dir; p; p = parentOf(p)) { if (!F.kids.has(p)) await loadDir(p); F.open.add(p) }
  F.input = { kind, dir }
  renderTree()
}
function startRename(p) { F.mode = 'tree'; F.input = { kind: 'rename', from: p, dir: parentOf(p) }; renderTree() }
// Paths under a renamed or deleted entry: remap(from, to) rewrites them, to === null drops them
function remap(from, to) {
  const fix = p => (p === from || p.startsWith(from + '/') ? (to === null ? null : to + p.slice(from.length)) : p)
  F.open = new Set([...F.open].map(fix).filter(x => x !== null))
  for (const k of [...F.kids.keys()]) if (fix(k) !== k) F.kids.delete(k)
  if (F.sel) { const s = fix(F.sel); if (s === null) { F.sel = ''; F.selDir = false } else F.sel = s }
  if (F.cur) { const c = fix(F.cur.rel); if (c === null) { F.cur = null; renderView() } else if (c !== F.cur.rel) { F.cur.rel = c; F.cur.abs = ''; const bar = $('#view .vbar .ell'); if (bar) { bar.textContent = c; bar.title = c } } }
}
let committing = false
async function commitName(ok) {
  const inp = F.input, el = $('#t-name')
  if (!inp || committing) return
  const name = el ? el.value.trim() : ''
  F.input = null
  if (!ok || !name || (inp.kind === 'rename' && name === baseOf(inp.from))) return renderTree()
  committing = true
  try {
    const to = (inp.dir ? inp.dir + '/' : '') + name
    if (inp.kind === 'rename') {
      const r = await call('renamePath', ID, inp.from, to)
      if (r) remap(inp.from, r.rel)
    } else {
      const r = await call('newPath', ID, to, inp.kind === 'folder')
      if (r) {
        for (let p = parentOf(r.rel); p; p = parentOf(p)) F.open.add(p)       // "a/b/c.txt" typed as a name is refused by the backend; this covers the folder it went into
        if (r.dir) { F.sel = r.rel; F.selDir = true; F.open.add(r.rel) }
        else { await refreshFiles(); setTab('files'); await openFile(r.rel); renderTree(); if (ed()) ed().focus(); return }
      }
    }
    await refreshFiles()
  } finally { committing = false; renderTree() }
}
async function trashPath(p, isDir) {
  if (!confirm(`Move ${baseOf(p)}${isDir ? ' and everything in it' : ''} to the Trash?`)) return
  if (F.cur && (F.cur.rel === p || F.cur.rel.startsWith(p + '/')) && dirty() && !confirm(`${baseOf(F.cur.rel)} has unsaved changes. Delete anyway?`)) return
  if (!(await call('trashPath', ID, p))) return
  remap(p, null)
  await refreshFiles()
}
async function copyPath(p, abs) {
  let text = p
  if (abs) { const l = await hive.call('locate', ID, [p]); text = (Array.isArray(l) && l[0] && l[0].abs) || p }
  try { await navigator.clipboard.writeText(text); toast('Copied') } catch { toast('Could not copy', 'err') }
}

// Right-click menu
function popMenu(x, y, items) {
  closeMenu()
  const m = document.createElement('div')
  m.id = 'ctx'
  m.innerHTML = items.map((it, i) => (it ? `<button data-i="${i}"${it.danger ? ' class="danger"' : ''}>${esc(it.label)}${it.key ? `<span>${esc(it.key)}</span>` : ''}</button>` : '<hr>')).join('')
  document.body.appendChild(m)
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px'; m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px'
  m.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; closeMenu(); items[+b.dataset.i].run() })
}
function closeMenu() { const m = $('#ctx'); if (m) m.remove() }
document.addEventListener('mousedown', e => { if (!e.target.closest('#ctx')) closeMenu() })
window.addEventListener('blur', closeMenu)
$('#tree').addEventListener('contextmenu', e => {
  if (e.target.closest('input')) return
  e.preventDefault()
  const n = e.target.closest('.tn[data-p]'), p = n ? n.dataset.p : '', isDir = !n || !!n.dataset.d, dir = n ? (isDir ? p : parentOf(p)) : ''
  if (n && F.mode === 'tree') { F.sel = p; F.selDir = isDir; renderTree() }
  popMenu(e.clientX, e.clientY, [
    { label: 'New file', run: () => startNew('file', dir) }, { label: 'New folder', run: () => startNew('folder', dir) },
    ...(n ? [null, { label: 'Rename', run: () => startRename(p) }, { label: 'Move to Trash', key: '⌘⌫', danger: true, run: () => trashPath(p, isDir) }] : []),
    null, { label: 'Search in files', key: '⇧⌘F', run: () => setSearch(true) },
    { label: 'Copy path', run: () => copyPath(p, true) }, ...(n ? [{ label: 'Copy relative path', run: () => copyPath(p) }] : []),
    { label: 'Show in Finder', run: () => (n ? call('revealPath', ID, p) : call('reveal', ID)) },
  ])
})
$('#tree').addEventListener('click', async e => {
  if (e.target.closest('input')) return
  const t = e.target.closest('[data-t]')
  if (t) { const k = t.dataset.t; return k === 'file' || k === 'folder' ? startNew(k) : k === 'search' ? setSearch(F.mode !== 'search') : refreshFiles() }
  const n = e.target.closest('.tn[data-p]')
  if (!n) return
  const p = n.dataset.p
  if (e.metaKey) return call('revealPath', ID, p)
  if (F.mode === 'search') return n.dataset.d ? (F.mode = 'tree', showPath(p, true)) : (setTab('files'), void openFile(p, +n.dataset.line || 0))
  if (!n.dataset.d) { setTab('files'); await openFile(p); return renderTree() }
  F.sel = p; F.selDir = true
  if (F.open.has(p)) F.open.delete(p)
  else if (F.kids.has(p) || await loadDir(p)) F.open.add(p)
  renderTree()
})
$('#tree').addEventListener('keydown', e => {
  if (e.target.id === 't-name') { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commitName(true) } else if (e.key === 'Escape') { e.preventDefault(); commitName(false) } }
  if (e.target.id === 't-q' && e.key === 'Escape') { e.preventDefault(); setSearch(false) }
})
$('#tree').addEventListener('focusout', e => { if (e.target.id === 't-name') setTimeout(() => { if (F.input && document.activeElement !== $('#t-name')) commitName(true) }, 0) })
$('#tree').addEventListener('input', e => { if (e.target.id === 't-q') { F.q = e.target.value; runSearch() } })

// Find in the open file: the match is drawn over the text, and the caret is placed on it
const FIND = { hits: [], at: -1 }
let meter = null
function textWidth(s) {
  if (!meter) { meter = document.createElement('canvas').getContext('2d'); meter.font = getComputedStyle(ed()).font }
  let out = ''
  for (const ch of s) out += ch === '\t' ? ' '.repeat(2 - (out.length % 2)) : ch
  return meter.measureText(out).width
}
function findAll() {
  const q = $('#f-q').value, text = ed().value, strict = /[A-Z]/.test(q), hay = strict ? text : text.toLowerCase(), needle = strict ? q : q.toLowerCase()
  FIND.hits = []
  if (needle) for (let i = hay.indexOf(needle); i >= 0 && FIND.hits.length < 5000; i = hay.indexOf(needle, i + needle.length)) FIND.hits.push(i)
  return needle.length
}
function showHit(step, keepFocus) {
  const len = findAll(), box = $('#v-fhl'), n = FIND.hits.length
  if (!n) { FIND.at = -1; box.hidden = true; $('#f-n').textContent = $('#f-q').value ? 'No results' : ''; return }
  if (step === 0) { const caret = ed().selectionStart; FIND.at = Math.max(0, FIND.hits.findIndex(i => i >= caret)) }
  else FIND.at = ((FIND.at < 0 ? 0 : FIND.at + step) % n + n) % n
  const i = FIND.hits[FIND.at], text = ed().value, start = text.lastIndexOf('\n', i - 1) + 1, row = text.slice(0, i).split('\n').length - 1
  const left = $('#v-ln').offsetWidth + textWidth(text.slice(start, i)), width = Math.max(4, textWidth(text.slice(start, i + len)) - textWidth(text.slice(start, i)))
  box.hidden = false; box.style.cssText = `top:${10 + row * 19}px;left:${left}px;width:${width}px`
  $('#f-n').textContent = `${FIND.at + 1} of ${n}${n >= 5000 ? '+' : ''}`
  const body = $('#view .vbody')
  if (10 + row * 19 < body.scrollTop + 30 || 10 + row * 19 > body.scrollTop + body.clientHeight - 50) body.scrollTop = Math.max(0, row * 19 - body.clientHeight / 3)
  if (left < body.scrollLeft + 60 || left + width > body.scrollLeft + body.clientWidth - 20) body.scrollLeft = Math.max(0, left - body.clientWidth / 2)
  ed().setSelectionRange(i, i + len)
  if (!keepFocus) $('#f-q').focus()
}
function openFind() {
  if (!F.cur || F.cur.kind !== 'text' || !ed()) return
  const sel = ed().value.slice(ed().selectionStart, ed().selectionEnd)
  $('#v-find').hidden = false
  if (sel && !sel.includes('\n') && sel.length < 200) $('#f-q').value = sel
  $('#f-q').focus(); $('#f-q').select()
  showHit(0)
}
function closeFind() { if ($('#v-find')) { $('#v-find').hidden = true; $('#v-fhl').hidden = true; ed().focus() } }
$('#view').addEventListener('click', e => {
  const b = e.target.closest('[data-v]')
  if (!b || !F.cur) return
  const k = b.dataset.v
  if (k === 'back') setTab('chat')
  else if (k === 'reveal') call('revealPath', ID, F.cur.rel)
  else if (k === 'save') saveFile()
  else if (k === 'find') ($('#v-find').hidden ? openFind() : closeFind())
  else if (k === 'next') showHit(1)
  else if (k === 'prev') showHit(-1)
  else if (k === 'find-x') closeFind()
})
$('#view').addEventListener('input', e => {
  if (e.target.id === 'ed') { markDirty(); if ($('#v-find') && !$('#v-find').hidden) $('#v-fhl').hidden = true }
  if (e.target.id === 'f-q') showHit(0)
})
$('#view').addEventListener('keydown', e => {
  if (e.target.id === 'f-q') {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); showHit(e.shiftKey ? -1 : 1) }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind() }
  }
  if (e.target.id === 'ed') {
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.readOnly) { e.preventDefault(); document.execCommand('insertText', false, '  ') }
    else if (e.key === 'Escape' && $('#v-find') && !$('#v-find').hidden) closeFind()
  }
})

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
  input.value = ''; atts = []; renderAtts(); grow(); hideSlash(); men = null; histAt = -1
  await act('run', full, { relay: !!(A.chatRelay && isLead()) })
}
$('#send').addEventListener('click', () => { if ($('#send').classList.contains('stop')) act('stop'); else send() })

// Compaction is Claude Code's own /compact, run on the bee's session
function compact(note) {
  if (A.engine !== 'claude') return toast('Only Claude Code bees can compact')
  if (!A.sessionId) return toast('Nothing to compact yet')
  if (A.status === 'running' || A.status === 'paused') return toast('Wait for this round to finish')
  act('run', ('/compact ' + (note || '')).trim(), { relay: false })
}
$('#cmeter').addEventListener('click', () => compact(''))

// Slash commands
const SLASH = [
  ['/model', 'Switch model', arg => (arg ? setModel(arg) : toggleModelMenu(true))],
  ['/compact', 'Summarise the conversation to free up context', arg => compact(arg)],
  ['/new', 'New session', () => act('newSession')],
  ['/stop', 'Stop', () => act('stop')],
  ['/diff', 'View changes', () => setTab('changes')],
  ['/files', 'Browse files', () => setTab('files')],
  ['/media', 'Pictures, documents, pages, video and audio in the folder', () => setTab('media')],
  ['/attach', 'Attach file', pickFiles],
  ['/term', 'Show or hide the terminal', () => toggleTerm()],
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
// @ completes a file or folder from the bee's folder
let men = null, menSeq = 0
async function updMention() {
  const pos = input.selectionStart, mm = input.value.slice(0, pos).match(/(?:^|\s)@([^\s@]*)$/), seq = ++menSeq
  if (!mm) { if (men) { men = null; hideSlash() } return }
  const items = await hive.call('findFiles', ID, mm[1])
  if (seq !== menSeq) return
  if (!Array.isArray(items) || !items.length) { men = null; return hideSlash() }
  men = { start: pos - mm[1].length - 1, end: pos, items, sel: 0 }
  renderMention()
}
function renderMention() {
  const m = $('#slash')
  m.style.left = comp.offsetLeft + 'px'
  m.innerHTML = men.items.map((p, i) => `<button class="mi f${i === men.sel ? ' on' : ''}" data-f="${i}"><code>${esc(p)}</code></button>`).join('')
  m.hidden = false
}
function pickMention(i) {
  const p = men.items[i], v = input.value, head = v.slice(0, men.start) + '@' + p + (p.endsWith('/') ? '' : ' ')
  input.value = head + v.slice(men.end); input.selectionStart = input.selectionEnd = head.length
  men = null; hideSlash(); grow(); updSend(); input.focus()
  if (p.endsWith('/')) updMention()          // keep going into the folder
}
// ↑ / ↓ on an empty box walk back through what you sent
const sent = []
let histAt = -1
function history(step) {
  const i = histAt + step
  if (i < -1 || i >= sent.length) return false
  histAt = i
  input.value = i < 0 ? '' : sent[sent.length - 1 - i]
  grow(); updSend(); input.selectionStart = input.selectionEnd = input.value.length
  return true
}
function updSlash() {
  const v = input.value
  if (!/^\/\S*$/.test(v)) { if (!men) hideSlash(); return }
  men = null
  slashList = SLASH.filter(x => x[0].startsWith(v))
  if (!slashList.length) return hideSlash()
  slashSel = Math.min(slashSel, slashList.length - 1)
  const m = $('#slash')
  m.style.left = comp.offsetLeft + 'px'
  m.innerHTML = slashList.map((x, i) => `<button class="mi${i === slashSel ? ' on' : ''}" data-s="${i}"><code>${x[0]}</code><span>${x[1]}</span></button>`).join('')
  m.hidden = false
}
$('#slash').addEventListener('click', e => {
  const f = e.target.closest('[data-f]')
  if (f && men) return pickMention(+f.dataset.f)
  const b = e.target.closest('[data-s]'); if (b) { runSlash(slashList[+b.dataset.s][0]); input.focus() }
})

input.addEventListener('input', () => { grow(); slashSel = 0; histAt = -1; updSlash(); updMention(); updSend() })
input.addEventListener('keydown', e => {
  if (e.isComposing) return
  if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); return cyclePerm() }
  if (men && !$('#slash').hidden) {
    if (e.key === 'ArrowDown') { e.preventDefault(); men.sel = (men.sel + 1) % men.items.length; return renderMention() }
    if (e.key === 'ArrowUp') { e.preventDefault(); men.sel = (men.sel + men.items.length - 1) % men.items.length; return renderMention() }
    if (e.key === 'Escape') { men = null; return hideSlash() }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); return pickMention(men.sel) }
  } else if (!$('#slash').hidden) {
    if (e.key === 'ArrowDown' || e.key === 'Tab') { e.preventDefault(); slashSel = (slashSel + 1) % slashList.length; return updSlash() }
    if (e.key === 'ArrowUp') { e.preventDefault(); slashSel = (slashSel + slashList.length - 1) % slashList.length; return updSlash() }
    if (e.key === 'Escape') return hideSlash()
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); return void runSlash(slashList[slashSel][0]) }
  }
  if (e.key === 'ArrowUp' && (!input.value || histAt >= 0) && history(1)) return e.preventDefault()
  if (e.key === 'ArrowDown' && histAt >= 0 && history(-1)) return e.preventDefault()
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
})

// Model pill
async function setModel(m) { if (await call('setModel', ID, m)) toast(`Model: ${m ? modelName(eng(), m) : 'default'}`) }
// A short list is a plain menu. A long one (Cursor and Antigravity report dozens) gets a search box and chips grouped by maker
const MANY = 8
function toggleModelMenu(open = $('#model-menu').hidden) {
  const m = $('#model-menu'), e = eng(), many = e.models.length > MANY
  if (e.template !== null) open = false
  m.hidden = !open
  if (!open) return
  m.classList.toggle('wide', many)
  m.style.left = Math.max(0, comp.offsetLeft + $('#model-pill').offsetLeft - 8) + 'px'
  m.innerHTML = many ? `<input type="search" id="model-q" placeholder="Search, or type a model name" spellcheck="false"><div id="model-list"></div>`
    : `<div id="model-list"></div><input type="text" id="model-custom" placeholder="Custom model, Enter to confirm" spellcheck="false" value="${esc(e.models.includes(A.model) ? '' : A.model || '')}">`
  fillModels('')
  // a narrow window: pull the menu back inside it
  const over = m.getBoundingClientRect().right - (innerWidth - 8)
  if (over > 0) m.style.left = (parseFloat(m.style.left) - over) + 'px'
  if (many) { $('#model-q').focus(); $('#model-list .mvar.on, #model-list .ck')?.scrollIntoView({ block: 'nearest' }) }
}
function fillModels(text) {
  const e = eng(), cur = A.model || '', el = $('#model-list')
  if (e.models.length <= MANY) return void (el.innerHTML = [['', 'Default model'], ...e.models.map(x => [x, modelName(e, x)])].map(([v, l]) => `<button class="mi" data-m="${esc(v)}" title="${esc(v)}">${esc(l)}${cur === v ? '<span class="ck">✓</span>' : ''}</button>`).join(''))
  const q = text.trim(), words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hit = e.models.filter(x => { const t = (x + ' ' + modelName(e, x)).toLowerCase(); return words.every(w => t.includes(w)) })
  // "Gemini 4 Neon (High)" and its siblings become one row, "Gemini 4 Neon", with Low / Medium / High to pick from
  const fams = new Map()
  for (const x of hit) {
    const n = modelName(e, x), mm = n.match(/^(.*\S)\s*\(([^()]+)\)$/), f = familyOf(x)
    if (!fams.has(f)) fams.set(f, new Map())
    const rows = fams.get(f), base = mm ? mm[1] : n
    rows.set(base, [...(rows.get(base) || []), { id: x, v: mm ? mm[2] : '' }])
  }
  const rank = v => { const k = LEVELS.indexOf(v.toLowerCase()); return k < 0 ? 99 : k }
  const one = (v, l, t) => `<button class="mi" data-m="${esc(v)}" title="${esc(t || v)}">${esc(l)}${cur === v ? '<span class="ck">✓</span>' : ''}</button>`
  const row = ([base, xs]) => xs.length === 1 ? one(xs[0].id, base + (xs[0].v ? ` (${xs[0].v})` : ''))
    : `<div class="mrow${xs.some(x => x.id === cur) ? ' on' : ''}"><span class="ell">${esc(base)}</span><div class="mvars">${xs.sort((a, b) => rank(a.v) - rank(b.v)).map(x => `<button class="mvar${cur === x.id ? ' on' : ''}" data-m="${esc(x.id)}" title="${esc(x.id)}">${esc(x.v || 'Standard')}</button>`).join('')}</div></div>`
  el.innerHTML = (q ? '' : one('', 'Default model', "The CLI's own default") + (cur && !e.models.includes(cur) ? one(cur, cur) : ''))
    + [...fams].map(([f, rows]) => `<div class="mfam">${f}</div>${[...rows].map(row).join('')}`).join('')
    + (q && !hit.length ? `<div class="mfam">No match</div>${one(q, `Use "${q}"`)}` : '')
}
const LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
$('#model-pill').addEventListener('click', e => { e.stopPropagation(); toggleModelMenu() })
$('#model-menu').addEventListener('click', e => { e.stopPropagation(); const b = e.target.closest('[data-m]'); if (b) { setModel(b.dataset.m); toggleModelMenu(false); input.focus() } })
$('#model-menu').addEventListener('input', e => { if (e.target.id === 'model-q') fillModels(e.target.value) })
$('#model-menu').addEventListener('keydown', e => {
  if (e.key === 'Escape') { toggleModelMenu(false); return input.focus() }
  if (e.key !== 'Enter' || e.isComposing) return
  // Enter in the search box takes the first match
  // ...but only once something was typed: with an empty box the first row is "Default model", and Enter would quietly reset the bee
  const m = e.target.id === 'model-custom' ? e.target.value.trim() : e.target.id === 'model-q' && e.target.value.trim() ? $('#model-list [data-m]')?.dataset.m : null
  if (m == null) return
  setModel(m); toggleModelMenu(false); input.focus()
})
document.addEventListener('click', () => { toggleModelMenu(false); togglePermMenu(false) })

$('#relay-toggle').addEventListener('click', () => act('chatRelay', '', { on: !A.chatRelay }))

const PERM = { plan: 'Plan', ask: 'Ask', safe: 'Auto-edit', full: 'Allow all' }
const PERM_HINT = { plan: 'Reads and proposes a plan, changes nothing', ask: 'Waits for your OK on every action', safe: 'Edits files without asking', full: 'Never asks' }
const permNow = () => (A.engine !== 'claude' && (A.permission === 'ask' || A.permission === 'plan') ? 'safe' : A.permission)
const permChoices = () => (A.engine === 'claude' ? ['plan', 'ask', 'safe', 'full'] : ['safe', 'full'])
function togglePermMenu(open = $('#perm-menu').hidden) {
  const m = $('#perm-menu')
  m.hidden = !open
  if (!open) return
  m.style.left = 'auto'; m.style.right = (comp.parentElement.clientWidth - comp.offsetLeft - comp.offsetWidth) + 'px'
  m.innerHTML = permChoices().map(k => `<button class="mi" data-pm="${k}"><b>${PERM[k]}</b><span>${PERM_HINT[k]}</span>${permNow() === k ? '<span class="ck">✓</span>' : ''}</button>`).join('')
}
$('#perm').addEventListener('click', e => { e.stopPropagation(); togglePermMenu() })
$('#perm-menu').addEventListener('click', e => { const b = e.target.closest('[data-pm]'); if (b) call('setPermission', ID, b.dataset.pm) })
// Shift-Tab steps through the modes that still ask or plan; Allow all is only reachable from the menu
function cyclePerm() {
  if (A.engine !== 'claude') return
  const ring = ['ask', 'safe', 'plan'], i = ring.indexOf(A.permission)
  call('setPermission', ID, ring[(i + 1) % ring.length])
}
function renderFoot() {
  const e = eng(), lead = isLead(), next = Team.downOf(S.agents, A.id).map(x => x.name).join(', ')
  const pillText = `${e.label}${e.template === null ? ' · ' + (A.model ? modelName(e, A.model) : 'default') + ' ▾' : ''}`
  $('#model-pill').textContent = pillText
  $('#model-pill').disabled = e.template !== null
  const cx = A.context, cb = $('#cmeter'), pct = cx && cx.used && cx.window ? Math.min(100, Math.round(cx.used / cx.window * 100)) : null
  cb.hidden = !(cx && cx.used && A.sessionId)
  cb.textContent = pct != null ? `Context ${pct}%` : cx ? `Context ${fmtTok(cx.used)}` : ''
  cb.className = 'tool' + (pct >= 80 ? ' warn' : '')
  cb.title = cx ? `${fmtTok(cx.used || 0)}${cx.window ? ' of ' + fmtTok(cx.window) : ''} in this session. Claude Code compacts on its own when it fills up; click to compact now.` : ''
  $('#perm').textContent = (PERM[permNow()] || '') + ' ▾'; $('#perm').className = 'tool' + (permNow() === 'plan' ? ' plan' : ''); $('#perm').title = (PERM_HINT[permNow()] || '') + (A.engine === 'claude' ? ' (Shift-Tab to switch)' : '')
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
  if (img) { if (e.metaKey) return void call('revealPath', ID, img.dataset.img); setTab('files'); return void openFile(img.dataset.img).then(renderTree) }
  const fp = e.target.closest('[data-fp]')
  if (fp) {
    if (fp.tagName === 'A') e.preventDefault()
    const l = fp._loc
    if (!l || !getSelection().isCollapsed) return
    if (e.metaKey || (l.rel == null && l.dir)) return void call('revealPath', ID, fp.dataset.fp)
    if (l.rel == null) { setTab('files'); return void openFile(l.abs, l.line).then(renderTree) }      // outside the folder: read it, nothing to select in the tree
    return void showPath(l.rel, l.dir, l.line)
  }
  const u = e.target.closest('.u-box.clip')
  if (u) return u.classList.remove('clip')
  const o = e.target.closest('.out.long:not(.open)')
  if (o) o.classList.add('open')
})
document.addEventListener('keydown', e => {
  if (e.metaKey && e.key === '1') { e.preventDefault(); setTab('chat') }
  if (e.metaKey && e.key === '2') { e.preventDefault(); setTab('changes') }
  if (e.metaKey && e.key === '3') { e.preventDefault(); setTab('files') }
  if (e.metaKey && e.key === '4') { e.preventDefault(); setTab('media') }
  if (e.ctrlKey && !e.metaKey && e.code === 'Backquote') { e.preventDefault(); return void (e.shiftKey ? (showTerm(true), newTerm()) : toggleTerm()) }
  if (e.target.closest && e.target.closest('#term')) return          // keys typed in the terminal belong to the shell
  if (e.key === 'Escape' && tab === 'media' && !e.defaultPrevented && !$('#ctx')) { e.preventDefault(); if (M.cur) closeMedia(); else setTab('chat') }
  if (e.metaKey && e.key === 'b') { e.preventDefault(); setSide($('#tree').hidden) }
  // Esc leaves the file and goes back to the conversation, unless it is closing something smaller first
  if (e.key === 'Escape' && tab === 'files' && !e.defaultPrevented && !$('#ctx') && !(e.target.closest && e.target.closest('#tree input, #v-find')) && !($('#v-find') && !$('#v-find').hidden)) { e.preventDefault(); setTab('chat') }
  if (e.metaKey && !e.shiftKey && e.key === 's' && tab === 'files') { e.preventDefault(); saveFile() }
  if (e.metaKey && !e.shiftKey && e.key === 'f' && tab === 'files' && F.cur && F.cur.kind === 'text') { e.preventDefault(); openFind() }
  if (e.metaKey && ((e.shiftKey && e.key.toLowerCase() === 'f') || (!e.shiftKey && e.key === 'p'))) { e.preventDefault(); setSearch(true) }
  if (e.metaKey && e.key === 'Backspace' && F.sel && !F.sel.startsWith('/') && F.mode === 'tree' && !$('#tree').hidden && !e.target.closest('input, textarea, [contenteditable]')) { e.preventDefault(); trashPath(F.sel, F.selDir) }
})

// Arriving from the Files page: show that file, selected in the tree when it lies in the folder
async function openFromOutside(p) {
  const l = await hive.call('locate', ID, [p]), hit = Array.isArray(l) && l[0]
  if (!hit) return toast('That file is no longer there', 'err')
  if (hit.rel != null) return showPath(hit.rel, hit.dir, 0)
  setTab('files'); await openFile(hit.abs); renderTree()
}

// Arriving from a search: show the latest place in the conversation that mentions the text, selected
function findInChat(q) {
  setTab('chat')
  input.blur(); getSelection().removeAllRanges()
  if (!window.find(q, false, true, true)) return toast('Not in the part of the conversation shown here')
  const n = getSelection().anchorNode, el = n && (n.nodeType === 1 ? n : n.parentElement)
  if (el && !tl.contains(el)) { getSelection().removeAllRanges(); return }
  if (el) el.scrollIntoView({ block: 'center' })
}

// ───────── Media ─────────
// Everything in the folder that is meant to be looked at or listened to, newest first. cur: the one being previewed
const M = { data: null, kind: 'all', cur: null }
const MKINDS = [['all', 'All'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Audio'], ['web', 'Web pages'], ['doc', 'Docs']]
const extOf = p => (/\.([A-Za-z0-9]{1,8})$/.exec(p) || ['', ''])[1].toLowerCase()
const mUrl = m => fileUrl(m.abs) + '?' + Math.round(m.mtime)          // a re-made file shows, not the cached one
async function loadMedia(quiet) {
  if (!M.data && !quiet) renderMedia()
  let r = null
  try { r = await hive.call('media', ID) } catch {}
  if (!r || !r.items) { if (!quiet) toast((r && r.error) || 'Could not read the folder', 'err'); return }
  M.data = r
  if (M.cur) { const again = r.items.find(m => m.rel === M.cur.rel); if (!again) M.cur = null; else if (again.mtime === M.cur.mtime) return; else M.cur = again }
  renderMedia()
}
function mediaCard(m, i) {
  const ext = extOf(m.rel)
  const thumb = m.kind === 'image' ? `<img loading="lazy" src="${esc(mUrl(m))}" alt="">`
    : m.kind === 'video' ? `<video preload="metadata" muted src="${esc(mUrl(m))}#t=0.1"></video><span class="badge">${ICON.play}</span>`
      : `<span class="ext">${esc(ext)}</span>`
  return `<button class="mcard" data-m="${i}" title="${esc(m.rel)}"><div class="mthumb k-${m.kind}">${thumb}${m.kind === 'image' || m.kind === 'video' ? `<span class="badge r">${esc(ext)}</span>` : ''}</div>
    <div class="mcap"><b>${esc(baseOf(m.rel))}</b><span>${esc([parentOf(m.rel), fmtSize(m.size), ago(m.mtime)].filter(Boolean).join(' · '))}</span></div></button>`
}
function renderMedia() {
  const el = $('#media'), d = M.data
  if (M.cur) return renderMediaView()
  if (!d) { el.innerHTML = '<div class="note">Looking through the folder…</div>'; return }
  const n = k => (k === 'all' ? d.items.length : d.items.filter(m => m.kind === k).length)
  if (M.kind !== 'all' && !n(M.kind)) M.kind = 'all'
  M.shown = d.items.filter(m => M.kind === 'all' || m.kind === M.kind)
  const chips = MKINDS.filter(([k]) => k === 'all' || n(k)).map(([k, label]) => `<button class="mchip${M.kind === k ? ' on' : ''}" data-mk="${k}">${label} <span class="n">${n(k)}</span></button>`).join('')
  el.innerHTML = `<div class="mbar">${chips}<span class="grow"></span><button class="btn sm ghost" data-mv="refresh">Refresh</button></div>`
    + (d.items.length ? `<div class="mgrid">${M.shown.map(mediaCard).join('')}${d.more ? `<div class="mfoot">Showing the newest ${d.items.length}. ${d.more} older ones are not listed</div>` : ''}</div>`
      : '<div class="note">No pictures, documents, web pages, video or audio in this folder yet</div>')
}
async function renderMediaView() {
  const el = $('#media'), m = M.cur, ext = extOf(m.rel)
  const asText = m.kind === 'doc' && ['md', 'markdown', 'txt', 'csv', 'tsv'].includes(ext), inFiles = m.kind === 'image' || m.kind === 'web' || asText
  const bar = `<div class="vbar"><button class="btn sm ghost vback" data-mv="back" title="Back to the list (Esc)">← Media</button><span class="grow ell" title="${esc(m.abs)}">${esc(m.rel)}</span><span class="sz">${fmtSize(m.size)}</span>`
    + (inFiles ? `<button class="btn sm ghost" data-mv="files" title="Open in the Files tab">${m.kind === 'image' ? 'In Files' : 'Edit'}</button>` : '') + `<button class="btn sm" data-mv="open" title="Open in its own app">Open</button><button class="btn sm icon ghost" data-mv="reveal" title="Show in Finder">${ICON.finder}</button></div>`
  let body = ''
  if (m.kind === 'image') body = `<div class="stage"><div class="vimg"><img src="${esc(mUrl(m))}" alt=""></div></div>`
  else if (m.kind === 'video') body = `<div class="stage"><video controls src="${esc(mUrl(m))}"></video></div>`
  else if (m.kind === 'audio') body = `<div class="stage"><audio controls src="${esc(mUrl(m))}"></audio></div>`
  else if (m.kind === 'web') body = `<iframe sandbox="allow-scripts" src="${esc(mUrl(m))}"></iframe>`          // the page runs on its own: no access to this window, links do not leave it
  else if (asText) {
    const r = await hive.call('readFile', ID, m.rel).catch(() => null)
    if (M.cur !== m) return
    if (!r || r.kind !== 'text') body = '<div class="note">This file could not be read as text. Use Open to see it in its own app</div>'
    else body = (ext === 'md' || ext === 'markdown' ? `<div class="mdoc md">${renderMd(r.text, parentOf(m.abs), S.home)}</div>` : `<pre class="mdoc">${esc(r.text)}</pre>`) + (r.cut ? '<div class="note">Only the first 400 KB is shown</div>' : '')
  } else body = `<div class="note">${esc(ext.toUpperCase())} files are not previewed here. Use Open to see it in its own app</div>`
  el.innerHTML = `${bar}<div class="mview">${body}</div>`
}
// Leaving a preview stops whatever is playing
function stopMedia() { document.querySelectorAll('#media video, #media audio').forEach(v => { try { v.pause() } catch {} }) }
function closeMedia() { stopMedia(); M.cur = null; renderMedia() }
$('#media').addEventListener('click', e => {
  const k = e.target.closest('[data-mk]'), c = e.target.closest('[data-m]'), v = (e.target.closest('[data-mv]') || { dataset: {} }).dataset.mv
  if (k) { M.kind = k.dataset.mk; return renderMedia() }
  if (c) { M.cur = M.shown[+c.dataset.m] || null; return renderMedia() }
  if (v === 'refresh') return void loadMedia()
  if (!M.cur) return
  const m = M.cur
  if (v === 'back') closeMedia()
  else if (v === 'open') call('openMedia', ID, m.rel)
  else if (v === 'reveal') call('revealPath', ID, m.rel)
  else if (v === 'files') { stopMedia(); showPath(m.rel, false) }
})

// ───────── Terminal panel ─────────
// Shells in the bee's folder, under the conversation. Hiding the panel keeps them running; closing a tab ends that shell
const T = { list: [], cur: '', timer: 0 }
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
const termTheme = () => ({ background: cssVar('--c-box'), foreground: cssVar('--c-text'), cursor: cssVar('--c-text'), cursorAccent: cssVar('--c-box'), selectionBackground: 'rgba(217, 119, 87, .3)',
  green: cssVar('--c-ok'), yellow: cssVar('--c-wait'), red: cssVar('--c-err'), magenta: cssVar('--c-relay-ink'), brightBlack: cssVar('--c-faint') })
const curTerm = () => T.list.find(t => t.tid === T.cur)
function fitTerm() {
  const t = curTerm()
  if (!t || $('#term').hidden) return
  try { t.fit.fit() } catch {}
  if (t.cols !== t.x.cols || t.rows !== t.x.rows) { t.cols = t.x.cols; t.rows = t.x.rows; hive.call('termResize', ID, t.tid, t.cols, t.rows) }
}
function addTerm(tid, title, buf) {
  const el = document.createElement('div'); el.className = 'tx'; $('#t-scr').appendChild(el)
  const x = new Terminal({ fontFamily: '"JetBrains Mono", Menlo, monospace', fontSize: 12.5, lineHeight: 1.25, cursorBlink: true, scrollback: 5000, macOptionIsMeta: true, theme: termTheme(), allowProposedApi: false })
  const fit = new FitAddon.FitAddon(); x.loadAddon(fit); x.open(el)
  x.attachCustomKeyEventHandler(e => !(e.ctrlKey && e.code === 'Backquote'))          // ⌃` is ours: it hides the panel
  x.onData(d => hive.call('termWrite', ID, tid, d))
  if (buf) x.write(buf)
  T.list.push({ tid, x, fit, el, title: title || 'shell', busy: false })
  pickTerm(tid)
}
async function newTerm() {
  const r = await call('termNew', ID, 80, 24)
  if (r && r.tid) addTerm(r.tid)
}
function pickTerm(tid) {
  T.cur = tid
  for (const t of T.list) t.el.hidden = t.tid !== tid
  renderTermTabs()
  requestAnimationFrame(() => { fitTerm(); const t = curTerm(); if (t && !$('#term').hidden) t.x.focus() })
}
function dropTerm(tid) {
  const i = T.list.findIndex(t => t.tid === tid)
  if (i < 0) return
  const [t] = T.list.splice(i, 1)
  try { t.x.dispose() } catch {} t.el.remove()
  if (!T.list.length) { T.cur = ''; return showTerm(false) }
  if (T.cur === tid) pickTerm(T.list[Math.min(i, T.list.length - 1)].tid); else renderTermTabs()
}
function renderTermTabs() {
  $('#t-tabs').innerHTML = T.list.map(t => `<button class="tab${t.tid === T.cur ? ' on' : ''}${t.busy ? ' busy' : ''}" data-tt="${t.tid}" title="${t.busy ? esc(t.title) + ' is running' : 'Idle'}"><i></i><span class="nm">${esc(t.title)}</span><span class="x" data-tx="${t.tid}" title="Close this terminal">✕</span></button>`).join('')
}
async function pollTerms() {
  if ($('#term').hidden || !T.list.length) return
  const list = await hive.call('termInfo', ID).catch(() => null)
  if (!Array.isArray(list)) return
  let changed = false
  for (const i of list) { const t = T.list.find(x => x.tid === i.tid); if (t && (t.title !== i.title || t.busy !== i.busy)) { t.title = i.title; t.busy = i.busy; changed = true } }
  if (changed) renderTermTabs()
}
function showTerm(on) {
  const el = $('#term')
  if (!on) $('#col').classList.remove('term-max')
  el.hidden = !on
  try { localStorage.setItem('hive-term', on ? '1' : '0') } catch {}
  $('#h-btns')._h = ''; renderHead()
  clearInterval(T.timer)
  if (!on) return void input.focus()
  T.timer = setInterval(pollTerms, 1500)
  $('#t-cwd').textContent = tilde(A.sessionCwd || A.workspace || '', S.home)
  if (!T.list.length) newTerm(); else pickTerm(T.cur || T.list[0].tid)
}
// ⌃`: show and focus; when the terminal already has the keyboard, hide
function toggleTerm() {
  const el = $('#term'), inside = !el.hidden && el.contains(document.activeElement)
  if (el.hidden) showTerm(true)
  else if (inside || !curTerm()) showTerm(false)
  else curTerm().x.focus()
}
// A reloaded window finds its shells still running
async function restoreTerms() {
  const list = await hive.call('termList', ID).catch(() => null)
  if (!Array.isArray(list) || !list.length) return
  let open = '0'
  try { open = localStorage.getItem('hive-term') || '0' } catch {}
  for (const t of list) addTerm(t.tid, t.title, t.buf)
  if (open === '1') showTerm(true)
}
{
  const ic2 = d => ic(d)
  $('#t-new').innerHTML = ICON.plus; $('#t-hide').innerHTML = ICON.x
  $('#t-send').innerHTML = ic2('<path d="M8 12.5V4M4.5 7.5L8 4l3.5 3.5"/>'); $('#t-ext').innerHTML = ic2('<path d="M9.5 3H13v3.5M13 3L7.5 8.5M11.5 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5"/>')
  $('#t-max').innerHTML = ic2('<path d="M4 10l4-4 4 4"/>')
  let h = 250
  try { h = +localStorage.getItem('hive-term-h') || 250 } catch {}
  $('#term').style.height = h + 'px'
  $('#t-grip').addEventListener('mousedown', e => {
    e.preventDefault()
    const y0 = e.clientY, h0 = $('#term').offsetHeight
    const move = ev => { $('#term').style.height = Math.max(90, Math.min(h0 + y0 - ev.clientY, innerHeight - 220)) + 'px' }
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); try { localStorage.setItem('hive-term-h', $('#term').offsetHeight) } catch {} }
    addEventListener('mousemove', move); addEventListener('mouseup', up)
  })
  new ResizeObserver(() => fitTerm()).observe($('#t-scr'))
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { for (const t of T.list) t.x.options.theme = termTheme() })
  $('#term .tbar').addEventListener('click', e => {
    const x = e.target.closest('[data-tx]'), tt = e.target.closest('[data-tt]'), b = (e.target.closest('[data-t]') || { dataset: {} }).dataset.t
    if (x) return void hive.call('termClose', ID, x.dataset.tx).then(() => dropTerm(x.dataset.tx))
    if (tt) return pickTerm(tt.dataset.tt)
    if (b === 'new') newTerm()
    else if (b === 'hide') showTerm(false)
    else if (b === 'ext') call('terminal', ID)
    else if (b === 'max') { const on = $('#col').classList.toggle('term-max'); $('#t-max').title = on ? 'Restore' : 'Maximize'; $('#t-max').style.transform = on ? 'rotate(180deg)' : '' }
    else if (b === 'send') {
      const sel = curTerm() ? curTerm().x.getSelection().replace(/[ \t]+$/gm, '').trim() : ''
      if (!sel) return toast('Select some text in the terminal first')
      $('#col').classList.remove('term-max')
      input.value = (input.value ? input.value.replace(/\n*$/, '\n\n') : '') + '```\n' + sel + '\n```\n'
      input.dispatchEvent(new Event('input', { bubbles: true })); input.focus()
    }
  })
}

// ───────── Boot ─────────
async function boot() {
  S = await hive.call('init')
  setSkin(S.settings.skin)
  A = S.agents.find(a => a.id === ID)
  if (!A) { document.body.innerHTML = '<div class="note" style="padding:80px;text-align:center">This bee is gone</div>'; return }
  const TABS = ['chat', 'changes', 'files', 'media'], tab0 = new URLSearchParams(location.search).get('tab')
  if (tab0 !== 'chat' && TABS.includes(tab0)) setTab(tab0)
  const log = await hive.call('log', ID)
  if (Array.isArray(log) && log.length) log.forEach(e => addEntry(e, false))
  else tl.innerHTML = `<div id="empty">${beeFace(A, 56, 'happy', 'idle')}<b class="round">${esc(A.name)}</b> is ready</div>`
  renderAll(); renderView(); toBottom(); input.focus()
  const file0 = new URLSearchParams(location.search).get('file')
  if (file0) setTimeout(() => openFromOutside(file0), 250)
  const find0 = new URLSearchParams(location.search).get('find')
  if (find0) setTimeout(() => findInChat(find0), 250)
  let side = '1'
  try { side = localStorage.getItem('hive-side') || '1' } catch {}
  if (side === '1' && innerWidth >= 760) { $('#tree').hidden = false; openFiles() }
  hive.on('agents', list => {
    const me = list.find(a => a.id === ID)
    if (!me) return window.close()
    const was = A.status
    S.agents = list; A = me
    renderAll()
    if (tab === 'changes' && was !== A.status && changesData) renderChanges()
  })
  hive.on('entry', ({ id, entry }) => { if (id === ID) addEntry(entry, true) })
  hive.on('partial', p => { if (p.id === ID) setLive(p.end ? null : p) })
  hive.on('toggleTerm', () => toggleTerm())
  hive.on('term', ({ tid, data }) => { const t = T.list.find(x => x.tid === tid); if (t) t.x.write(data) })
  hive.on('termExit', tid => dropTerm(tid))
  restoreTerms()
  hive.on('tab', t => setTab(TABS.includes(t) ? t : 'chat'))
  hive.on('find', q => findInChat(q))
  hive.on('file', p => openFromOutside(p))
}
boot()
