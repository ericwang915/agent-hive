// Main window: sidebar, Hive, Dashboard, Skills, Memory, hatch/settings dialog, ⌘K palette
'use strict'
const $ = s => document.querySelector(s)
let S = { agents: [], engines: [], settings: {}, max: 40, home: '', names: [], colors: [], presets: {}, maxRounds: 3, teamMax: 4, feed: [], spend: {}, night: {} }
let view = 'hive', filter = 'all', sub = 'all', query = '', queenLine = '', queenBusy = false
let F = null                      // hatch / settings form state
let G = null, skillOpen = new Set(), skillEdit = null, memOpen = new Set(), memEdit = null   // Skills / Memory
let dashDate = dayKey(), dashData = null

const byId = id => S.agents.find(a => a.id === id)
const eng = id => S.engines.find(e => e.id === id) || { label: id, models: [] }
const upNames = a => Team.upIds(a).map(byId).filter(Boolean).map(x => x.name)
// Skip the repaint when nothing changed (keeps hover / clicks intact); on repaint, update --t so animations stay in phase
function setHtml(el, html) {
  if (el._h === html) return
  el._h = html
  el.style.setProperty('--t', Math.round(performance.now()))
  el.innerHTML = html
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }

// ───────── Sidebar ─────────
const VIEWS = [['hive', 'Hive', 'hive'], ['dash', 'Dashboard', 'chart'], ['files', 'Files', 'folder'], ['skills', 'Skills', 'sprout'], ['memory', 'Memory', 'brain']]
function renderSide() {
  setHtml($('#nav'), VIEWS.map(([id, label, icon]) => `<button data-act="view" data-view="${id}" class="${view === id ? 'on' : ''}">${ICON[icon]}${label}</button>`).join(''))
  const live = S.agents.filter(a => a.status === 'running' || a.status === 'paused')
  setHtml($('#side-chats'), live.length ? live.map(a => `<button class="side-chat" data-act="chat" data-id="${a.id}"><span class="dot${a.status === 'running' ? ' blink' : ''}" style="background:${esc(a.color)}"></span><span class="ell grow">${esc(a.name)}</span><span class="faint" style="font-size:11px">${STATUS[a.status]}</span></button>`).join('')
    : '')
  const sp = S.spend && S.spend.day === dayKey() ? S.spend : { usd: 0, tok: 0 }
  $('#side-chats-h').hidden = !live.length
  const run = S.agents.filter(a => a.status === 'running').length, sch = S.agents.filter(scheduled).length
  setHtml($('#cap'), `<div class="cap-row"><div class="today-line grow" title="${S.agents.length} of ${S.max} bees hatched${S.settings.budget ? ' · budget $' + S.settings.budget : ''}">${run} running · ${sch} scheduled · ${sp.usd || !sp.tok ? fmtUsd(sp.usd) : fmtTok(sp.tok)}</div><button class="btn sm icon ghost" data-act="prefs" title="Settings">${ICON.gear}</button></div><div class="bar" title="Hive capacity ${S.agents.length} / ${S.max}"><i style="width:${Math.min(100, S.agents.length / S.max * 100)}%"></i></div>`)
  renderFeed()
}
function renderFeed() {
  const items = (S.feed || []).slice(0, 12)
  $('#side-feed-h').hidden = !items.length
  setHtml($('#side-feed'), items.length ? items.map(f => `<button class="feed-item k-${esc(f.kind)}" data-act="feed" data-id="${esc(f.id)}"${f.kind === 'error' ? ` title="${esc(f.text)}"` : ''}>${f.kind === 'error' ? `<span class="oops">${beeSvg(f.color || '#ccc', 'sad', 20)}</span>` : `<span class="dot" style="background:${esc(f.color || '#ccc')}"></span>`}<span class="grow"><span class="tx"><b>${esc(f.name)}</b> ${esc(f.kind === 'error' ? gentle(f.text) : f.text)}</span><span class="ago">${ago(f.t)}</span></span></button>`).join('')
    : '')
}

function show(v) {
  view = v
  for (const [id] of VIEWS) $('#v-' + id).hidden = id !== v
  renderSide()
  if (v === 'hive') renderHive()
  if (v === 'dash') loadDash()
  if (v === 'skills' || v === 'memory') loadGarden()
  if (v === 'files') loadOutputs()
  $('#main').scrollTop = 0
}

// ───────── Hive ─────────
function buildHive() {
  $('#v-hive').innerHTML = `
  <div class="page-head">
    <div class="grow"><h1 class="round" id="hello"></h1><div class="sub" id="hive-sub"></div></div>
    <div class="seg" id="hive-view"></div>
    <div class="search">${ICON.search}<input type="search" id="q" placeholder="Search bees, skills, memory, chats" spellcheck="false"></div>
    <button class="btn primary" data-act="hatch">${ICON.plus}Hatch</button>
  </div>
  <div class="queen-card">
    <span id="queen-bee"></span>
    <div class="who"><b class="round">Daily report</b> <span class="mute" id="queen-when"></span><div class="line" id="queen-line"></div></div>
    <button class="btn sm" data-act="view-report">View</button>
  </div>
  <div class="chips" id="chips"></div><div class="chips sub" id="chips2"></div>
  <div class="grid" id="grid"></div><div id="found"></div>`
  $('#q').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); renderHive(); searchMore(e.target.value, renderFound) })
}

const scheduled = a => a.schedule && a.schedule.mode !== 'manual'
const FILTERS = [['all', 'All', () => true], ['running', 'Running', a => a.status === 'running' || a.status === 'setup'], ['paused', 'Paused', a => a.status === 'paused' || a.status === 'sleeping'],
  ['sched', 'Scheduled', scheduled], ['error', 'Error', a => a.status === 'error'], ['stopped', 'Stopped', a => a.status === 'stopped']]
const KINDS = [['adhoc', 'Once'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['interval', 'Interval'], ['event', 'On event']]
const matches = a => !query || [a.name, a.task, a.workspace, eng(a.engine).label, a.engine, a.model].some(x => String(x || '').toLowerCase().includes(query))

function renderHive() {
  if (view !== 'hive') return
  if (document.activeElement && document.activeElement.id === 'sq-input') return      // a squad is being renamed: leave the cards alone
  const A = S.agents, n = f => A.filter(FILTERS.find(x => x[0] === f)[2]).length
  $('#hello').textContent = 'Hive'
  $('#hive-sub').textContent = A.length ? [[n('running'), 'running'], [n('paused'), 'paused'], [n('error'), n('error') === 1 ? 'error' : 'errors']].filter(x => x[0]).map(x => `${x[0]} ${x[1]}`).join(' · ') || `${A.length} bee${A.length === 1 ? '' : 's'}, all idle` : 'No bees yet'
  setHtml($('#queen-bee'), queenSvg(34, 'happy', queenBusy ? 'running' : 'idle'))
  $('#queen-when').textContent = `Daily ${S.settings.reportTime || '18:00'}`
  $('#queen-line').textContent = queenBusy ? 'Queen is writing…' : queenLine || 'None yet'
  setHtml($('#chips'), FILTERS.filter(([id]) => id === 'all' || id === filter || n(id)).map(([id, label]) => `<button class="chip${filter === id ? ' on' : ''}" data-act="filter" data-f="${id}">${label}<span class="n">${n(id)}</span></button>`).join(''))
  const used = KINDS.filter(([k]) => A.some(a => schedKind(a.schedule) === k))
  if (!used.some(([k]) => k === sub)) sub = 'all'
  setHtml($('#chips2'), filter === 'sched' && used.length ? [['all', 'All scheduled'], ...used].map(([k, label]) => `<button class="chip${sub === k ? ' on' : ''}" data-act="sub" data-k="${k}">${label}<span class="n">${k === 'all' ? n('sched') : A.filter(a => schedKind(a.schedule) === k).length}</span></button>`).join('') : '')

  setHtml($('#hive-view'), [['comb', 'Honeycomb'], ['cards', 'Cards']].map(([k, l]) => `<button class="${hiveView === k ? 'on' : ''}" data-act="hive-view" data-k="${k}">${l}</button>`).join(''))
  const grid = $('#grid'), cols = Math.max(1, Math.floor((grid.clientWidth + GAP) / (300 + GAP))), colW = (grid.clientWidth - (cols - 1) * GAP) / cols
  let list = A.filter(FILTERS.find(x => x[0] === filter)[2]).filter(matches), html = ''
  grid.classList.toggle('comb', hiveView === 'comb')
  if (hiveView === 'comb') { if (filter === 'sched' && sub !== 'all') list = list.filter(a => schedKind(a.schedule) === sub); return setHtml(grid, combHtml(list, grid.clientWidth)) }
  if (filter === 'sched') {
    if (sub !== 'all') list = list.filter(a => schedKind(a.schedule) === sub)
    const t = a => { const d = nextRun(a.schedule); return d ? d.getTime() : Infinity }
    list = [...list].sort((x, y) => t(x) - t(y))
    html = list.length ? list.map(cardHtml).join('') : `<div class="guide">${A.some(scheduled) ? 'No scheduled bees match' : 'No scheduled bees yet. Pick a schedule when hatching or in ⚙ Settings.'}</div>`
  } else {
    const done = new Set()
    for (const a of list) {
      if (done.has(a.id)) continue
      const team = Team.teamOf(A, a.id)
      if (team.length > 1) { team.forEach(m => done.add(m.id)); html += teamHtml(team, cols, colW) } else html += cardHtml(a)
    }
    if (filter === 'all' && !query && A.length < S.max) html += `<button class="empty-slot" data-act="hatch">${ICON.plus}<span>Hatch</span></button>`
    else if (!list.length) html = query ? '' : `<div class="guide">No bees match</div>`
  }
  setHtml(grid, html)
}

// ───────── Honeycomb view ─────────
// The same bees as cells of a comb: each squad is one cluster shaped by its relay, the rest sit together.
// A cell holds only who and how it is doing; the bee picked shows as a full card beside the comb
let hiveView = 'comb', combSel = ''                   // the honeycomb is what a new hive opens with; Cards stays one click away
try { hiveView = localStorage.getItem('hive-view') === 'cards' ? 'cards' : 'comb' } catch {}
const HX = { W: 138, H: 159, G: 8 }, HX_ROW = HX.H * 0.75 + HX.G, HX_HALF = (HX.W + HX.G) / 2
// Where a squad's bees go, from its layers: bees on one step stack above and below the line, tucked between the steps before and after
function combPlace(layers) {
  const at = new Map()
  let cur = 0, prevMulti = false
  for (const layer of layers) {
    if (layer.length === 1) { at.set(layer[0].id, { xh: cur, row: 0 }); cur += 2; prevMulti = false; continue }
    if (prevMulti) cur += 2
    const side = cur === 0 ? 1 : cur - 1               // a first step with several bees has nothing to tuck behind
    const rows = layer.length === 2 ? [-1, 1] : layer.length === 3 ? [-1, 0, 1] : [-1, 1, 0, 2, -2, 3]
    layer.forEach((b, i) => { const row = rows[i % rows.length]; at.set(b.id, { xh: row % 2 ? side : side + 1, row }) })
    cur = Math.max(cur, side + (layer.length > 2 ? 3 : 1))
    prevMulti = true
  }
  const minRow = Math.min(...[...at.values()].map(p => p.row)), minX = Math.min(...[...at.values()].map(p => p.xh))
  for (const p of at.values()) { p.x = (p.xh - minX) * HX_HALF; p.y = (p.row - minRow) * HX_ROW }
  return at
}
function combCell(a, p) {
  const live = a.status === 'running', mood = a.status === 'error' ? 'sad' : a.status === 'sleeping' || a.status === 'paused' ? 'sleep' : 'happy'
  return `<div class="hx${live ? ' live' : ''}${a.id === combSel ? ' sel' : ''}${a.status === 'error' ? ' bad' : ''}" style="left:${p.x}px;top:${p.y}px" data-act="comb-pick" data-id="${a.id}" data-bee="${a.id}" title="${esc(a.name)} · ${esc(a.task)}"><div class="hx-in">
    ${beeFace(a, 38, mood, live ? 'running' : '')}<div class="hx-nm round ell">${esc(a.name)}</div><div class="hx-task ell">${esc(scheduled(a) ? schedText(a.schedule) : a.task)}</div>${pill(a.status)}${a.approvals && a.approvals.length ? '<i class="hx-ask" title="Needs approval"></i>' : ''}</div></div>`
}
const combLink = (p, q, sym, label) => `<div class="hx-link" style="left:${(p.x + q.x) / 2 + HX.W / 2}px;top:${(p.y + q.y) / 2 + HX.H / 2}px"><span style="transform:rotate(${Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI}deg)">${sym}</span>${label ? `<em>${label}</em>` : ''}</div>`
const combBox = at => { const ps = [...at.values()]; return { w: Math.max(...ps.map(p => p.x)) + HX.W, h: Math.max(...ps.map(p => p.y)) + HX.H } }
function combSquad(team) {
  const lead = team[0], layers = Team.layersOf(S.agents, lead.id), at = combPlace(layers), box = combBox(at), last = layers[layers.length - 1]
  let links = ''
  for (const b of team) {
    const ups = Team.upIds(b).filter(id => at.has(id))
    ups.forEach((id, i) => { links += combLink(at.get(id), at.get(b.id), b.after && b.after.loop && ups.length === 1 ? '⇄' : '→', ups.length > 1 && i === ups.length - 1 ? 'merge' : '') })
  }
  const busy = team.some(m => ['running', 'paused'].includes(m.status) || (m.queue && m.queue.length))
  const shape = [team.some(m => m.after && m.after.loop) ? 'review loop' : '', layers.some(l => l.length > 1) ? `${Math.max(...layers.map(l => l.length))} in parallel${layers[layers.length - 1].length === 1 && layers.length > 2 ? ', then a merge' : ''}` : ''].filter(Boolean).join(' · ') || 'relay'
  return `<div class="hx-group" style="width:${Math.max(box.w, 236)}px"><div class="hx-gh"><button class="sq-name" data-act="squad-rename" data-id="${lead.id}" title="The squad's name: Queen and @mentions use it. Click to rename">${esc(squadNameOf(lead))}</button>
    ${busy ? `<button class="btn sm icon ghost danger" data-act="team-stop" data-id="${lead.id}" title="Stop the squad">${ICON.stop}</button>` : ''}${team.length < S.teamMax ? `<button class="btn sm relay-add" data-act="relay" data-id="${last.length === 1 ? last[0].id : lead.id}" title="Add a bee to the end of this squad">${ICON.plus}Relay</button>` : ''}</div>
    <div class="hx-gs ell">${esc(lead.task)} · ${shape}</div><div class="hx-area" style="width:${box.w}px;height:${box.h}px">${team.map(b => combCell(b, at.get(b.id))).join('')}${links}</div></div>`
}
// few: a handful of bees next to squads stay two wide, so the group fits beside the last squad instead of under it
function combSolo(bees, width, withHatch, few) {
  const n = bees.length + (withHatch ? 1 : 0), cols = Math.max(2, Math.min(n, few ? 2 : 99, Math.floor((width - HX_HALF + HX.G) / (HX.W + HX.G))))
  const pos = i => { const r = Math.floor(i / cols), c = i % cols; return { x: c * (HX.W + HX.G) + (r % 2 ? HX_HALF : 0), y: r * HX_ROW } }
  const rows = Math.ceil(n / cols), w = Math.min(n, cols) * (HX.W + HX.G) - HX.G + (rows > 1 ? HX_HALF : 0), h = HX.H + (rows - 1) * HX_ROW
  const hatch = withHatch ? (() => { const p = pos(bees.length); return `<button class="hx add" style="left:${p.x}px;top:${p.y}px" data-act="hatch"><span class="hx-in"><span class="plus">+</span><span class="hx-task">Hatch</span></span></button>` })() : ''
  return `<div class="hx-group" style="width:${w}px"><div class="hx-gh"><b class="round">${bees.length ? 'On their own' : 'No bees yet'}</b></div><div class="hx-gs">${bees.length} bee${bees.length === 1 ? '' : 's'}</div><div class="hx-area" style="width:${w}px;height:${h}px">${bees.map((b, i) => combCell(b, pos(i))).join('')}${hatch}</div></div>`
}
function combHtml(list, width) {
  const A = S.agents, done = new Set(), squads = [], solo = []
  for (const a of list) {
    if (done.has(a.id)) continue
    const team = Team.teamOf(A, a.id)
    if (team.length > 1) { team.forEach(m => done.add(m.id)); squads.push(team) } else solo.push(a)
  }
  const shown = [...squads.flat(), ...solo]
  if (!shown.some(a => a.id === combSel)) combSel = (shown.find(a => a.status === 'running') || shown[0] || {}).id || ''
  const sel = byId(combSel), narrow = width < 760, leftW = narrow ? width : width - 340 - 20
  const hatch = filter === 'all' && !query && A.length < S.max
  if (!shown.length && !hatch) return query ? '' : '<div class="guide">No bees match</div>'
  const team = sel ? Team.teamOf(A, sel.id) : []
  const side = sel ? `<div class="hx-side">${cardHtml(sel)}${team.length > 1 ? `<div class="hx-where">${esc(squadNameOf(team[0]))} · ${Team.layersOf(A, team[0].id).map(l => l.map(m => (m.id === sel.id ? `<b>${esc(m.name)}</b>` : esc(m.name))).join(' ∥ ')).join(' → ')}</div>` : ''}<div class="hx-hint">Click a cell to see it here · double-click opens its chat</div></div>` : ''
  return `<div class="hx-page${narrow ? ' narrow' : ''}"><div class="hx-left">${squads.map(combSquad).join('')}${solo.length || hatch ? combSolo(solo, Math.max(HX.W * 2 + HX_HALF, leftW), hatch, squads.length > 0 && solo.length + (hatch ? 1 : 0) <= 6) : ''}</div>${side}</div>`
}

const GAP = 18          // grid gap, keep in sync with .grid in style.css
const subline = a => [eng(a.engine).label, a.model, a.queue && a.queue.length ? `${a.queue.length} queued` : ''].filter(Boolean).join(' · ')
const tailHtml = a => `<button class="tail" data-act="chat" data-id="${a.id}" title="Open chat">${a.tail && a.tail.length ? a.tail.map(l => `<div>${esc(l)}</div>`).join('') : '<div class="empty">No output yet</div>'}</button>`
function schedMeta(a) {
  if (!scheduled(a)) return 'Manual'
  if (a.schedule.mode === 'event') return eventText(a.schedule.event, id => (byId(id) || {}).name) + (a.status === 'paused' || a.status === 'stopped' ? ' · off' : '')
  const t = schedText(a.schedule)
  if (a.status === 'paused' || a.status === 'stopped') return t + ' · off'
  const d = nextRun(a.schedule)
  return d ? `${t} · next ${whenText(d)}` : t
}
function badgesHtml(a, short) {
  const b = [], c = a.changes, cost = a.today && a.today.day === dayKey() ? costText(a.today) : ''
  if (a.approvals && a.approvals.length) b.push(`<button class="badge approve" data-act="chat" data-id="${a.id}"><i class="blink"></i>Needs approval</button>`)
  if (c && c.files) b.push(`<button class="badge" data-act="chat" data-id="${a.id}" data-tab="changes" title="View changes">${c.files}${short ? '' : c.files === 1 ? ' file' : ' files'} <span class="add">+${c.add}</span> <span class="del">−${c.del}</span></button>`)
  if (a.isolate && a.branch) b.push(`<span class="badge" title="Own branch ${esc(a.branch)}">${ICON.branch}${short ? '' : esc(a.branch)}</span>`)
  if (cost) b.push(`<span class="badge" title="Today's spend">${cost}</span>`)
  const cx = a.context, pct = cx && cx.used && cx.window ? Math.round(cx.used / cx.window * 100) : 0, big = cx && cx.used >= 100000
  if (pct >= 30 || big) b.push(`<button class="badge${pct >= 50 || big ? ' hot' : ''}" data-act="chat" data-id="${a.id}" title="This session holds ${fmtTok(cx.used)}. Every round re-reads it; /compact or /new in the chat makes it small again">${short ? '' : 'Context '}${pct ? pct + '%' : fmtTok(cx.used)}</button>`)
  if (a.lastCost >= 1) b.push(`<span class="badge hot" title="What the last round cost">${short ? '' : 'Last round '}${fmtUsd(a.lastCost)}</span>`)
  return b.join('')
}
// Main button: run / pause / resume
function mainBtn(a, mini) {
  const b = (act, icon, label, cls = '') => `<button class="btn sm ${mini ? 'icon' : ''} ${cls}" data-act="${act}" data-id="${a.id}" title="${label}">${ICON[icon]}${mini ? '' : label}</button>`
  let out = ''
  if (a.status === 'running') out += b('pause', 'pause', 'Pause')
  else if (a.status === 'paused') out += b('continue', 'play', 'Resume', 'primary')
  else if (a.status !== 'setup' && a.prompt) out += b('run', 'play', 'Run', 'primary')
  if (a.needsSetup && a.status !== 'setup') out += b('continue', 'refresh', 'Retry clone')
  else if (['stopped', 'error', 'sleeping'].includes(a.status) && a.lastRunAt) out += b('continue', 'resume', 'Resume')
  if (['running', 'paused', 'setup'].includes(a.status) || (a.queue && a.queue.length)) out += `<button class="btn sm icon ghost" data-act="stop" data-id="${a.id}" title="Stop">${ICON.stop}</button>`
  return out
}
// Settings has its own button; delete and the rest live in the "more" menu (same as right-click)
const iconBtns = a => `<button class="btn sm icon ghost" data-act="edit" data-id="${a.id}" title="Settings">${ICON.gear}</button><button class="btn sm icon ghost" data-act="more" data-id="${a.id}" title="More">${ICON.more}</button>`

function cardHtml(a) {
  const g = a.git ? `<div class="gitline">${ICON.branch}<span class="ell">${esc(a.git.url.replace(/^.*[:/]([^/:]+\/[^/]+?)(\.git)?$/, '$1'))}${a.git.branch ? '@' + esc(a.git.branch) : ''}</span></div>` : ''
  return `<div class="card${a.status === 'running' ? ' running' : ''}" data-bee="${a.id}">
  <div class="card-head">${beeOf(a, 44)}<div class="grow"><div class="nmrow"><span class="nm round ell">${esc(a.name)}</span>${rankChip(a)}</div><div class="eng ell">${esc(subline(a))}</div></div>${pill(a.status)}</div>
  ${tailHtml(a)}
  <div class="badges">${badgesHtml(a)}</div>
  <div class="meta"><span class="task ell">${esc(a.task)}</span><span class="sched">${esc(schedMeta(a))}</span></div>
  <div class="path ell" title="${esc(a.workspace)}">${esc(tilde(a.workspace, S.home))}</div>
  ${g}
  <div class="card-actions">${mainBtn(a)}<span class="sp"></span>
    ${!a.isolate && a.status !== 'setup' ? `<button class="btn sm relay-add" data-act="relay" data-id="${a.id}" title="Add a bee that picks up when this one is done: a reviewer, a tester…">${ICON.plus}Relay</button>` : ''}<button class="btn sm" data-act="chat" data-id="${a.id}">Chat →</button>${iconBtns(a)}</div>
</div>`
}

function relHtml(a, A) {
  const ups = upNames(a), out = []
  if (ups.length === 1) out.push(`↳ after ${esc(ups[0])}${a.after.loop ? ' · sends feedback back' : ''}`)
  if (ups.length > 1) out.push(`⇉ merges ${esc(ups.join(', '))}`)
  if (a.inbox && a.inbox.got) {
    const got = Object.values(a.inbox.got).map(g => g.name), wait = Team.upIds(a).filter(id => !a.inbox.got[id]).map(id => (byId(id) || {}).name).filter(Boolean)
    if (got.length && wait.length) out.push(`got ${esc(got.join(', '))}, waiting for ${esc(wait.join(', '))}`)
  }
  if (Team.isParallel(A, a.id) && a.worktree) out.push('own worktree')
  return out.map(t => `<span class="badge rel">${t}</span>`).join('')
}
function miniHtml(a, tight) {
  return `<div class="mini${a.status === 'running' ? ' running' : ''}" data-bee="${a.id}">
  <div class="card-head">${beeOf(a, 30)}<div class="grow"><div class="nmrow"><span class="nm round ell">${esc(a.name)}</span>${rankChip(a)}</div><div class="eng ell">${esc(subline(a))}</div></div>${pill(a.status, tight)}</div>
  ${tailHtml(a)}
  <div class="badges">${badgesHtml(a, true)}${relHtml(a, S.agents)}</div>
  <div class="card-actions">${mainBtn(a, true)}<span class="sp"></span><button class="btn sm icon ghost" data-act="chat" data-id="${a.id}" title="Chat">${ICON.chat}</button>${iconBtns(a)}</div>
</div>`
}
// Team box: 2 bees span 2 cells, 3 or more span 3 (capped at the column count); one column per layer
// Squads: a relay team under one name (kept on its first bee). "@Mochi-squad" in a group starts the whole chain
const squadNameOf = lead => String(lead.squadName || '').trim() || `${lead.name} squad`
const squadList = () => S.agents.filter(a => Team.isLead(S.agents, a)).map(lead => ({ lead, name: squadNameOf(lead), team: Team.teamOf(S.agents, lead.id) }))
function renameSquad(el) {
  const id = el.dataset.id, lead = byId(id), inp = document.createElement('input')
  inp.id = 'sq-input'; inp.type = 'text'; inp.maxLength = 30; inp.value = squadNameOf(lead); inp.spellcheck = false
  el.replaceWith(inp); inp.focus(); inp.select()
  let done = false
  const end = async save => { if (done) return; done = true; const v = inp.value.trim(); inp.blur(); inp.id = ''; if (save && v !== squadNameOf(lead)) await call('squadName', id, v === `${lead.name} squad` ? '' : v); $('#grid')._h = ''; renderHive() }
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) end(true); else if (e.key === 'Escape') end(false) })
  inp.addEventListener('blur', () => end(true))
}
function teamHtml(team, cols, colW) {
  const layers = Team.layersOf(S.agents, team[0].id), span = Math.min(cols, team.length === 2 ? 2 : 3)
  const W = span * colW + (span - 1) * GAP - 30, n = Math.max(1, Math.min(layers.length, Math.floor((W + 28) / (220 + 28))))
  const stacked = n < layers.length, w = (W - (n - 1) * 28) / n, tight = w < 250, dag = layers.some(l => l.length > 1)
  const chain = layers.map(l => l.map(m => `<span class="m"><span class="dot" style="background:${esc(m.color)}"></span>${esc(m.name)}</span>`).join('<span class="sep">∥</span>')).join('<span class="sep">→</span>')
  const busy = team.some(m => ['running', 'paused'].includes(m.status) || (m.queue && m.queue.length))
  const last = layers[layers.length - 1]
  return `<div class="team" style="grid-column:span ${span}">
  <div class="team-head"><button class="sq-name" data-act="squad-rename" data-id="${team[0].id}" title="The squad's name: Queen and @mentions use it. Click to rename">${esc(squadNameOf(team[0]))}</button><div class="chain grow">${chain}<span class="folder">· ${esc(team[0].task)}</span></div>
    ${busy ? `<button class="btn sm danger" data-act="team-stop" data-id="${team[0].id}">${ICON.stop}Stop</button>` : ''}
    ${team.length < S.teamMax ? `<button class="btn sm relay-add" data-act="relay" data-id="${last.length === 1 ? last[0].id : team[0].id}" title="Add a bee to the end of this squad">${ICON.plus}Relay<span class="faint">${team.length}/${S.teamMax}</span></button>` : `<span class="faint" style="font-size:12px">${team.length}/${S.teamMax}</span>`}</div>
  <div class="team-body${stacked ? ' stacked' : ''}${tight ? ' tight' : ''}${dag ? ' dag' : ''}" style="--cols:${n}">${layers.map(l => `<div class="layer">${l.map(m => miniHtml(m, tight)).join('')}</div>`).join('')}</div>
</div>`
}

// ───────── Hatch / settings dialog ─────────
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '')
function pickName() {
  const used = new Set(S.agents.map(a => a.name.toLowerCase())), free = S.names.filter(n => !used.has(n.toLowerCase()) && n !== (F && F.name))
  const pool = free.length ? free : S.names
  return pool[Math.floor(Math.random() * pool.length)] + (free.length ? '' : Math.floor(Math.random() * 90 + 10))
}
const firstInstalled = not => (S.engines.find(e => e.installed && !e.custom && e.id !== not) || S.engines.find(e => e.installed && !e.custom) || S.engines[0]).id
const defaultAt = () => { const d = new Date(Date.now() + 3600000); return `${dayKey(d)}T${hmOf(d)}` }
const fWorkspace = () => (F.afterWs ? F.afterWs : F.wsCustom || `${S.settings.workspaceRoot}/${F.task || '…'}`)

function openHatch(pre = {}) {
  if (!pre.edit && S.agents.length >= S.max) return toast('Hive is full', 'err')
  const a = pre.edit ? byId(pre.edit) : null
  const usedColors = new Set(S.agents.map(x => x.color))
  F = a ? {
    mode: 'edit', id: a.id, name: a.name, task: a.task, wsCustom: a.workspace, color: a.color, engine: a.engine, model: a.model || '', template: a.template || '', prompt: a.prompt || '',
    sched: { time: '09:00', at: defaultAt(), every: 60, days: [1, 2, 3, 4, 5], dom: 1, ...a.schedule, event: { ...{ type: 'commit', branch: '', remote: false, what: ['pr'], ids: [], on: 'done', cooldown: 5 }, ...(a.schedule.event || {}) }, ...(a.schedule.mode === 'weekdays' ? { mode: 'weekly', days: [1, 2, 3, 4, 5] } : {}), asDaily: !!onlyOf(a.schedule.mode === 'weekdays' ? { mode: 'weekly', days: [1, 2, 3, 4, 5] } : a.schedule) },
    sleepResume: a.sleepResume !== false, permission: a.permission, isolate: !!a.isolate, startNow: false, freshSchedule: a.freshSchedule !== false, noMcp: !!a.noMcp, mcpOff: a.mcpOff || [], noSkills: !!a.noSkills,
    after: a.after ? { ids: Team.upIds(a), prompt: a.after.prompt, loop: !!a.after.loop } : null, inRelay: Team.inTeam(S.agents, a.id), git: a.git,
  } : {
    mode: 'create', name: '', task: '', taskTouched: false, wsCustom: '', gitUrl: '', gitBranch: '',
    color: S.colors.find(c => !usedColors.has(c)) || S.colors[S.agents.length % S.colors.length], engine: firstInstalled(), model: '', template: '', prompt: '',
    sched: { mode: 'manual', time: '09:00', at: defaultAt(), every: 60, days: [1, 2, 3, 4, 5], dom: 1, event: { type: 'commit', branch: '', remote: false, what: ['pr'], ids: [], on: 'done', cooldown: 5 } },
    sleepResume: true, permission: 'full', isolate: false, startNow: true, freshSchedule: true, noMcp: false, mcpOff: [], noSkills: false,
    after: { ids: [], role: 'review', prompt: S.presets.review.prompt, loop: false }, engineTouched: false,
  }
  if (!a) {
    F.name = pre.name || pickName()
    F.task = pre.folder || slugify(F.name)
    if (pre.folder) F.taskTouched = true
    if (pre.workspace) { F.wsCustom = pre.workspace; F.task = pre.workspace.replace(/\/+$/, '').split('/').pop() || F.task; F.taskTouched = true }
    if (pre.engine && eng(pre.engine).installed) { F.engine = pre.engine; F.engineTouched = true }
    if (pre.prompt) F.prompt = pre.prompt
    if (pre.schedule) F.sched = { ...F.sched, ...pre.schedule }
    if (pre.after) setAfter([pre.after])
  }
  buildForm()
  $('#hatch').showModal()
  const focus = $(F.mode === 'edit' ? '#f-name' : '#f-task')
  if (focus) { focus.focus(); focus.select() }
}

function buildForm() {
  const edit = F.mode === 'edit'
  $('#hatch-form').innerHTML = `
  <div class="dlg-head"><span id="f-bee"></span><div class="grow"><h2 class="round">${edit ? `Settings · ${esc(F.name)}` : 'Hatch a bee'}</h2><div class="mute" style="font-size:12.5px">${edit ? esc(tilde(F.wsCustom, S.home)) : `${S.max - S.agents.length} slots left`}</div></div>
    <button type="button" class="btn icon ghost" data-act="hatch-close" title="Close">${ICON.x}</button></div>
  <div class="dlg-body">
    <div class="two">
      <div class="field"><div class="lab">Folder</div>${edit ? `<div class="ro ell">${esc(F.task)}</div>` : `<input type="text" id="f-task" maxlength="64" spellcheck="false" value="${esc(F.task)}">`}</div>
      <div class="field"><div class="lab">Name ${edit ? '' : '<button type="button" class="btn sm ghost" data-act="f-rename" style="height:20px;margin:-2px 0">Shuffle</button>'}</div><input type="text" id="f-name" maxlength="24" spellcheck="false" value="${esc(F.name)}"></div>
    </div>
    <div class="field" id="sec-relay"></div>
    <div class="field" id="sec-ws"></div>
    <div class="field" id="sec-git"></div>
    <div class="field"><div class="lab">Color</div><div class="swatches" id="sec-color"></div></div>
    <div class="field"><div class="lab">Engine</div><div class="engines" id="sec-engine"></div><div id="sec-model" style="margin-top:10px"></div></div>
    <div class="field"><div class="lab">Prompt <span class="opt">optional, required for schedules</span></div><textarea id="f-prompt" rows="4" placeholder="What should it do">${esc(F.prompt)}</textarea></div>
    <div class="two">
      <div class="field"><div class="lab">Schedule</div><div id="sec-sched"></div></div>
      <div class="field"><div class="lab">Behaviour</div><div class="beh" id="sec-beh"></div></div>
    </div>
  </div>
  <div class="dlg-foot"><div class="preview grow ell" id="f-preview"></div><button type="button" class="btn" data-act="hatch-close">Cancel</button><button type="submit" class="btn primary" id="f-submit">${edit ? 'Save' : 'Hatch'}</button></div>`
  updHead(); updRelay(); updWs(); updGit(); updColor(); updEngine(); updSched(); updBeh(); updPreview(); lockTask()
}

const updHead = () => { $('#f-bee').innerHTML = beeSvg(F.color, 'happy', 46, false, 'idle') }
const updPreview = () => {
  const e = eng(F.engine), cmd = e.template === null ? e.cmd : (F.template || e.template || '').trim().split(/\s+/)[0] || '(no command yet)'
  $('#f-preview').innerHTML = `<code>${esc(cmd)}</code> @ <code>${esc(tilde(fWorkspace(), S.home))}</code>`
}
const updColor = () => { $('#sec-color').innerHTML = S.colors.map(c => `<button type="button" class="swatch${F.color === c ? ' on' : ''}" data-act="f-color" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('') }

// Relay: tick one = take over when it finishes; tick several = merge once all finish; ticking the same one as another bee = parallel
function setAfter(ids) {
  F.after.ids = ids
  const ups = ids.map(byId).filter(Boolean)
  F.afterWs = ups.length ? ups[0].workspace : ''
  if (ups.length) {
    F.afterTask = ups[0].task
    const role = ids.length > 1 ? 'merge' : 'review'
    if (F.after.role !== 'custom') { F.after.role = role; F.after.prompt = S.presets[role].prompt }
    const par = afterShape().parallel
    F.after.loop = F.after.role === 'review' && !par
    if (!F.engineTouched) F.engine = firstInstalled(ups[0].engine)
    F.isolate = false
    F.afterRepo = null
    hive.call('isRepo', F.afterWs).then(r => { if (F && F.afterWs) { F.afterRepo = r === true; updRelay() } })
  }
}
function afterShape() {
  const ids = F.after.ids, A = S.agents, d = Team.depthMap(A), depth = 1 + Math.max(...ids.map(id => d[id] || 0))
  const peers = Team.teamOf(A, ids[0]).filter(m => d[m.id] === depth)
  return { depth, peers, parallel: peers.length > 0 }
}
function updRelay() {
  const el = $('#sec-relay')
  if (F.mode === 'edit') {
    if (!F.after) { el.innerHTML = F.inRelay ? '<div class="lab">Relay</div><div class="ro">Team lead</div>' : ''; return }
    const par = Team.isParallel(S.agents, F.id)
    el.innerHTML = `<div class="lab">Relay</div><div class="relay-box" style="margin-top:0"><div>${F.after.ids.length > 1 ? 'Merges' : 'After'} <b>${esc(upNames(byId(F.id)).join(', '))}</b> <span class="faint">· fixed</span></div>
      <div><div class="lab" style="font-size:12px;font-weight:600;margin-bottom:6px">Prompt on handoff</div><textarea id="f-after-prompt" rows="4">${esc(F.after.prompt)}</textarea></div>
      ${loopCheck(par)}</div>`
    return
  }
  const seen = new Set(), rows = []
  for (const a of S.agents) {
    if (seen.has(a.id)) continue
    const team = Team.teamOf(S.agents, a.id)
    team.forEach(m => seen.add(m.id))
    const off = team.length >= S.teamMax ? `Team is full (${S.teamMax})` : team.some(m => m.isolate) ? 'Own-branch bees can\'t be relayed' : team.some(m => m.status === 'setup') ? 'Repo still setting up' : ''
    rows.push(`<div class="relay-row${off ? ' off' : ''}" title="${off}">${team.map(m => `<label><input type="checkbox" data-change="f-after" value="${m.id}" ${F.after.ids.includes(m.id) ? 'checked' : ''} ${off ? 'disabled' : ''}><span class="dot" style="background:${esc(m.color)}"></span>${esc(m.name)}</label>`).join('')}<span class="fd ell">${off || esc(team[0].task)}</span></div>`)
  }
  let box = ''
  if (F.after.ids.length) {
    const ups = upNames({ after: F.after }), sh = afterShape(), me = esc(F.name || 'the new bee'), lead = Team.leadOf(S.agents, F.after.ids[0])
    const shape = ups.length > 1 ? `When <b>${esc(ups.join(', '))}</b> all finish, <b>${me}</b> merges their results.` : `When <b>${esc(ups[0])}</b> finishes, <b>${me}</b> takes over.`
    const par = sh.parallel ? (F.afterRepo === false
      ? `<div class="hint warn" style="margin:0">Parallel with ${esc(sh.peers.map(p => p.name).join(', '))}. Not a git repo, so they share the folder; analysis only.</div>`
      : `<div class="hint" style="margin:0">Parallel with ${esc(sh.peers.map(p => p.name).join(', '))}, each in its own worktree.</div>`) : ''
    box = `<div class="relay-box"><div>${shape} <span class="faint">shared folder ${esc(F.afterTask)}</span></div>${par}
      <div class="row" style="flex-wrap:wrap"><span class="mute" style="font-size:12px">Role</span><div class="seg">${[['review', 'Review'], ['merge', 'Merge'], ['test', 'Tests'], ['custom', 'Custom']].map(([k, l]) => `<button type="button" class="${F.after.role === k ? 'on' : ''}" data-act="f-role" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div><div class="lab" style="font-size:12px;font-weight:600;margin-bottom:6px">Prompt on handoff <span class="opt" style="font-weight:400;color:var(--faint)">{from} upstream name · {reply} upstream summary</span></div><textarea id="f-after-prompt" rows="4">${esc(F.after.prompt)}</textarea></div>
      ${loopCheck(sh.parallel, lead)}</div>`
  }
  el.innerHTML = rows.length ? `<div class="lab">Relay <span class="opt">optional · tick one to hand off, several to merge</span></div><div class="relay-rows">${rows.join('')}</div>${box}` : ''
}
function loopCheck(parallel, lead) {
  lead = lead || (F.id ? Team.leadOf(S.agents, F.id) : null)
  return `<label class="check${parallel ? ' off' : ''}"><input type="checkbox" data-change="f-loop" ${F.after.loop && !parallel ? 'checked' : ''} ${parallel ? 'disabled' : ''}><span>If it fails, send back to <b>${esc(lead ? lead.name : '')}</b> to fix (up to ${S.maxRounds} rounds)${parallel ? '<span class="faint"> · not available in parallel</span>' : ''}</span></label>`
}

const checkWs = debounce(async () => {
  if (!F || F.mode === 'edit' || F.afterWs) return
  const p = fWorkspace(), r = F.task || F.wsCustom ? await hive.call('exists', p) : ''
  const el = $('#ws-hint')
  if (!el || p !== fWorkspace()) return
  el.className = 'hint' + (r === 'file' ? ' err' : '')
  el.textContent = r === 'dir' ? 'Exists, will be used' : r === 'none' ? 'Created on hatch' : r === 'file' ? 'This is a file' : ''
  checkGit()
}, 200)
function updWs() {
  const el = $('#sec-ws')
  if (F.mode === 'edit') { el.innerHTML = `<div class="lab">Workspace</div><div class="ro ell sel">${esc(tilde(F.wsCustom, S.home))}</div>`; return }
  if (F.afterWs) { el.innerHTML = `<div class="lab">Workspace</div><div class="ro ell">${esc(tilde(F.afterWs, S.home))} <span class="faint">· shared with the team</span></div>`; return }
  el.innerHTML = `<div class="lab">Workspace</div><div class="row"><div class="ro ell grow sel" id="ws-path">${esc(tilde(fWorkspace(), S.home))}</div>
    <button type="button" class="btn sm" data-act="f-pick">Choose…</button>${F.wsCustom ? '<button type="button" class="btn sm ghost" data-act="f-unpick">Default</button>' : ''}</div><div class="hint" id="ws-hint"></div>`
  checkWs()
}
const checkGit = debounce(async () => {
  const el = $('#git-hint')
  if (!el || !F || F.mode === 'edit') return
  if (!F.gitUrl.trim()) { el.textContent = ''; return }
  const r = await hive.call('gitPlan', fWorkspace(), F.gitUrl, F.gitBranch)
  if (!$('#git-hint') || !r) return
  el.className = 'hint' + (r.kind === 'error' || r.error ? ' err' : '')
  el.textContent = r.text || r.error || ''
}, 300)
function updGit() {
  const el = $('#sec-git')
  if (F.mode === 'edit') { el.innerHTML = F.git ? `<div class="lab">Remote Git</div><div class="ro ell sel">${esc(F.git.url)}${F.git.branch ? ' @ ' + esc(F.git.branch) : ''}</div>` : ''; return }
  if (F.afterWs) { el.innerHTML = ''; return }
  if ($('#f-git-url')) return
  el.innerHTML = `<div class="lab">Git repo <span class="opt">optional</span></div><div class="row"><input type="text" id="f-git-url" class="grow" placeholder="Repo URL" spellcheck="false" value="${esc(F.gitUrl)}"><input type="text" id="f-git-branch" placeholder="Branch" style="width:150px" spellcheck="false" value="${esc(F.gitBranch)}"></div><div class="hint" id="git-hint"></div>`
}

function updEngine() {
  $('#sec-engine').innerHTML = S.engines.map(e => `<button type="button" class="engine${F.engine === e.id ? ' on' : ''}${e.installed && !e.custom ? ' ok' : ''}" data-act="f-engine" data-e="${e.id}" ${e.installed ? '' : 'disabled'}><b>${esc(e.label)}</b><span>${e.custom ? 'Your own CLI' : e.installed ? 'Installed' : 'Not found'}</span></button>`).join('')
  const e = eng(F.engine), el = $('#sec-model')
  if (e.template !== null) {
    if (!F.template) F.template = e.template || ''
    el.innerHTML = `<div class="lab" style="font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:6px">Command template</div><input type="text" id="f-template" style="width:100%" class="mono" spellcheck="false" placeholder="mycli run {prompt}" value="${esc(F.template)}"><div class="hint"><code>{prompt}</code> becomes the prompt; no shell involved</div>`
  } else {
    el.innerHTML = `<div class="row" style="flex-wrap:wrap"><span class="mute" style="font-size:12px">Model</span><div class="seg" id="model-seg"></div><input type="text" id="f-model" list="model-list" placeholder="or type a model name" style="width:190px" spellcheck="false" value="${esc(F.model)}"><datalist id="model-list">${e.models.map(m => `<option value="${esc(m)}">`).join('')}</datalist></div>`
    updModelSeg()
  }
  updBeh(); updPreview()
}
const updModelSeg = () => { const el = $('#model-seg'); if (el) el.innerHTML = [['', 'Default'], ...eng(F.engine).models.slice(0, 5).map(m => [m, m])].map(([v, l]) => `<button type="button" class="${F.model === v ? 'on' : ''}" data-act="f-model" data-m="${esc(v)}">${esc(l)}</button>`).join('') }

const MODES = [['manual', 'Manual'], ['adhoc', 'Once'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['interval', 'Interval'], ['event', 'Event']]
const EV_TYPES = [['commit', 'Git commit'], ['github', 'GitHub'], ['bee', 'A bee finishes']], EV_WHAT = [['pr', 'New pull request'], ['comment', 'New comment'], ['ci', 'CI failure']], EV_ON = [['done', 'Finishes'], ['error', 'Fails'], ['any', 'Either']]
// "On event": what the bee waits for
function eventFormHtml(e) {
  const seg = (list, cur, act) => `<div class="seg sm">${list.map(([k, l]) => `<button type="button" class="${cur === k ? 'on' : ''}" data-act="${act}" data-k="${k}">${l}</button>`).join('')}</div>`
  const others = S.agents.filter(a => !F.id || a.id !== F.id)
  const body = {
    commit: `<input type="text" data-input="f-ev-branch" value="${esc(e.branch)}" placeholder="Branch (current one if empty)" spellcheck="false" style="width:210px">${seg([['local', 'In this folder'], ['remote', 'On the remote']], e.remote ? 'remote' : 'local', 'f-ev-remote')}
      <div class="hint" style="width:100%;margin:0">${e.remote ? 'Fetches origin every 5 minutes and runs when the branch has new commits.' : 'Runs when the branch in this bee\'s folder gets new commits.'} The bee's own commits do not count.</div>`,
    github: `${EV_WHAT.map(([k, l]) => `<label class="check" style="align-items:center"><input type="checkbox" data-change="f-ev-what" data-k="${k}" ${e.what.includes(k) ? 'checked' : ''} style="margin:0">${l}</label>`).join('')}
      <div class="hint${S.hasGh ? '' : ' warn'}" style="width:100%;margin:0">${S.hasGh ? 'Asks GitHub every 5 minutes through the gh CLI, for the repository in this bee\'s folder.' : 'Needs the gh CLI, which was not found on this Mac. Install it and run "gh auth login".'}</div>`,
    bee: `${others.length ? `<div class="ev-bees">${others.map(a => `<label class="check" style="align-items:center"><input type="checkbox" data-change="f-ev-bee" data-k="${a.id}" ${e.ids.includes(a.id) ? 'checked' : ''} style="margin:0"><span class="dot" style="background:${esc(a.color)}"></span>${esc(a.name)}</label>`).join('')}</div>` : '<span class="hint" style="margin:0">No other bees yet</span>'}${seg(EV_ON, e.on, 'f-ev-on')}
      <div class="hint" style="width:100%;margin:0">Runs with that bee's last reply attached. Works across folders and squads.</div>`,
  }[e.type]
  return `${seg(EV_TYPES, e.type, 'f-ev-type')}<div class="ev-body">${body}</div><div class="ev-cool">At most once every <input type="number" min="0" max="1440" data-input="f-ev-cool" value="${e.cooldown}" style="width:70px"> min</div>`
}
// Daily also covers "weekdays only" and "weekends only": stored as a weekly schedule with those days, shown under Daily
const onlyOf = s => (s.mode !== 'weekly' ? '' : isWeekdays(s) ? 'weekdays' : isWeekends(s) ? 'weekends' : '')
function updSched() {
  const s = F.sched, time = `<input type="time" data-input="f-time" value="${esc(s.time)}">`
  const only = s.asDaily ? onlyOf(s) : '', shown = only ? 'daily' : s.mode
  const which = `<div class="seg sm">${[['', 'Every day'], ['weekdays', 'Weekdays'], ['weekends', 'Weekends']].map(([k, l]) => `<button type="button" class="${only === k ? 'on' : ''}" data-act="f-only" data-k="${k}">${l}</button>`).join('')}</div>`
  const extra = {
    manual: '', adhoc: `<input type="datetime-local" data-input="f-at" value="${esc(s.at)}">`, daily: `${time}${which}`,
    weekly: `<div class="days">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button type="button" class="${(s.days || []).includes(d) ? 'on' : ''}" data-act="f-day" data-d="${d}">${DAYS[d]}</button>`).join('')}<button type="button" class="wk" data-act="f-weekdays">Weekdays</button><button type="button" class="wk" data-act="f-weekends">Weekends</button></div>${time}`,
    monthly: `Day <input type="number" min="1" max="31" data-input="f-dom" value="${s.dom || 1}" style="width:70px"> ${time}<div class="hint" style="width:100%;margin:0">Shorter months run on their last day</div>`,
    interval: `Every <input type="number" min="5" max="1440" data-input="f-every" value="${s.every || 60}" style="width:84px"> min`,
    event: eventFormHtml(s.event),
  }[shown]
  $('#sec-sched').innerHTML = `<div class="seg">${MODES.map(([k, l]) => `<button type="button" class="${shown === k ? 'on' : ''}" data-act="f-mode" data-k="${k}">${l}</button>`).join('')}</div><div class="sched-extra">${extra}</div>`
}
const PERM = {
  ask: ['Ask', 'Waits for your OK on every action'],
  safe: ['Auto-edit', 'Edits files without asking; everything else follows the CLI\'s rules'],
  full: ['Allow all', 'Never asks. Only use in folders you trust'],
  plan: ['Plan', 'Reads and proposes a plan without changing anything'],
}
// The MCP servers from the user's Claude Code setup, ticked = this bee may use it
let CS = null
async function loadSetup(force) { const r = await hive.call('claudeSetup', force); if (r && !r.error) CS = r; if ($('#sec-beh')) updBeh(); if (view === 'skills') renderGarden() }
// every server off = start the session without MCP at all, which saves the most
function setMcpOff(off) { F.mcpOff = off; F.noMcp = !!CS && CS.servers.length > 0 && CS.servers.every(s => off.includes(s.name)); updBeh() }
const MCP_ST = { connected: '', 'needs-auth': 'needs sign-in', failed: 'failed', pending: 'connecting' }
function mcpHtml() {
  if (!CS) { loadSetup(); return '<div class="mcp-box"><div class="mute" style="font-size:12px">Looking up your MCP servers…</div></div>' }
  if (!CS.servers.length) return ''
  const off = name => F.noMcp || F.mcpOff.includes(name), on = CS.servers.filter(s => !off(s.name))
  return `<div class="mcp-box"><div class="row"><span class="mute grow" style="font-size:12px">MCP servers this bee may use · ${on.length} of ${CS.servers.length}, ${on.reduce((n, s) => n + s.tools, 0)} tools</span>
    <button type="button" class="btn sm ghost" data-act="f-mcp-all">All</button><button type="button" class="btn sm ghost" data-act="f-mcp-none">None</button><button type="button" class="btn sm ghost" data-act="f-mcp-refresh" title="Look again">${ICON.refresh}</button></div>
  <div class="mcp-list">${CS.servers.map(s => `<label class="check" title="${esc(s.name)}"><input type="checkbox" data-change="f-mcp" data-n="${esc(s.name)}" ${off(s.name) ? '' : 'checked'}><span class="ell">${esc(s.label)}<span class="faint"> · ${esc(s.source)}${s.tools ? ` · ${s.tools} tool${s.tools === 1 ? '' : 's'}` : ''}${MCP_ST[s.status] ? ' · ' + MCP_ST[s.status] : ''}</span></span></label>`).join('')}</div>
  <div class="hint">Unticked servers are left out of this bee's sessions, so their tool lists do not ride along on every round.</div></div>`
}
function updBeh() {
  const el = $('#sec-beh')
  if (!el) return
  const relay = F.mode === 'edit' ? F.inRelay : !!F.afterWs
  el.innerHTML = `<label class="check"><input type="checkbox" data-change="f-sleep" ${F.sleepResume ? 'checked' : ''}><span>Pause on lid close, resume on open</span></label>
  <label class="check"><input type="checkbox" data-change="f-fresh" ${F.freshSchedule ? 'checked' : ''}><span>Scheduled runs start a new session<span class="faint"> · keeps the cost of each run flat; memory and skills still carry over</span></span></label>
  ${F.engine === 'claude' ? `<label class="check"><input type="checkbox" data-change="f-noskills" ${F.noSkills ? 'checked' : ''}><span>No Claude Code skills<span class="faint"> · this bee cannot use any of the skills listed on the Skills page under "From Claude Code"</span></span></label>` + mcpHtml() : ''}
  <div><div class="row"><span class="mute" style="font-size:12px">Permissions</span><div class="seg">${Object.entries(PERM).map(([k, v]) => `<button type="button" class="${F.permission === k ? 'on' : ''}" data-act="f-perm" data-k="${k}">${v[0]}</button>`).join('')}</div></div>
    <div class="hint">${PERM[F.permission][1]}</div>${(F.permission === 'ask' || F.permission === 'plan') && F.engine !== 'claude' ? '<div class="hint warn">Only works with Claude Code; this engine runs as Auto-edit</div>' : ''}</div>
  ${relay ? '' : `<label class="check"><input type="checkbox" data-change="f-isolate" ${F.isolate ? 'checked' : ''}><span>Own branch<span class="faint"> · changes stay on its branch until you merge${F.mode === 'edit' ? '; switching starts a new session' : ''}</span></span></label>`}
  ${F.mode === 'edit' ? '' : `<label class="check"><input type="checkbox" data-change="f-start" ${F.startNow ? 'checked' : ''}><span>Start right after hatching</span></label>`}`
}

async function submitForm() {
  const s = F.sched, relay = F.mode === 'create' && F.after.ids.length
  const cfg = {
    name: F.name.trim(), task: (relay ? F.afterTask : F.task).trim(), workspace: relay ? '' : F.wsCustom, color: F.color, engine: F.engine, model: F.model.trim(), template: F.template,
    prompt: F.prompt, permission: F.permission, sleepResume: F.sleepResume, isolate: F.isolate, startNow: F.startNow, freshSchedule: F.freshSchedule, noMcp: F.noMcp, mcpOff: F.mcpOff, noSkills: F.noSkills,
    schedule: { mode: s.mode, time: s.time, at: s.at, every: +s.every, days: s.days, dom: +s.dom, event: s.mode === 'event' ? s.event : undefined },
    git: relay || F.mode === 'edit' ? null : { url: F.gitUrl.trim(), branch: F.gitBranch.trim() },
    after: F.after && F.after.ids.length ? { ids: F.after.ids, prompt: F.after.prompt, loop: F.after.loop } : null,
  }
  if (!cfg.name) return toast('Give the bee a name', 'err')
  if (F.mode === 'create' && !cfg.task) return toast('Enter a folder name', 'err')
  $('#f-submit').disabled = true
  const r = F.mode === 'edit' ? await call('update', F.id, cfg) : await call('create', cfg)
  if ($('#f-submit')) $('#f-submit').disabled = false
  if (!r) return
  $('#hatch').close()
  toast(F.mode === 'edit' ? 'Saved' : `${cfg.name} hatched`)
  F = null
}

// Form inputs
function syncWsPath() {
  if (!F.wsCustom && $('#ws-path')) { $('#ws-path').textContent = tilde(fWorkspace(), S.home); checkWs() }
  updPreview()
}
// Relay picked: the folder is locked to the team's folder
function lockTask() {
  const t = $('#f-task')
  if (!t) return
  t.disabled = !!F.afterWs
  t.value = F.afterWs ? F.afterTask : F.task
}
const INPUT = {
  'f-task': v => { F.task = v; F.taskTouched = true; syncWsPath() },
  'f-name': v => { F.name = v; if (F.mode === 'create' && !F.taskTouched && !F.wsCustom && !F.afterWs) { F.task = slugify(v); $('#f-task').value = F.task; syncWsPath() } },
  'f-git-url': v => {
    F.gitUrl = v
    const repo = v.trim().replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop()
    if (repo && !F.taskTouched && !F.wsCustom) { F.task = repo; $('#f-task').value = repo; syncWsPath() }
    checkGit()
  },
  'f-git-branch': v => { F.gitBranch = v; checkGit() },
  'f-model': v => { F.model = v; updModelSeg() },
  'f-template': v => { F.template = v; updPreview() },
  'f-prompt': v => { F.prompt = v },
  'f-after-prompt': v => { F.after.prompt = v; if (F.after.role && F.after.role !== 'custom' && v !== S.presets[F.after.role].prompt) { F.after.role = 'custom'; document.querySelectorAll('[data-act="f-role"]').forEach(b => b.classList.toggle('on', b.dataset.k === 'custom')) } },
  'f-ev-branch': v => { F.sched.event.branch = v }, 'f-ev-cool': v => { F.sched.event.cooldown = Math.max(0, +v || 0) },
  'f-time': v => { F.sched.time = v }, 'f-at': v => { F.sched.at = v }, 'f-dom': v => { F.sched.dom = v }, 'f-every': v => { F.sched.every = v },
}
const CHANGE = {
  'f-after': el => {
    const row = [...el.closest('.relay-row').querySelectorAll('input:checked')].map(i => i.value)      // ticks are limited to one row
    setAfter(row); updRelay(); updWs(); updGit(); updEngine(); lockTask()
  },
  'f-loop': el => { F.after.loop = el.checked },
  'f-ev-what': el => { const s = new Set(F.sched.event.what); el.checked ? s.add(el.dataset.k) : s.delete(el.dataset.k); F.sched.event.what = [...s] },
  'f-ev-bee': el => { const s = new Set(F.sched.event.ids); el.checked ? s.add(el.dataset.k) : s.delete(el.dataset.k); F.sched.event.ids = [...s] },
  'f-sleep': el => { F.sleepResume = el.checked },
  'f-fresh': el => { F.freshSchedule = el.checked },
  'f-noskills': el => { F.noSkills = el.checked },
  'f-mcp': el => { const n = el.dataset.n, off = new Set(F.noMcp && CS ? CS.servers.map(s => s.name) : F.mcpOff); el.checked ? off.delete(n) : off.add(n); setMcpOff([...off]) },
  'f-isolate': el => { F.isolate = el.checked },
  'f-start': el => { F.startNow = el.checked },
}

// ───────── Dashboard ─────────
function buildDash() {
  $('#v-dash').innerHTML = `
  <div class="page-head"><div class="grow"><h1 class="round">Dashboard</h1></div>
    <div class="dash-ctl"><input type="date" id="d-date"> Budget $<input type="number" id="d-budget" min="0" step="1" placeholder="No limit"> Report <input type="time" id="d-time">
    <span title="A Claude Code bee whose session is fuller than this is compacted before its next round. With a 1M-token window the percentage counts against 200k. 0 turns it off">Compact at <input type="number" id="d-compact" min="0" max="95" step="5">%</span>
    <label class="check" style="align-items:center" title="A session over 100k tokens that sat idle for an hour has lost its prompt cache; compact it before the next round instead of re-reading all of it"><input type="checkbox" id="d-cold">and when idle</label>
    <span title="Model for the daily report, Dreamer and Gardener">Chores <select id="d-chore"><option value="">Default</option><option value="haiku">haiku</option><option value="sonnet">sonnet</option><option value="opus">opus</option></select></span>
    <button class="btn primary" data-act="queen-report" id="d-go">Generate report</button></div></div>
  <div id="dash-body"></div>`
  $('#d-date').addEventListener('change', e => { dashDate = e.target.value || dayKey(); loadDash() })
  $('#d-budget').addEventListener('change', async e => { const r = await call('settings', { budget: +e.target.value || 0 }); if (r) { S.settings = r; renderDash() } })
  const set = async patch => { const r = await call('settings', patch); if (r) S.settings = r }
  $('#d-compact').addEventListener('change', e => set({ compactAt: +e.target.value || 0 }))
  $('#d-cold').addEventListener('change', e => set({ compactCold: e.target.checked }))
  $('#d-chore').addEventListener('change', e => set({ choreModel: e.target.value }))
  $('#d-time').addEventListener('change', async e => { const r = await call('settings', { reportTime: e.target.value }); if (r) { S.settings = r; renderHive() } })
}
async function loadDash() {
  if (view !== 'dash') return
  $('#d-date').value = dashDate; $('#d-date').max = dayKey()
  if (document.activeElement !== $('#d-budget')) $('#d-budget').value = S.settings.budget || ''
  $('#d-time').value = S.settings.reportTime || '18:00'
  if (document.activeElement !== $('#d-compact')) $('#d-compact').value = S.settings.compactAt || 0
  $('#d-cold').checked = S.settings.compactCold !== false; $('#d-chore').value = S.settings.choreModel || ''
  const r = await call('stats', dashDate)
  if (r) { dashData = r; renderDash() }
}
const loadDashSoon = debounce(loadDash, 1500)
function renderDash() {
  const d = dashData
  if (view !== 'dash' || !d) return
  const A = S.agents, st = id => d.agents.find(x => x.id === id) || { runs: 0, ms: 0, usd: 0, tok: 0, segs: [], week: [], last: '' }
  const sum = k => d.agents.reduce((n, x) => n + x[k], 0), today = d.date === dayKey()
  const active = d.agents.filter(x => x.runs || x.segs.length).length, need = A.filter(a => a.status === 'error' || a.status === 'paused' || (a.approvals && a.approvals.length))
  const budget = S.settings.budget, usd = today ? Math.max(sum('usd'), S.spend.day === d.date ? S.spend.usd : 0) : sum('usd')
  $('#d-go').disabled = queenBusy; $('#d-go').textContent = queenBusy ? 'Writing…' : 'Generate report'
  const kpi = (k, v, s, cls = '') => `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`
  const now = Date.now(), pct = t => Math.max(0, Math.min(100, (t - d.start) / 864000))
  const rows = A.filter(a => st(a.id).segs.length)
  setHtml($('#dash-body'), `
  <div class="kpis">
    ${kpi('Active', `${active} <small>/ ${A.length}</small>`, '')}
    ${kpi('Runtime', fmtMin(sum('ms')), `${sum('runs')} runs`)}
    ${kpi('Spend', fmtUsd(usd), `${fmtTok(sum('tok'))} · budget ${budget ? '$' + budget : 'none'}`, budget && usd >= budget ? 'alert' : '')}
    ${kpi('Scheduled', A.filter(scheduled).length, '')}
    ${kpi('Needs you', need.length, need.length ? esc(need.map(a => a.name).join(', ')) : '', need.length ? 'alert' : '')}
  </div>
  <div class="panel report"><h3 class="round">${queenSvg(26)}Report</h3>${d.report ? `<div class="md">${reportHtml(d.report)}</div>` : `<div class="mute">${queenBusy ? 'Writing…' : 'None yet'}</div>`}</div>
  <div class="panel"><h3 class="round">Activity</h3>${rows.length ? `<div class="tl">${rows.map(a => `<div class="who"><span class="dot" style="background:${esc(a.color)}"></span><span class="ell">${esc(a.name)}</span></div><div class="track">${st(a.id).segs.map(g => `<i style="left:${pct(g[0])}%;width:${Math.max(.15, pct(g[1]) - pct(g[0]))}%"></i>`).join('')}${today ? `<span class="now" style="left:${pct(now)}%"></span>` : ''}</div>`).join('')}
    <div></div><div class="axis">${[0, 6, 12, 18, 24].map(h => `<span style="left:${h / 24 * 100}%">${h}:00</span>`).join('')}</div></div>` : '<div class="mute">No activity</div>'}</div>
  <div class="panel"><h3 class="round">Bees</h3>${A.length ? `<table class="atable"><thead><tr><th>Name</th><th>Task</th><th>Status</th><th>Runtime</th><th>Spend</th><th>7 days</th><th>Last message</th></tr></thead><tbody>${A.map(a => {
    const x = st(a.id), mx = Math.max(1, ...x.week)
    return `<tr data-act="chat" data-id="${a.id}"><td><div class="row">${beeOf(a, 24)}<b>${esc(a.name)}</b></div></td><td>${esc(a.task)}</td><td>${pill(a.status)}</td><td>${x.runs ? `${x.runs} run${x.runs === 1 ? '' : 's'} · ${fmtMin(x.ms)}` : '<span class="faint">—</span>'}</td><td>${x.usd ? fmtUsd(x.usd) : x.tok ? fmtTok(x.tok) : '<span class="faint">—</span>'}</td><td>${x.week.some(Boolean) ? `<span class="spark">${x.week.map(v => `<i style="height:${Math.round(v / mx * 100)}%"></i>`).join('')}</span>` : '<span class="faint">—</span>'}</td><td class="said"><div class="ell">${esc(x.last) || '<span class="faint">—</span>'}</div></td></tr>`
  }).join('')}</tbody></table>` : '<div class="mute">No bees yet</div>'}</div>`)
}

// ───────── Skills / Memory ─────────
async function loadGarden() {
  const r = await call('garden')
  if (r) { G = r; renderGarden() }
}
function nightHtml(k) {
  const m = G.meta[k], n = G.night[k], busy = G.busy.includes(k), l = n.last
  const what = !l ? '' : k === 'gardener' ? (l.changed.length ? `skills: ${l.changed.join(', ')}` : 'no new skills') : (l.changed.length ? `updated ${l.changed.length} memor${l.changed.length === 1 ? 'y' : 'ies'}` : 'no memory changes')
  const duty = k === 'gardener' ? 'Distills reusable skills from new conversations' : 'Tidies shared memory and each bee\'s memory'
  return `<div class="night ${k}">${beeSvg(m.color, k === 'dreamer' ? 'sleep' : 'happy', 46, false, busy ? 'running' : k === 'dreamer' ? 'sleeping' : 'idle')}
  <div class="info"><b class="round">${m.name}</b><span class="when">Daily <input type="time" data-night="${k}" value="${esc(n.time)}"></span>
    <div class="last">${l ? `Last ${whenText(new Date(l.t)) || ''} · ${l.agents} bee${l.agents === 1 ? '' : 's'} · ${esc(what)}${l.summary ? `<br>${esc(l.summary)}` : ''}` : duty}</div></div>
  <button class="btn" data-act="night-now" data-k="${k}" ${busy ? 'disabled' : ''}>${busy ? `${m.verb[0].toUpperCase()}${m.verb.slice(1)}…` : 'Run now'}</button></div>`
}
// Skills page: what Claude Code itself brings to every Claude bee, apart from the hive's own skills
function setupHtml() {
  if (!CS) { loadSetup(); return '<div class="setup-sec"><h2 class="round">From Claude Code</h2><div class="mute">Looking…</div></div>' }
  if (CS.missing) return ''
  const groups = {}
  for (const s of CS.skills) { const i = s.indexOf(':'), g = i > 0 ? s.slice(0, i) : 'Your own and built-in'; (groups[g] = groups[g] || []).push(i > 0 ? s.slice(i + 1) : s) }
  const usedBy = s => S.agents.filter(a => a.engine === 'claude' && !a.noMcp && !(a.mcpOff || []).includes(s.name)).length, bees = S.agents.filter(a => a.engine === 'claude').length
  return `<div class="setup-sec"><div class="row"><h2 class="round grow">From Claude Code</h2><button class="btn sm ghost" data-act="setup-refresh">${ICON.refresh}Refresh</button></div>
  <div class="mute" style="margin:-4px 0 10px">Every Claude Code bee starts with these, on top of the hive's skills above. Choose a bee's MCP servers in its settings.</div>
  <div class="setup-mod"><div class="hd">MCP servers <span class="faint">${CS.servers.length}</span></div>${CS.servers.length ? `<div class="setup-rows">${CS.servers.map(s => `<div class="r"><span class="nm ell">${esc(s.label)}</span><span class="faint ell">${esc(s.source)}</span><span class="faint">${s.tools ? s.tools + ' tools' : MCP_ST[s.status] || '—'}</span><span class="faint">${bees ? `${usedBy(s)} of ${bees} bee${bees === 1 ? '' : 's'}` : ''}</span></div>`).join('')}</div>` : '<div class="faint">None</div>'}</div>
  <div class="setup-mod"><div class="hd">Skills <span class="faint">${CS.skills.length}${bees ? ` · used by ${S.agents.filter(a => a.engine === 'claude' && !a.noSkills).length} of ${bees} bee${bees === 1 ? '' : 's'}; switch them off per bee in its settings` : ''}</span></div>${Object.entries(groups).map(([g, list]) => `<div class="grp"><span class="g">${esc(g)}</span>${list.map(n => `<span class="chip">${esc(n)}</span>`).join('')}</div>`).join('') || '<div class="faint">None</div>'}</div></div>`
}
function renderGarden() {
  if (!G) return
  if (view === 'skills') {
    const card = s => {
      const editing = false, open = skillOpen.has(s.name)                  // editing happens in a window of its own (openSkillEditor)
      return `<div class="skill${editing || open ? ' wide' : ''}"><div class="top">${ICON.sprout}<span class="nm ell grow">${esc(s.name)}</span><span class="faint" style="font-size:11.5px">${dayKey(new Date(s.mtime)).slice(5)}</span></div>
      ${editing ? `<textarea id="skill-text" spellcheck="false">${esc(s.raw)}</textarea><div class="acts"><button class="btn sm primary" data-act="skill-save" data-n="${esc(s.name)}">Save</button><button class="btn sm" data-act="skill-cancel">Cancel</button></div>`
    : `<div class="desc">${esc(s.description) || '<span class="faint">No description</span>'}</div>${open ? `<div class="body md">${renderMd(s.body)}</div>` : ''}
      <div class="acts"><button class="btn sm ghost" data-act="skill-open" data-n="${esc(s.name)}">${open ? 'Hide' : 'View'}</button><button class="btn sm ghost" data-act="skill-edit" data-n="${esc(s.name)}">Edit</button>
      <label class="check" style="font-size:12.5px;align-items:center" title="Symlinks it at ~/.claude/skills/hive-${esc(s.name)}"><input type="checkbox" data-link="${esc(s.name)}" ${s.linked ? 'checked' : ''} style="margin:0">Install in Claude Code</label><span class="sp"></span>
      <button class="btn sm icon ghost danger" data-act="skill-del" data-n="${esc(s.name)}" title="Delete">${ICON.trash}</button></div>`}</div>`
    }
    const fresh = false ? `<div class="skill wide"><div class="top">${ICON.sprout}<input type="text" id="skill-name" class="grow mono" placeholder="skill-name" spellcheck="false"></div>
      <textarea id="skill-text" spellcheck="false">---\nname: \ndescription: One line on when to use it\n---\n\n## Steps\n\n1. </textarea><div class="acts"><button class="btn sm primary" data-act="skill-save" data-n="+">Save</button><button class="btn sm" data-act="skill-cancel">Cancel</button></div></div>` : ''
    $('#v-skills').innerHTML = `<div class="page-head"><div class="grow"><h1 class="round">Skills</h1></div>
      <button class="btn" data-act="open-garden" data-k="skills">${ICON.folder}Folder</button><button class="btn primary" data-act="skill-new">${ICON.plus}New</button></div>
      ${nightHtml('gardener')}<div class="sgrid">${fresh}${G.skills.map(card).join('')}</div>${G.skills.length || fresh ? '' : '<div class="guide">No skills yet</div>'}${setupHtml()}`
  }
  if (view === 'memory') {
    const card = (key, head, md) => {
      const editing = memEdit === key, open = memOpen.has(key)
      return `<div class="mem"><div class="top">${head}</div>
      ${editing ? `<textarea id="mem-text" spellcheck="false">${esc(md)}</textarea><div class="acts"><button class="btn sm primary" data-act="mem-save" data-k="${key}">Save</button><button class="btn sm" data-act="mem-cancel">Cancel</button></div>`
    : `${md ? `<div class="body md${open ? '' : ' clip'}">${renderMd(md)}</div>` : '<div class="faint">Empty</div>'}
      <div class="acts">${md ? `<button class="btn sm ghost" data-act="mem-open" data-k="${key}">${open ? 'Collapse' : 'Expand'}</button>` : ''}<button class="btn sm ghost" data-act="mem-edit" data-k="${key}">${md ? 'Edit' : 'Write'}</button></div>`}</div>`
    }
    $('#v-memory').innerHTML = `<div class="page-head"><div class="grow"><h1 class="round">Memory</h1></div>
      <label class="check" style="align-items:center"><input type="checkbox" id="mem-inject" ${G.memoryInject ? 'checked' : ''}>Give new sessions memory and skills</label>
      <button class="btn" data-act="open-garden" data-k="memory">${ICON.folder}Folder</button></div>
      ${nightHtml('dreamer')}<div class="sgrid">${card('hive', `<span class="mem-hive">${ICON.hive || ''}</span><b class="round">Shared memory</b><span class="faint ell" style="font-size:12px">drawn from every bee, given to every bee</span>`, G.hive)}
      ${S.agents.map(a => card(a.id, `<span class="dot" style="background:${esc(a.color)}"></span><b class="round">${esc(a.name)}</b><span class="faint ell" style="font-size:12px">${esc(a.task)}</span>`, G.agents[a.id] || '')).join('')}</div>`
  }
}

// A skill is written and edited in a window of its own
function openSkillEditor() {
  const isNew = skillEdit === '+', s = isNew ? null : G.skills.find(x => x.name === skillEdit)
  if (!isNew && !s) { skillEdit = null; return }
  $('#editor').innerHTML = `
  <div class="dlg-head"><span class="ed-ic">${ICON.sprout}</span><div class="grow"><h2 class="round">${isNew ? 'New skill' : 'Edit skill'}</h2>${isNew ? '' : `<div class="mono faint" style="font-size:12.5px">${esc(s.name)}</div>`}</div><button type="button" class="btn icon ghost" data-act="skill-cancel">${ICON.x}</button></div>
  <div class="dlg-body">${isNew ? `<div class="field"><div class="lab">Name <span class="opt">lowercase letters, digits and hyphens</span></div><input type="text" id="skill-name" class="mono" style="width:100%" placeholder="skill-name" spellcheck="false"></div>` : ''}
    <textarea id="skill-text" spellcheck="false">${esc(isNew ? '---\nname: \ndescription: One line on when to use it\n---\n\n## Steps\n\n1. ' : s.raw)}</textarea></div>
  <div class="dlg-foot"><span class="hint grow">⌘↩ to save</span><button type="button" class="btn" data-act="skill-cancel">Cancel</button><button type="button" class="btn primary" data-act="skill-save" data-n="${esc(isNew ? '+' : s.name)}">Save</button></div>`
  if (!$('#editor').open) $('#editor').showModal()
  ;(isNew ? $('#skill-name') : $('#skill-text')).focus()
}
$('#editor').addEventListener('close', () => { skillEdit = null; if (view === 'skills') loadGarden() })
$('#editor').addEventListener('keydown', e => { if (e.metaKey && e.key === 'Enter') { e.preventDefault(); $('#editor [data-act="skill-save"]').click() } })

// The report's bee headings read "Name · project · what it does": the name stays bold, the rest steps back; a known bee gets its colour dot
function reportHtml(md) {
  return renderMd(md).replace(/<h3>([^<]*?) · ([^<]*)<\/h3>/g, (m, name, rest) => {
    const bee = S.agents.find(a => a.name === name.trim()), parts = rest.split(' · ')
    return `<h3 class="rp-bee">${bee ? `<span class="dot" style="background:${esc(bee.color)}"></span>` : ''}${name}<span class="proj">${parts[0]}</span>${parts.length > 1 ? `<span class="job">${parts.slice(1).join(' · ')}</span>` : ''}</h3>`
  })
}
// ───────── Files page ─────────
// What the bees produced: files they wrote or named, and links they gave. Newest first, by bee and by kind
const OUT = { items: null, shown: [], type: 'main', bee: '', q: '' }
const OUT_TYPES = [['main', 'Documents & links', x => x.type !== 'code'], ['doc', 'Documents', x => x.type === 'doc'], ['image', 'Images', x => x.type === 'image' || x.type === 'media'], ['link', 'Links', x => x.kind === 'link'], ['code', 'Code', x => x.type === 'code'], ['all', 'All', () => true]]
async function loadOutputs() {
  const r = await hive.call('outputs')
  OUT.items = Array.isArray(r) ? r : []
  if (view === 'files') renderOutputs()
}
const loadOutputsSoon = debounce(() => { if (view === 'files') loadOutputs() }, 2500)
const dayLabel = t => { const k = dayKey(new Date(t)), d = new Date(); if (k === dayKey(d)) return 'Today'; d.setDate(d.getDate() - 1); return k === dayKey(d) ? 'Yesterday' : new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) }
const outSize = n => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
function renderOutputs() {
  const el = $('#v-files'), all = OUT.items
  if (!el.querySelector('#out-q')) {
    el.innerHTML = `<div class="page-head"><div class="grow"><h1 class="round">Files</h1><div class="mute" id="out-sub"></div></div>
      <div class="search">${ICON.search}<input type="search" id="out-q" placeholder="File name, link, bee or project" spellcheck="false"></div><button class="btn" data-act="out-refresh">${ICON.refresh}Refresh</button></div>
      <div class="chips" id="out-types"></div><div class="chips sub" id="out-bees"></div><div id="out-list"></div>`
    $('#out-q').addEventListener('input', e => { OUT.q = e.target.value.trim().toLowerCase(); renderOutputs() })
  }
  if (!all) return setHtml($('#out-list'), '<div class="guide">Looking through the bees\' work…</div>')
  const beeOfItem = x => byId(x.bee), q = OUT.q
  const text = x => { const b = beeOfItem(x) || {}; return [x.name, x.dir, x.url, x.label, x.site, b.name, b.task].join(' ').toLowerCase() }
  const inQ = all.filter(x => !q || text(x).includes(q)), inBee = inQ.filter(x => !OUT.bee || x.bee === OUT.bee)
  const pick = OUT_TYPES.find(t => t[0] === OUT.type) || OUT_TYPES[0]
  OUT.shown = inBee.filter(x => (x.kind === 'link' ? ['main', 'link', 'all'].includes(pick[0]) : pick[2](x)))
  $('#out-sub').textContent = all.length ? `${all.filter(x => x.kind === 'file').length} files and ${all.filter(x => x.kind === 'link').length} links from ${new Set(all.map(x => x.bee)).size} bee${new Set(all.map(x => x.bee)).size === 1 ? '' : 's'}` : ''
  setHtml($('#out-types'), OUT_TYPES.map(([k, l, f]) => `<button class="chip${OUT.type === k ? ' on' : ''}" data-act="out-type" data-k="${k}">${l}<span class="n">${inBee.filter(x => (x.kind === 'link' ? ['main', 'link', 'all'].includes(k) : f(x))).length}</span></button>`).join(''))
  const counts = new Map()
  for (const x of inQ) counts.set(x.bee, (counts.get(x.bee) || 0) + 1)
  setHtml($('#out-bees'), [...counts].map(([id, n]) => [byId(id), n]).filter(([a]) => a).sort((x, y) => y[1] - x[1]).map(([a, n]) => `<button class="chip${OUT.bee === a.id ? ' on' : ''}" data-act="out-bee" data-id="${a.id}" title="${esc(a.task)}"><span class="dot" style="background:${esc(a.color)}"></span>${esc(a.name)}<span class="n">${n}</span></button>`).join(''))
  if (!OUT.shown.length) return setHtml($('#out-list'), `<div class="guide">${all.length ? 'Nothing matches' : 'Nothing yet. Files a bee writes or names in a reply, and links it gives, show up here.'}</div>`)
  let day = '', html = ''
  OUT.shown.slice(0, 400).forEach((x, i) => {
    const d = dayLabel(x.t), b = beeOfItem(x) || { name: 'Gone', color: '#ccc', task: '' }
    if (d !== day) { day = d; html += `<div class="out-day">${d}</div>` }
    const icon = x.kind === 'link' ? ICON.link : x.type === 'doc' ? ICON.doc : x.type === 'code' ? ICON.codefile : ICON.image
    const ext = x.kind === 'link' ? x.site : (x.name.includes('.') ? x.name.split('.').pop().toUpperCase() : 'FILE')
    html += `<div class="out-row k-${x.kind === 'link' ? 'link' : x.type}"><button class="main" data-act="out-open" data-i="${i}" title="${esc(x.kind === 'link' ? x.url : x.abs)}">
      <span class="ico">${icon}</span><span class="tx"><span class="nm ell">${esc(x.kind === 'link' ? x.label || x.url.replace(/^https?:\/\//, '') : x.name)}</span><span class="sub ell">${esc(x.kind === 'link' ? x.url : x.dir)}</span></span></button>
      <span class="tag">${esc(ext)}</span>
      <button class="who" data-act="out-bee-open" data-i="${i}" title="${x.kind === 'link' ? `Open ${esc(b.name)}'s chat where this link came up` : `Open in ${esc(b.name)}'s window`}"><span class="dot" style="background:${esc(b.color)}"></span><b>${esc(b.name)}</b><span class="ell">${esc(b.task)}</span></button>
      <span class="when">${hm(x.t)}${x.kind === 'file' ? ` · ${outSize(x.size)}` : ''}</span>
      <span class="acts">${x.kind === 'file' ? `<button class="btn sm icon ghost" data-act="out-reveal" data-i="${i}" title="Show in Finder">${ICON.finder}</button>` : ''}<button class="btn sm icon ghost" data-act="out-copy" data-i="${i}" title="${x.kind === 'link' ? 'Copy link' : 'Copy path'}">${ICON.link}</button></span></div>`
  })
  setHtml($('#out-list'), html + (OUT.shown.length > 400 ? `<div class="guide">Showing the newest 400 of ${OUT.shown.length}. Search or pick a bee to narrow it down.</div>` : ''))
}

// ───────── Search everywhere ─────────
// Beyond bee names: skills, memory, conversations and groups that mention the text. Used by the Hive search box and by ⌘K
let FOUND = { q: '', items: [], busy: false }, foundSeq = 0, foundTimer = null
const markSnip = h => (h ? `${esc(h.text.slice(0, h.at))}<b>${esc(h.text.slice(h.at, h.at + h.len))}</b>${esc(h.text.slice(h.at + h.len))}` : '')
const dotOf = c => `<span class="dot" style="background:${esc(c || '#ccc')}"></span>`
function foundItems(r) {
  const reveal = (v, sel) => { show(v); setTimeout(() => { const el = document.querySelector(sel); if (el) { const c = el.closest('.skill, .mem'); c.scrollIntoView({ block: 'center' }); c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 1600) } }, 350) }
  return [
    ...r.skills.map(s => ({ group: 'Skills', icon: ICON.sprout, label: s.name, snip: s.hit ? markSnip(s.hit) : esc(s.description), run: () => { skillOpen.add(s.name); reveal('skills', `[data-act="skill-open"][data-n="${CSS.escape(s.name)}"]`) } })),
    ...r.memory.map(m => ({ group: 'Memory', icon: m.key === 'hive' ? ICON.hive : dotOf(m.color), label: m.title, snip: markSnip(m.hit), run: () => { memOpen.add(m.key); reveal('memory', `[data-act="mem-edit"][data-k="${CSS.escape(m.key)}"]`) } })),
    ...r.chats.map(c => ({ group: 'Conversations', icon: dotOf(c.color), label: c.name, who: c.role === 'user' ? 'You' : c.name, t: c.t, snip: markSnip(c.hit), run: () => call('openChat', c.id, '', r.q) })),
    ...r.rooms.map(g => ({ group: 'Groups', icon: ICON.chat, label: g.name, who: g.who, t: g.t, snip: markSnip(g.hit), run: () => openRoom(g.id) })),
  ]
}
function searchMore(q, done) {
  clearTimeout(foundTimer)
  q = String(q || '').trim()
  const seq = ++foundSeq
  if (q.length < 2) { FOUND = { q, items: [], busy: false }; return done() }
  FOUND = { q, items: FOUND.q === q ? FOUND.items : [], busy: true }; done()
  foundTimer = setTimeout(async () => {
    const r = await hive.call('searchAll', q)
    if (seq !== foundSeq) return
    FOUND = { q, items: r && !r.error ? foundItems(r) : [], busy: false }
    done()
  }, 220)
}
const foundRow = (x, i, act) => `<button class="found-row" data-act="${act}" data-i="${i}">${x.icon}<span class="lb">${esc(x.label)}</span><span class="sn ell">${x.who && x.who !== x.label ? `<i>${esc(x.who)}:</i> ` : ''}${x.snip}</span>${x.t ? `<span class="ago">${ago(x.t)}</span>` : ''}</button>`
function renderFound() {
  const el = $('#found')
  if (!el) return
  if (!query || FOUND.q.toLowerCase() !== query || (!FOUND.items.length && FOUND.busy)) return setHtml(el, '')
  const none = !FOUND.items.length && !S.agents.some(matches)
  let html = '', group = ''
  FOUND.items.forEach((x, i) => { if (x.group !== group) { group = x.group; html += `<div class="found-h">${group}</div>` } html += foundRow(x, i, 'found') })
  setHtml(el, none ? `<div class="guide">Nothing matches “${esc(FOUND.q)}” in bees, skills, memory or conversations</div>` : html)
}

// ───────── ⌘K ─────────
let palItems = [], palSel = 0
function palAll() {
  return [
    { label: 'Hatch', icon: ICON.plus, kbd: '⌘N', run: () => openHatch() },
    { label: 'Hive', icon: ICON.hive, run: () => show('hive') }, { label: 'Dashboard', icon: ICON.chart, run: () => show('dash') },
    { label: 'Skills', icon: ICON.sprout, run: () => show('skills') }, { label: 'Memory', icon: ICON.brain, run: () => show('memory') },
    { label: 'Chat with Queen', icon: ICON.crown, kbd: '⌘J', run: () => openQueenRoom() },
    { label: 'New group', icon: ICON.plus, run: () => openGroup() },
    ...R.rooms.map(r => ({ label: `Group: ${r.name}`, icon: ICON.chat, st: r.queen ? 'Queen leads' : 'No Queen', run: () => openRoom(r.id) })),
    { label: 'Generate daily report', icon: ICON.crown, run: () => { dashDate = dayKey(); show('dash'); ACT['queen-report']() } },
    { label: 'Run Gardener now', icon: ICON.sprout, run: () => { show('skills'); call('nightNow', 'gardener') } },
    { label: 'Run Dreamer now', icon: ICON.moon, run: () => { show('memory'); call('nightNow', 'dreamer') } },
    ...S.agents.map((a, i) => ({ label: a.name, icon: `<span class="dot" style="background:${esc(a.color)}"></span>`, st: `${STATUS[a.status]} · ${a.task}`, kbd: i < 9 ? '⌘' + (i + 1) : '', run: () => call('openChat', a.id) })),
  ]
}
function renderPal() {
  const q = $('#pal-input').value.trim().toLowerCase()
  const more = q && FOUND.q.toLowerCase() === q ? FOUND.items : []
  palItems = [...palAll().filter(x => !q || (x.label + ' ' + (x.st || '')).toLowerCase().includes(q)), ...more]
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1))
  let group = ''
  $('#pal-list').innerHTML = palItems.length ? palItems.map((x, i) => {
    const head = x.group && x.group !== group ? `<div class="found-h">${x.group}</div>` : ''
    group = x.group || ''
    return head + `<button class="item${i === palSel ? ' on' : ''}" data-act="pal" data-i="${i}">${x.icon}<span class="lb">${esc(x.label)}</span>${x.snip ? `<span class="st sn ell">${x.who && x.who !== x.label ? `<i>${esc(x.who)}:</i> ` : ''}${x.snip}</span>` : x.st ? `<span class="st ell">${esc(x.st)}</span>` : ''}${x.kbd ? `<kbd>${x.kbd}</kbd>` : ''}</button>`
  }).join('') : `<div class="none">${q && FOUND.busy ? 'Searching…' : 'No results'}</div>`
  const on = $('#pal-list .item.on')
  if (on) on.scrollIntoView({ block: 'nearest' })
}
function togglePal(open = $('#palette').hidden) {
  $('#palette').hidden = !open
  if (open) { $('#pal-input').value = ''; palSel = 0; renderPal(); $('#pal-input').focus() }
}
const palRun = i => { const x = palItems[i]; togglePal(false); if (x) x.run() }
const foundRun = i => { const x = FOUND.items[i]; if (x) x.run() }

// ───────── Click actions ─────────
const act = (id, name, text, opts) => call('action', id, name, text, opts)
const ACT = {
  view: el => show(el.dataset.view),
  filter: el => { filter = el.dataset.f; renderHive() },
  sub: el => { sub = el.dataset.k; renderHive() },
  hatch: () => openHatch(),
  relay: el => openHatch({ after: el.dataset.id }),
  edit: el => openHatch({ edit: el.dataset.id }),
  'hatch-close': () => { $('#hatch').close(); F = null },
  chat: el => call('openChat', el.dataset.id, el.dataset.tab || ''),
  feed: el => { const n = S.night[el.dataset.id]; if (el.dataset.id === 'hive') openPrefs(); else if (String(el.dataset.id).startsWith('room:')) openRoom(el.dataset.id.slice(5)); else if (n) show(n.view); else if (byId(el.dataset.id)) call('openChat', el.dataset.id); else toast('No longer exists') },
  run: el => act(el.dataset.id, 'run'),
  pause: el => act(el.dataset.id, 'pause'),
  continue: el => act(el.dataset.id, 'continue'),
  stop: el => { const a = byId(el.dataset.id); if (a && confirm(`Stop ${a.name}?`)) act(a.id, 'stop') },
  delete: el => {
    const a = byId(el.dataset.id)
    if (!a) return
    const extra = a.isolate && a.worktree ? '\nIts worktree is removed; the branch is kept.' : Team.inTeam(S.agents, a.id) ? '\nIts relay team is relinked or disbanded.' : ''
    if (confirm(`Delete ${a.name}? Its chat history is deleted; the folder is untouched.${extra}`)) act(a.id, 'delete')
  },
  'team-stop': el => {
    const team = Team.teamOf(S.agents, el.dataset.id)
    if (!confirm('Stop this team?')) return
    for (const m of team) act(m.id, ['running', 'paused'].includes(m.status) ? 'stop' : 'unqueue')
  },
  'view-report': () => { dashDate = dayKey(); show('dash') },
  'queen-report': () => { queenBusy = true; renderDash(); call('queenReport', dashDate) },
  // Form
  'f-rename': () => { F.name = pickName(); $('#f-name').value = F.name; INPUT['f-name'](F.name) },
  'f-color': el => { F.color = el.dataset.c; updColor(); updHead() },
  'f-engine': el => { F.engine = el.dataset.e; F.engineTouched = true; F.model = ''; F.template = ''; updEngine() },
  'f-model': el => { F.model = el.dataset.m; $('#f-model').value = F.model; updModelSeg() },
  'f-role': el => { F.after.role = el.dataset.k; if (F.after.role !== 'custom') F.after.prompt = S.presets[F.after.role].prompt; if (F.after.role !== 'review') F.after.loop = false; updRelay() },
  'f-pick': async () => { const p = await call('pickFolder'); if (typeof p === 'string' && p) { F.wsCustom = p; F.task = p.replace(/\/+$/, '').split('/').pop(); F.taskTouched = true; $('#f-task').value = F.task; updWs(); updPreview() } },
  'f-unpick': () => { F.wsCustom = ''; updWs(); updPreview() },
  'f-mode': el => { F.sched.mode = el.dataset.k; F.sched.asDaily = false; updSched() },
  'f-day': el => { const d = +el.dataset.d, s = new Set(F.sched.days || []); s.has(d) ? s.delete(d) : s.add(d); F.sched.days = [...s].sort(); updSched() },
  'f-weekdays': () => { F.sched.days = [1, 2, 3, 4, 5]; updSched() },
  'f-weekends': () => { F.sched.days = [0, 6]; updSched() },
  'f-ev-type': el => { F.sched.event.type = el.dataset.k; updSched() },
  'f-ev-remote': el => { F.sched.event.remote = el.dataset.k === 'remote'; updSched() },
  'f-ev-on': el => { F.sched.event.on = el.dataset.k; updSched() },
  'f-only': el => { const k = el.dataset.k; Object.assign(F.sched, k ? { mode: 'weekly', days: k === 'weekdays' ? [1, 2, 3, 4, 5] : [0, 6], asDaily: true } : { mode: 'daily', asDaily: false }); updSched() },
  'f-perm': el => { F.permission = el.dataset.k; updBeh() },
  // Garden
  'night-now': el => call('nightNow', el.dataset.k),
  'open-garden': el => call('openGarden', el.dataset.k),
  'skill-new': () => { skillEdit = '+'; openSkillEditor() },
  'skill-open': el => { const n = el.dataset.n; skillOpen.has(n) ? skillOpen.delete(n) : skillOpen.add(n); renderGarden() },
  'skill-edit': el => { skillEdit = el.dataset.n; openSkillEditor() },
  'skill-cancel': () => $('#editor').close(),
  'skill-save': async el => {
    const name = el.dataset.n === '+' ? $('#skill-name').value.trim() : el.dataset.n
    if (await call('saveSkill', name, $('#skill-text').value)) { $('#editor').close(); toast('Saved'); loadGarden() }
  },
  'skill-del': async el => { if (confirm(`Delete ${el.dataset.n}?`) && await call('deleteSkill', el.dataset.n)) loadGarden() },
  'mem-open': el => { const k = el.dataset.k; memOpen.has(k) ? memOpen.delete(k) : memOpen.add(k); renderGarden() },
  'mem-edit': el => { memEdit = el.dataset.k; renderGarden(); $('#mem-text').focus() },
  'mem-cancel': () => { memEdit = null; renderGarden() },
  'mem-save': async el => { if (await call('saveMemory', el.dataset.k, $('#mem-text').value)) { memEdit = null; toast('Saved'); loadGarden() } },
  pal: el => palRun(+el.dataset.i),
  more: el => { const r = el.getBoundingClientRect(); beeMenu({ clientX: r.right - 190, clientY: r.bottom + 4, preventDefault() {} }, el.dataset.id) },
  upgrade: () => doUpgrade(),
  'rm-more': el => { const c = el.closest('.rm-card'), open = c.classList.toggle('open'); el.textContent = open ? 'Show less' : 'Show all'; if (!open) c.scrollIntoView({ block: 'nearest' }) },
  'hive-view': el => { hiveView = el.dataset.k; try { localStorage.setItem('hive-view', hiveView) } catch {} $('#grid')._h = ''; renderHive() },
  'comb-pick': el => { combSel = el.dataset.id; renderHive() },
  'out-type': el => { OUT.type = el.dataset.k; renderOutputs() },
  'out-bee': el => { OUT.bee = OUT.bee === el.dataset.id ? '' : el.dataset.id; renderOutputs() },
  'out-refresh': () => loadOutputs(),
  'out-open': el => { const x = OUT.shown[+el.dataset.i]; if (x) x.kind === 'link' ? call('openLink', x.url) : call('openOutput', x.bee, x.abs, 'open') },
  'out-reveal': el => { const x = OUT.shown[+el.dataset.i]; if (x) call('openOutput', x.bee, x.abs, 'reveal') },
  'out-bee-open': el => { const x = OUT.shown[+el.dataset.i]; if (x) x.kind === 'link' ? call('openChat', x.bee, '', x.url) : call('openChat', x.bee, 'files', '', x.abs) },
  'out-copy': async el => { const x = OUT.shown[+el.dataset.i]; if (!x) return; try { await navigator.clipboard.writeText(x.kind === 'link' ? x.url : x.abs); toast('Copied') } catch { toast('Could not copy', 'err') } },
  'squad-rename': el => renameSquad(el),
  found: el => foundRun(+el.dataset.i),
  prefs: () => openPrefs(),
  'prefs-close': () => $('#prefs').close(),
  'prefs-check': () => checkNow(),
  'f-mcp-all': () => setMcpOff([]),
  'f-mcp-none': () => CS && setMcpOff(CS.servers.map(s => s.name)),
  'f-mcp-refresh': () => { CS = null; updBeh() },
  'setup-refresh': () => { CS = null; renderGarden(); loadSetup(true) },
  'room-toggle': () => toggleRoom(),
  'room-open': el => (R.open && R.cur === el.dataset.id ? closeRoom() : openRoom(el.dataset.id)),
  'queen-room': () => openQueenRoom(),
  'group-new': () => openGroup(),
  'group-edit': () => openGroup(R.cur),
  'group-close': () => { $('#group').close(); GF = null },
  'group-delete': async () => { const id = GF.id; $('#group').close(); GF = null; deleteRoom(id) },
  'room-stop': () => { if (confirm('Stop what this group is working on?')) call('roomStop', R.cur) },
  'room-new': () => { if (confirm('Make Queen forget this conversation and start over?')) call('roomNew', R.cur) },
  'room-ask': el => call('roomDecide', el.dataset.id, !!el.dataset.ok),
  'room-approve': el => call('decide', el.dataset.bee, el.dataset.id, !!el.dataset.ok, !!el.dataset.always),
  'room-at': el => pickAt(+el.dataset.i),
  'room-stickers': () => { $('#room-stickers').hidden = !$('#room-stickers').hidden },
  'room-sticker': el => { $('#room-stickers').hidden = true; call('roomSend', R.cur, `[sticker:${el.dataset.id}]`); $('#room-input').focus() },
}

document.addEventListener('click', e => {
  if (e.target.id === 'palette') return togglePal(false)
  const el = e.target.closest('[data-act]')
  if (!el || el.disabled) return
  const inner = e.target.closest('button, a, input, label')            // buttons inside a table row win
  if (inner && inner !== el && el.contains(inner) && !inner.dataset.act) return
  ACT[el.dataset.act] && ACT[el.dataset.act](el, e)
})
document.addEventListener('input', e => {
  const t = e.target
  if (t.id === 'pal-input') { palSel = 0; renderPal(); return searchMore(t.value, renderPal) }
  if (!F) return
  const k = t.id && INPUT[t.id] ? t.id : t.dataset.input
  if (k && INPUT[k]) INPUT[k](t.value)
})
document.addEventListener('change', async e => {
  const t = e.target
  if (F && t.dataset.change && CHANGE[t.dataset.change]) return CHANGE[t.dataset.change](t)
  if (t.dataset.night) { const r = await call('settings', { night: t.dataset.night, time: t.value }); if (r) { S.settings = r; if (G) G.night = r.night; toast('Saved') } }
  if (t.dataset.link) { if (!(await call('linkSkill', t.dataset.link, t.checked))) t.checked = !t.checked; else toast(t.checked ? 'Installed in Claude Code' : 'Removed') }
  if (t.id === 'mem-inject') { const r = await call('settings', { memoryInject: t.checked }); if (r) { S.settings = r; if (G) G.memoryInject = r.memoryInject } }
})
$('#hatch-form').addEventListener('submit', e => { e.preventDefault(); submitForm() })
$('#hatch').addEventListener('close', () => { F = null })
$('#hatch').addEventListener('click', e => { if (e.target === $('#hatch')) { $('#hatch').close() } })
$('#hatch-form').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') e.preventDefault() })

document.addEventListener('keydown', e => {
  const pal = !$('#palette').hidden
  if (e.metaKey && e.key.toLowerCase() === 'k') { e.preventDefault(); return togglePal() }
  if (e.metaKey && e.key.toLowerCase() === 'j') { e.preventDefault(); return toggleRoom() }
  if (pal) {
    if (e.key === 'Escape') togglePal(false)
    else if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); renderPal() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); renderPal() }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); palRun(palSel) }
    return
  }
  if (e.key === 'Escape') closeCtx()
  if ($('#hatch').open || $('#group').open) return
  if (e.metaKey && e.key.toLowerCase() === 'n') { e.preventDefault(); openHatch() }
  if (e.metaKey && /^[1-9]$/.test(e.key)) { const a = S.agents[+e.key - 1]; if (a) { e.preventDefault(); call('openChat', a.id) } }
})

// ───────── Groups: with or without Queen ─────────
// ───────── Upgrade ─────────
function renderUpdate() {
  const u = S.update, el = $('#upd')
  el.hidden = !u
  if (!u) return
  const busy = u.state !== 'available'
  // the first line of the release notes that says something: not a heading, not an empty line
  const what = String(u.notes || '').split('\n').map(l => l.replace(/^[\s#>*-]+/, '').replace(/[*_`]/g, '').trim()).find(l => l.length > 12 && !/^(install|already on)/i.test(l)) || ''
  setHtml(el, `<div class="upd-card"><div class="t"><i></i><b class="round">Version ${esc(u.version)} is out</b></div>
    <div class="s">You have ${esc(u.current)}${what ? ` · ${esc(what.slice(0, 90))}` : ''}</div>
    <button class="btn primary" data-act="upgrade"${busy ? ' disabled' : ''} title="${esc(u.inPlace ? 'Downloads it, checks the signature and restarts the app' : 'Opens the download page')}">${u.state === 'downloading' ? 'Downloading…' : u.state === 'installing' ? 'Restarting…' : u.inPlace ? 'Upgrade now' : 'Get the new version'}</button></div>`)
}
async function doUpgrade() {
  const u = S.update
  if (!u || u.state !== 'available') return
  const n = S.agents.filter(a => a.status === 'running').length
  if (u.inPlace && !confirm(`Upgrade Agent Hive from ${u.current} to ${u.version}?\n\nThe app restarts when the download is done.${n ? ` ${n} running bee${n === 1 ? '' : 's'} will pause and pick up where ${n === 1 ? 'it' : 'they'} left off.` : ''}`)) return
  await call('upgrade')
}
// Settings (the gear at the bottom of the sidebar): the version and how new ones arrive
let prefsNote = ''
function renderPrefs() {
  const u = S.update, st = S.settings, busy = u && u.state !== 'available'
  const status = u ? (u.state === 'downloading' ? `Downloading ${esc(u.version)}…` : u.state === 'installing' ? 'Restarting…' : `Version ${esc(u.version)} is out`) : prefsNote || 'You have the latest version'
  $('#prefs').innerHTML = `
  <div class="dlg-head">${queenSvg(40)}<div class="grow"><h2 class="round">Settings</h2></div><button type="button" class="btn icon ghost" data-act="prefs-close">${ICON.x}</button></div>
  <div class="dlg-body">
    <div class="pref-ver"><div class="grow"><b>Agent Hive ${esc(S.version || '')}</b><div class="sub${u ? ' new' : ''}">${status}</div></div>
      ${u ? `<button class="btn primary" data-act="upgrade"${busy ? ' disabled' : ''}>${S.canSwap ? 'Upgrade now' : 'Open download page'}</button>` : `<button class="btn" data-act="prefs-check">Check now</button>`}</div>
    <label class="check"><input type="checkbox" data-pref="autoUpdate" ${st.autoUpdate ? 'checked' : ''} ${S.canSwap ? '' : 'disabled'}><span><b>Install new versions automatically</b><span class="sub">${S.canSwap ? 'Downloads the release, checks that it is signed by the same developer and restarts, once no bee is working.' : 'Not available for this copy: it runs from source or from a place that cannot be replaced.'}</span></span></label>
    <label class="check"><input type="checkbox" data-pref="updateNotify" ${st.updateNotify !== false ? 'checked' : ''}><span><b>Tell me when a new version is out</b><span class="sub">A notification, once per version. The Upgrade button in the sidebar appears either way.</span></span></label>
  </div>
  <div class="dlg-foot"><span class="grow"></span><button type="button" class="btn primary" data-act="prefs-close">Done</button></div>`
}
function openPrefs() { prefsNote = ''; renderPrefs(); if (!$('#prefs').open) $('#prefs').showModal() }
async function checkNow() {
  prefsNote = 'Checking…'; renderPrefs()
  const r = await hive.call('checkUpdate')
  if (r && r.error) prefsNote = `Could not check: ${r.error}`; else { prefsNote = ''; S.update = r || null; renderUpdate() }
  renderPrefs()
}
$('#prefs').addEventListener('change', async e => {
  const k = e.target.dataset.pref
  if (!k) return
  const r = await call('settings', { [k]: e.target.checked })
  if (r) S.settings = r
  renderPrefs()
})
let R = { rooms: [], cur: null, open: false, entries: {}, unread: {} }
let GF = null                                             // new / edit group form
const RLABEL = { DONE: 'Done', BLOCKED: 'Blocked', NEED_INPUT: 'Needs your call', ERROR: 'Error', STOPPED: 'Stopped', INTERRUPTED: 'Interrupted' }
const hm = t => hmOf(new Date(t))
const curRoom = () => R.rooms.find(r => r.id === R.cur)
const roomBees = r => r.members.map(byId).filter(Boolean)
// Bees currently working on this group's tasks
const roomBusy = r => roomBees(r).filter(a => a.status === 'running' && a.ctx && a.ctx.room === r.id)
const roomIcon = (r, size = 28) => { const b = roomBees(r)[0]; return r.queen ? queenSvg(size, 'happy', r.status === 'running' ? 'running' : '') : b ? beeSvg(b.color, 'happy', size, false, roomBusy(r).length ? 'running' : '') : ICON.hive }

function renderRooms() {
  // "Chat with Queen" is pinned on top; other groups sort by latest message
  const list = [...R.rooms].sort((x, y) => (y.main ? 1 : 0) - (x.main ? 1 : 0) || (y.lastAt || 0) - (x.lastAt || 0))
  const pin = R.rooms.some(r => r.main) ? '' : `<button class="side-room" data-act="queen-room"><span class="ricon">${queenSvg(28)}</span><span class="grow"><span class="nm ell">Chat with Queen</span><span class="last ell">She leads the bees</span></span></button>`
  setHtml($('#side-rooms'), pin + (list.length ? list.map(r => {
    const n = R.unread[r.id] || 0, busy = r.status === 'running' || r.pending.length || roomBusy(r).length, wait = r.asks.length
    if (R.renaming === r.id) return `<div class="side-room on" data-room="${r.id}"><span class="ricon">${roomIcon(r)}</span><input type="text" class="rename grow" id="room-rename" maxlength="30" spellcheck="false" value="${esc(r.name)}"></div>`
    return `<button class="side-room${R.open && R.cur === r.id ? ' on' : ''}" data-act="room-open" data-id="${r.id}" data-room="${r.id}"><span class="ricon">${roomIcon(r)}</span>
      <span class="grow"><span class="nm ell">${esc(r.name)}</span><span class="last ell">${esc(r.last || `${r.queen ? 'Queen, ' : ''}${roomBees(r).map(a => a.name).join(', ') || 'no bees yet'}`)}</span></span>
      ${wait ? '<span class="unread">!</span>' : n ? `<span class="unread">${n}</span>` : busy ? '<span class="dot blink" style="background:var(--green)"></span>' : ''}</button>`
  }).join('') : '') + (R.rooms.filter(r => !r.main).length ? '' : `<button class="side-new" data-act="group-new">+ New group</button>`))
}

function buildRoom() {
  $('#room').innerHTML = `
  <div class="room-head"><span id="room-bee"></span><div class="grow"><b class="round ell" id="room-name" style="display:block" title="Double-click to rename"></b><div class="sub ell" id="room-sub"></div></div>
    <button class="btn sm icon ghost" data-act="group-edit" title="Group settings">${ICON.gear}</button>
    <button class="btn sm icon ghost" data-act="room-new" id="room-newbtn" title="New conversation">${ICON.refresh}</button>
    <button class="btn sm icon ghost danger" data-act="room-stop" id="room-stop" title="Stop">${ICON.stop}</button>
    <button class="btn sm icon ghost" data-act="room-toggle" title="Collapse ⌘J">${ICON.x}</button></div>
  <div class="room-bees" id="room-bees"></div>
  <div class="room-tl" id="room-tl"></div>
  <div id="room-cards"></div>
  <div class="room-compose"><div id="room-at" hidden></div><div id="room-stickers" hidden>${Object.keys(STICKER).map(n => `<button data-act="room-sticker" data-id="${n}" title="${STICKER[n][0]}">${stickerSvg(n, '', 52)}</button>`).join('')}</div><textarea id="room-input" rows="1" spellcheck="false"></textarea><button id="room-stick" data-act="room-stickers" title="Stickers">${ICON.smile}</button><button id="room-send" title="Send">${ICON.send}</button></div>`
  const input = $('#room-input')
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; $('#room-send').disabled = !input.value.trim() }
  input.addEventListener('input', () => { grow(); updAt() })
  input.addEventListener('keydown', e => {
    if (e.isComposing) return
    if (!$('#room-at').hidden) {
      if (e.key === 'ArrowDown') { e.preventDefault(); atSel = (atSel + 1) % atList.length; return renderAt() }
      if (e.key === 'ArrowUp') { e.preventDefault(); atSel = (atSel + atList.length - 1) % atList.length; return renderAt() }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); return pickAt(atSel) }
      if (e.key === 'Escape') { e.stopPropagation(); return void ($('#room-at').hidden = true) }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendRoom() }
  })
  $('#room-send').addEventListener('click', sendRoom)
  input.addEventListener('focus', () => { $('#room-stickers').hidden = true })
  grow()
}
async function sendRoom() {
  const input = $('#room-input'), text = input.value.trim()
  if (!text || !R.cur) return
  if (await call('roomSend', R.cur, text)) { input.value = ''; input.style.height = 'auto'; $('#room-send').disabled = true; $('#room-at').hidden = true }
}
// @ mention completion (only bees in the group)
let atList = [], atSel = 0
function updAt() {
  const input = $('#room-input'), r = curRoom(), mm = input.value.slice(0, input.selectionStart).match(/(^|\s)@([^\s@]*)$/)
  if (!mm || !r) return void ($('#room-at').hidden = true)
  const q = mm[2].toLowerCase(), bees = roomBees(r)
  atList = [...bees.filter(a => a.name.toLowerCase().startsWith(q)).map(a => ({ name: a.name, a })), ...squadList().filter(s => s.name.toLowerCase().replace(/\s+/g, '-').startsWith(q)).map(s => ({ name: s.name.replace(/\s+/g, '-'), sq: s })), ...('all'.startsWith(q) && bees.length > 1 ? [{ name: 'all' }] : [])]
  if (!atList.length) return void ($('#room-at').hidden = true)
  atSel = Math.min(atSel, atList.length - 1)
  renderAt()
}
function renderAt() {
  $('#room-at').innerHTML = atList.map((x, i) => `<button class="${i === atSel ? 'on' : ''}" data-act="room-at" data-i="${i}">${x.sq ? `${ICON.relay || ICON.hive}${esc(x.sq.name)}<span class="st">Squad · ${esc(x.sq.team.map(m => m.name).join(' → '))}</span>` : x.a ? `<span class="dot" style="background:${esc(x.a.color)}"></span>${esc(x.a.name)}<span class="st">${STATUS[x.a.status]} · ${esc(x.a.task)}</span>` : `${ICON.hive}all<span class="st">Every bee in the group</span>`}</button>`).join('')
  $('#room-at').hidden = false
}
function pickAt(i) {
  const input = $('#room-input'), x = atList[i]
  if (!x) return
  const pos = input.selectionStart, before = input.value.slice(0, pos).replace(/@([^\s@]*)$/, '@' + x.name + ' ')
  input.value = before + input.value.slice(pos)
  input.selectionStart = input.selectionEnd = before.length
  $('#room-at').hidden = true
  input.focus()
}

// A squad's chain with each bee's state. Live while it runs (from the room's state), frozen once it is over
const SQ_MARK = { waiting: ['', 'Waiting'], running: ['run', 'Working'], done: ['ok', 'Done'], changes: ['chg', 'Asked for changes'], failed: ['bad', 'Failed'] }
const liveSquad = flow => { const r = curRoom(), q = r && (r.squads || []).find(x => x.flow === flow); return q ? q.steps : null }
const squadChain = (steps, plain) => steps.map(s => { const k = SQ_MARK[s.state] || SQ_MARK.waiting; return `<button class="sq-step ${plain ? '' : k[0]}" data-act="chat" data-id="${esc(s.id)}" title="${esc(s.name)} (${esc(s.role || '')})${plain ? '' : ': ' + k[1]}${s.rounds > 1 ? `, ${s.rounds} rounds` : ''}"><span class="dot${s.state === 'running' && !plain ? ' blink' : ''}" style="background:${esc(s.color || '#ccc')}"></span>${esc(s.name)}${plain ? '' : s.state === 'done' ? '<i>✓</i>' : s.state === 'changes' ? '<i>↺</i>' : s.state === 'failed' ? '<i>✕</i>' : ''}</button>` }).join('<span class="sq-arrow">→</span>')
function roomEntryHtml(e) {
  const txt = esc(e.text || '')
  if (e.kind === 'system') return `<div class="rm-sys">${txt}</div>`
  if (e.kind === 'error') return `<div class="rm-sys err">${txt}</div>`
  if (e.kind === 'squad') return `<div class="rm"><span class="av"></span><div class="rm-card squad col"><div class="hd">${e.by === 'queen' ? 'Queen' : 'You'} <span class="arrow">→</span>${ICON.hive}${esc(e.squad)}<span class="tagx">Squad</span><time style="margin-left:auto">${hm(e.t)}</time></div>${e.by === 'queen' ? `<div class="tx">${txt}</div>` : ''}<div class="sq-chain" data-flow="${esc(e.flow)}">${squadChain(liveSquad(e.flow) || e.steps || [], !liveSquad(e.flow))}</div></div></div>`
  if (e.kind === 'squad-done') return `<div class="rm"><span class="av">${beeFace(byId(e.who) || { color: e.color || '#ccc' }, 28, e.status === 'DONE' ? 'grin' : 'sad')}</span><div class="rm-card result col${(e.text || '').length > 700 ? ' long' : ''}"><div class="hd">${esc(e.name)}<span class="tagx s-${esc(e.status)}">${RLABEL[e.status] || esc(e.status)}</span>${e.files ? `<span class="tagx">${e.files} file${e.files === 1 ? '' : 's'} changed</span>` : ''}<time style="margin-left:auto">${hm(e.t)}</time></div><div class="sq-chain">${squadChain(e.steps || [])}</div><div class="tx">${txt}</div>${(e.notes || []).length ? `<div class="sq-note">${esc(e.notes.join(' · '))}</div>` : ''}</div></div>`
  if (e.who === 'user' && e.sticker && !e.text) return `<div class="rm me"><div class="sticker" title="${esc(STICKER[e.sticker] ? STICKER[e.sticker][0] : '')}">${stickerSvg(e.sticker)}</div><time>${hm(e.t)}</time></div>`
  if (e.who === 'user') return `<div class="rm me">${e.to && e.to.length ? `<span class="to">→ ${esc(e.to.join(', '))}</span>` : ''}<div class="bubble">${txt}</div><time>${hm(e.t)}</time></div>`
  if (e.kind === 'dispatch') return `<div class="rm"><span class="av"></span><button class="rm-card dispatch col" data-act="chat" data-id="${esc(e.to)}" title="Open ${esc(e.toName)}'s chat"><div class="hd">Queen <span class="arrow">→</span><span class="dot" style="background:${esc(e.toColor)}"></span>${esc(e.toName)}${e.ask ? '<span class="tagx">Ask</span>' : ''}<span class="grow"></span><time>${hm(e.t)}</time></div><div class="tx">${txt}</div></button></div>`
  if (e.kind === 'result') {
    const tag = e.direct && e.status === 'DONE' ? '' : `<span class="tagx s-${esc(e.status)}">${RLABEL[e.status] || esc(e.status)}</span>`
    const body = e.direct ? `<div class="md">${renderMd(e.text || '')}</div>` : `<div class="tx">${txt}</div>`
    const stick = e.sticker ? `<div class="sticker" title="${esc(STICKER[e.sticker] ? STICKER[e.sticker][0] : '')}">${stickerSvg(e.sticker, e.color)}</div>` : ''
    if (stick && !e.text) return `<div class="rm"><span class="av">${beeFace(byId(e.who) || { color: e.color || '#ccc' })}</span><div class="col"><div class="nm"><button class="btn sm ghost" data-act="chat" data-id="${esc(e.who)}" style="height:20px;padding:0 4px;margin-left:-4px;font-weight:700">${esc(e.name)}</button><time>${hm(e.t)}</time></div>${stick}</div></div>`
    return `<div class="rm"><span class="av">${beeFace(byId(e.who) || { color: e.color || '#ccc' }, 28, e.status === 'ERROR' ? 'sad' : 'happy')}</span><div class="rm-card result col${e.direct ? ' direct' : ''}${(e.text || '').length > 700 ? ' long' : ''}"><div class="hd"><button class="btn sm ghost" data-act="chat" data-id="${esc(e.who)}" title="Open ${esc(e.name)}'s full chat" style="height:20px;padding:0 4px;margin-left:-4px;font-weight:700">${esc(e.name)}</button>${tag}${e.files ? `<span class="tagx">${e.files} file${e.files === 1 ? '' : 's'}</span>` : ''}<span class="grow"></span><time>${hm(e.t)}</time></div>${body}${(e.text || '').length > (e.direct ? 700 : 350) ? '<button class="rm-more" data-act="rm-more">Show all</button>' : ''}${stick}</div></div>`
  }
  return `<div class="rm"><span class="av">${queenSvg(28)}</span><div class="col"><div class="nm">Queen<time>${hm(e.t)}</time></div><div class="md">${renderMd(e.text || '')}</div></div></div>`
}
function renderRoom(scroll) {
  const tl = $('#room-tl'), r = curRoom()
  if (!tl || !r) return
  const list = R.entries[r.id] || [], stick = scroll || tl.scrollHeight - tl.scrollTop - tl.clientHeight < 140
  const empty = r.queen
    ? `${queenSvg(60)}Tell Queen what to do; she picks the bees. <code>@name</code> to mention, <code>@all</code> for everyone.`
    : `${roomIcon(r, 60)}Just talk: the message goes to the bee it concerns. <code>@name</code> sends straight to that one, <code>@all</code> to everyone.`
  tl.innerHTML = (list.length ? list.map(roomEntryHtml).join('') : `<div class="room-empty">${empty}</div>`) + '<div id="room-think" class="rm-think" hidden></div>'
  if (stick) tl.scrollTop = tl.scrollHeight
  renderRoomMeta()
}
function addRoomEntry({ room, entry }) {
  const list = R.entries[room]
  if (list) { list.push(entry); if (list.length > 500) list.shift() }
  if (!R.open || R.cur !== room) { if (entry.who !== 'user' && entry.kind !== 'system') R.unread[room] = (R.unread[room] || 0) + 1; return renderRooms() }
  const tl = $('#room-tl'), think = $('#room-think')
  if (!list || list.length === 1 || !think) return renderRoom(true)
  const stick = tl.scrollHeight - tl.scrollTop - tl.clientHeight < 140 || entry.who === 'user'
  think.insertAdjacentHTML('beforebegin', roomEntryHtml(entry))
  if (stick) tl.scrollTop = tl.scrollHeight
}
// How full a session is, once that is worth knowing: " · 42% full"
const ctxPct = c => (c && c.used && c.window ? Math.round(c.used / c.window * 100) : 0)
const ctxNote = (c, lead = '') => (ctxPct(c) >= 20 ? `${lead}${ctxPct(c)}% full` : '')
// Header, member strip, and cards waiting for your OK
function renderRoomMeta() {
  renderRooms()
  const r = curRoom()
  if (!r || !$('#room-tl') || !R.open) return
  const running = r.status === 'running', pend = r.pending || [], bees = roomBees(r), busy = roomBusy(r)
  setHtml($('#room-bee'), roomIcon(r, 34))
  $('#room-name').textContent = r.name
  $('#room-sub').textContent = r.queen && !r.installed ? 'Needs claude installed' : running ? 'Queen is thinking…' : pend.length ? `Waiting for ${pend.map(p => p.name).join(', ')}` : (r.squads || []).length ? `${r.squads.map(q => q.name).join(', ')} running` : busy.length ? `${busy.map(a => a.name).join(', ')} working` : `${bees.length} bee${bees.length === 1 ? '' : 's'}${r.queen ? ' · Queen leads' : ''}${ctxNote(r.context, ' · ')}`
  $('#room-stop').hidden = !running && !pend.length && !busy.length && !r.routing && !(r.squads || []).length
  $('#room-newbtn').hidden = !r.queen
  $('#room-input').placeholder = r.queen ? 'Message Queen, @ to mention' : 'Message the group, @ to mention'
  const think = $('#room-think')
  if (think) {
    const text = running ? 'Queen is thinking…' : r.routing ? 'Picking who this is for…' : busy.length ? `${busy.map(a => a.name).join(', ')} working…` : ''
    const was = think.hidden
    think.hidden = !text; think.textContent = text
    if (was && text) { const tl = $('#room-tl'); tl.scrollTop = tl.scrollHeight }
  }
  const task = id => (pend.find(p => p.id === id) || {}).task
  for (const el of document.querySelectorAll('#room-tl .sq-chain[data-flow]')) { const live = liveSquad(el.dataset.flow); if (live) setHtml(el, squadChain(live)); else if (el._h) { const e0 = (R.entries[r.id] || []).find(x => x.kind === 'squad' && x.flow === el.dataset.flow); el._h = ''; el.innerHTML = squadChain((e0 && e0.steps) || [], true) } }
  setHtml($('#room-bees'), (r.queen ? `<span class="who">${queenSvg(24, 'happy', running ? 'running' : '')}Queen</span>` : '')
    + bees.map(a => `<button data-act="chat" data-id="${a.id}" title="${esc(task(a.id) || `Open ${a.name}'s chat${ctxNote(a.context, ' · session ')}`)}">${beeOf(a, 24)}${esc(a.name)}${ctxPct(a.context) >= 40 ? `<span class="ctx${ctxPct(a.context) >= 70 ? ' hot' : ''}">${ctxPct(a.context)}%</span>` : ''}${task(a.id) ? `<span class="task ell">${esc(String(task(a.id)).split('\n')[0])}</span>` : ''}</button>`).join('')
    + `<button class="add" data-act="group-edit">+ Add</button>`)
  const asks = (r.asks || []).map(k => k.kind === 'plan'
    ? `<div class="ask-card"><div class="ttl">Queen's plan</div>${k.data.note ? `<div class="kv">${esc(k.data.note)}</div>` : ''}<ol>${k.data.steps.map(s => `<li><b>${esc(s.bee)}</b>: ${esc(s.task)}</li>`).join('')}</ol>
      <div class="acts"><button class="btn primary" data-act="room-ask" data-id="${k.id}" data-ok="1">Approve</button><button class="btn" data-act="room-ask" data-id="${k.id}">Decline</button></div></div>`
    : `<div class="ask-card"><div class="ttl">Queen wants to hatch</div><div class="kv"><b>${esc(k.data.name)}</b> · ${esc(eng(k.data.engine).label)} · ${esc(tilde(k.data.workspace, S.home))}${k.data.isolate ? ' · Own branch' : ''} · Allow all${k.data.why ? `<br>${esc(k.data.why)}` : ''}</div>
      <div class="acts"><button class="btn primary" data-act="room-ask" data-id="${k.id}" data-ok="1">Approve</button><button class="btn" data-act="room-ask" data-id="${k.id}">Decline</button></div></div>`)
  const appr = bees.flatMap(a => (a.approvals || []).map(x => `<div class="ask-card"><div class="ttl">${esc(a.name)} wants to use ${esc(x.tool)}${x.desc ? ` <span>· ${esc(x.desc)}</span>` : ''}</div><pre>${esc(x.input)}</pre>
      <div class="acts"><button class="btn primary" data-act="room-approve" data-bee="${a.id}" data-id="${x.id}" data-ok="1">Allow</button><button class="btn" data-act="room-approve" data-bee="${a.id}" data-id="${x.id}" data-ok="1" data-always="1">Always allow ${esc(x.tool)}</button><button class="btn danger" data-act="room-approve" data-bee="${a.id}" data-id="${x.id}">Deny</button></div></div>`))
  setHtml($('#room-cards'), [...asks, ...appr].join(''))
}
async function openRoom(id) {
  if (!R.rooms.some(r => r.id === id)) return
  R.cur = id; R.open = true; R.unread[id] = 0
  $('#room').hidden = false
  try { localStorage.setItem('room-open', id) } catch {}
  if (!R.entries[id]) { const got = await hive.call('room', id); R.entries[id] = got && !got.error ? got.entries || [] : [] }
  if (R.cur !== id) return
  renderRoom(true); renderHive()
  $('#room-input').focus()
}
function closeRoom() {
  R.open = false
  $('#room').hidden = true
  try { localStorage.setItem('room-open', '') } catch {}
  renderRooms(); renderHive()
}
// ⌘J: toggle the current (or most recent) group; with no groups, create one
function toggleRoom(open = !R.open) {
  if (!open) return closeRoom()
  const r = curRoom() || [...R.rooms].sort((x, y) => (y.lastAt || 0) - (x.lastAt || 0))[0]
  if (r) openRoom(r.id); else openGroup()
}
// "Chat with Queen": open the main Queen group, or create one with every bee
async function openQueenRoom() {
  let r = R.rooms.find(x => x.main)
  if (!r) {
    const made = await call('roomCreate', { name: 'Chat with Queen', members: S.agents.map(a => a.id), queen: true, main: true })
    if (!made) return
    R.rooms = await hive.call('rooms'); r = R.rooms.find(x => x.id === made.id)
  }
  if (r) openRoom(r.id)
}

// New group / group settings
function openGroup(id) {
  const r = id ? R.rooms.find(x => x.id === id) : null
  GF = r ? { id: r.id, name: r.name, members: new Set(r.members), queen: r.queen, model: r.model || '' } : { name: '', members: new Set(), queen: true }
  $('#group-form').innerHTML = `
  <div class="dlg-head">${queenSvg(40)}<div class="grow"><h2 class="round">${r ? 'Group settings' : 'New group'}</h2></div><button type="button" class="btn icon ghost" data-act="group-close">${ICON.x}</button></div>
  <div class="dlg-body">
    <div class="field"><div class="lab">Name</div><input type="text" id="g-name" maxlength="30" style="width:100%" placeholder="Group name" value="${esc(GF.name)}"></div>
    <label class="g-queen"><input type="checkbox" id="g-queen" ${GF.queen ? 'checked' : ''}>${queenSvg(34)}<span><b>Queen leads</b><span class="sub" style="display:block">She picks bees, dispatches work and sums up. Unchecked: messages go to every member.</span></span></label>
    <div class="field" id="g-model-row" ${GF.queen ? '' : 'hidden'}><div class="lab">Queen's model</div><select id="g-model"><option value="">Default</option>${(eng('claude').models || []).map(m => `<option value="${esc(m)}" ${GF.model === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
    <div class="field"><div class="lab">Members <span class="opt" id="g-count"></span></div><div class="g-list">${S.agents.length ? S.agents.map(a => `<label class="g-row"><input type="checkbox" data-g="${a.id}" ${GF.members.has(a.id) ? 'checked' : ''}>${beeOf(a, 28)}<span class="grow"><b>${esc(a.name)}</b><span class="sub ell" style="display:block">${esc(a.task)} · ${esc(eng(a.engine).label)}</span></span>${pill(a.status)}</label>`).join('') : '<div class="hint">No bees yet</div>'}</div></div>
  </div>
  <div class="dlg-foot">${r ? `<button type="button" class="btn danger" data-act="group-delete">Delete group</button>` : ''}<span class="grow"></span><button type="button" class="btn" data-act="group-close">Cancel</button><button type="submit" class="btn primary">${r ? 'Save' : 'New group'}</button></div>`
  const count = () => { $('#g-count').textContent = `${GF.members.size} selected` }
  $('#group-form').onchange = e => { const t = e.target; if (t.dataset.g) { t.checked ? GF.members.add(t.dataset.g) : GF.members.delete(t.dataset.g); count() } if (t.id === 'g-queen') $('#g-model-row').hidden = !t.checked
    if (t.id === 'g-queen') GF.queen = t.checked }
  count()
  $('#group').showModal()
  $('#g-name').focus()
}
async function submitGroup() {
  const cfg = { queenModel: $('#g-model') ? $('#g-model').value : '', name: $('#g-name').value.trim() || (GF.queen ? 'Queen and the bees' : [...GF.members].map(id => (byId(id) || {}).name).filter(Boolean).slice(0, 3).join(', ')), members: [...GF.members], queen: GF.queen }
  const made = GF.id ? await call('roomUpdate', GF.id, cfg) : await call('roomCreate', cfg)
  if (!made) return
  const id = GF.id || made.id
  $('#group').close(); GF = null
  R.rooms = await hive.call('rooms')
  openRoom(id)
}
$('#group-form').addEventListener('submit', e => { e.preventDefault(); submitGroup() })
$('#group').addEventListener('click', e => { if (e.target === $('#group')) $('#group').close() })

// Inline rename of a group in the sidebar (right-click → Rename, or double-click the panel title)
function renameRoom(id) {
  R.renaming = id
  renderRooms()
  const input = $('#room-rename')
  if (!input) return
  input.focus(); input.select()
  let done = false
  const finish = async save => {
    if (done) return
    done = true
    const name = input.value.trim(), r = R.rooms.find(x => x.id === id)
    R.renaming = null
    if (save && r && name && name !== r.name && await call('roomUpdate', id, { name })) r.name = name
    renderRoomMeta()
  }
  input.addEventListener('keydown', e => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); finish(true) } if (e.key === 'Escape') { e.stopPropagation(); finish(false) } })
  input.addEventListener('blur', () => finish(true))
}
async function deleteRoom(id) {
  const r = R.rooms.find(x => x.id === id)
  if (r && confirm(`Delete "${r.name}"? Its chat history will be removed.`)) await call('roomDelete', id)
}

// ───────── Context menus ─────────
function showCtx(e, items) {
  e.preventDefault()
  closeCtx()
  const m = document.createElement('div')
  m.id = 'ctx'
  m.innerHTML = items.filter(Boolean).map((x, i) => (x === '-' ? '<hr>' : `<button data-i="${i}" class="${x.danger ? 'danger' : ''}">${x.icon || '<span class="ic"></span>'}${esc(x.label)}</button>`)).join('')
  document.body.appendChild(m)
  const w = m.offsetWidth, h = m.offsetHeight
  m.style.left = Math.max(6, Math.min(e.clientX, innerWidth - w - 6)) + 'px'
  m.style.top = Math.max(6, Math.min(e.clientY, innerHeight - h - 6)) + 'px'
  const list = items.filter(Boolean)
  m.addEventListener('click', ev => { const b = ev.target.closest('[data-i]'); if (!b) return; ev.stopPropagation(); closeCtx(); list[+b.dataset.i].run() })
}
const closeCtx = () => { const m = $('#ctx'); if (m) m.remove() }
function roomMenu(e, id) {
  const r = R.rooms.find(x => x.id === id)
  if (!r) return
  const busy = r.status === 'running' || r.pending.length || roomBusy(r).length
  showCtx(e, [
    { label: 'Open', icon: ICON.chat, run: () => openRoom(id) },
    { label: 'Rename', icon: ICON.edit, run: () => renameRoom(id) },
    { label: 'Members & settings…', icon: ICON.gear, run: () => openGroup(id) },
    busy && { label: 'Stop', icon: ICON.stop, run: () => call('roomStop', id) },
    '-',
    { label: 'Delete group', icon: ICON.trash, danger: true, run: () => deleteRoom(id) },
  ])
}
function beeMenu(e, id) {
  const a = byId(id)
  if (!a) return
  const el = { dataset: { id } }, setup = a.status === 'setup'
  showCtx(e, [
    { label: 'Open chat', icon: ICON.chat, run: () => call('openChat', id) },
    { label: 'View changes', icon: ICON.branch, run: () => call('openChat', id, 'changes') },
    '-',
    !setup && a.status !== 'running' && a.status !== 'paused' && a.prompt && { label: 'Run', icon: ICON.play, run: () => ACT.run(el) },
    a.status === 'running' && { label: 'Pause', icon: ICON.pause, run: () => ACT.pause(el) },
    (a.status === 'paused' || (['stopped', 'error', 'sleeping'].includes(a.status) && a.lastRunAt)) && { label: 'Resume', icon: ICON.resume, run: () => ACT.continue(el) },
    ['running', 'paused', 'setup'].includes(a.status) && { label: 'Stop', icon: ICON.stop, run: () => ACT.stop(el) },
    !a.isolate && Team.teamOf(S.agents, id).length < S.teamMax && { label: 'Add relay bee…', icon: ICON.plus, run: () => ACT.relay(el) },
    { label: 'Show in Finder', icon: ICON.finder, run: () => call('reveal', id) },
    { label: 'Rename & settings…', icon: ICON.gear, run: () => ACT.edit(el) },
    '-',
    { label: 'Delete bee', icon: ICON.trash, danger: true, run: () => ACT.delete(el) },
  ])
}
document.addEventListener('contextmenu', e => {
  const room = e.target.closest('[data-room]'), bee = e.target.closest('[data-bee]')
  if (e.target.closest('input, textarea, .sel, .md')) return closeCtx()          // keep the native menu for text
  if (room) return roomMenu(e, room.dataset.room)
  if (bee) return beeMenu(e, bee.dataset.bee)
  closeCtx()
})
document.addEventListener('click', e => { if (!e.target.closest('[data-act="more"]')) closeCtx() })
window.addEventListener('blur', closeCtx)
document.addEventListener('scroll', closeCtx, true)
document.addEventListener('dblclick', e => { if (e.target.id === 'room-name' && R.cur) renameRoom(R.cur); const hx = e.target.closest && e.target.closest('.hx[data-id]'); if (hx) call('openChat', hx.dataset.id) })

async function bootRoom() {
  buildRoom()
  R.rooms = S.rooms || []
  hive.on('update', u => { S.update = u; renderUpdate(); if ($('#prefs').open) renderPrefs() })
  hive.on('show-settings', () => openPrefs())
  renderUpdate()
  hive.on('room-entry', addRoomEntry)
  hive.on('rooms', list => {
    R.rooms = list
    if (R.cur && !curRoom()) { R.cur = null; if (R.open) closeRoom() }
    renderRoomMeta()
  })
  let last = ''
  try { last = localStorage.getItem('room-open') || '' } catch {}
  if (last && R.rooms.some(r => r.id === last)) openRoom(last); else renderRooms()
}

// ───────── Startup and broadcasts ─────────
async function loadQueenLine() {
  const md = await hive.call('report', dayKey())
  queenLine = typeof md === 'string' ? (md.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#')) || '').replace(/[*_`]/g, '') : ''
  renderHive()
}
async function boot() {
  S = await hive.call('init')
  queenBusy = !!S.queenBusy
  buildHive(); buildDash()
  show('hive')
  loadQueenLine()
  hive.on('agents', a => {
    S.agents = a
    renderSide(); renderHive(); renderRoomMeta()
    if (view === 'dash') { renderDash(); loadDashSoon() }
    if (view === 'memory' && !memEdit) renderGarden()
    if (view === 'files') loadOutputsSoon()
    if (F && F.mode === 'create' && !F.after.ids.length && $('#hatch').open) updRelay()
  })
  hive.on('feed', f => { S.feed = f; renderFeed() })
  hive.on('spend', s => { S.spend = s; renderSide(); renderDash() })
  hive.on('report', r => { if (r.date === dayKey()) loadQueenLine(); if (r.date === dashDate) loadDash(); toast('Report ready') })
  hive.on('queen-busy', b => { queenBusy = b; renderHive(); renderDash() })
  hive.on('queen-error', m => toast('Queen: ' + m, 'err'))
  hive.on('night-busy', b => { if (G) { G.busy = b; if (!skillEdit && !memEdit) renderGarden() } })
  hive.on('garden-changed', () => { if ((view === 'skills' && !skillEdit) || (view === 'memory' && !memEdit)) loadGarden() })
  hive.on('show', v => (String(v).startsWith('room:') ? openRoom(v.slice(5)) : show(v)))
  bootRoom()
  window.addEventListener('resize', debounce(renderHive, 80))
  setInterval(() => { renderFeed(); renderHive() }, 60000)          // "3 min ago", "next …"
}
boot()
