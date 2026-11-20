// Shared by both pages: escaping, statuses, bee SVG, icons, Markdown, schedule copy, toast.
// The pure functions (schedText / nextRun / whenText) are also required by test.js under node.
'use strict'

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const pad2 = n => String(n).padStart(2, '0')

// Models: the name the CLI gives one, and the maker it is grouped under in a long list
const MODEL_FAMILY = [['Claude', /claude|opus|sonnet|haiku/], ['GPT', /gpt|codex|^o\d/], ['Gemini', /gemini/], ['Grok', /grok/], ['Cursor', /^auto$|composer/], ['DeepSeek', /deepseek/], ['Kimi', /kimi|moonshot/]]
const familyOf = m => (MODEL_FAMILY.find(([, re]) => re.test(String(m).toLowerCase())) || ['Other'])[0]
const modelName = (e, m) => (e.names && e.names[m]) || m

const STATUS = {
  running: 'Running', paused: 'Paused', stopped: 'Stopped', idle: 'Idle', error: 'Error', sleeping: 'Sleeping', setup: 'Setting up',
}
const pill = (status, dotOnly) => `<span class="pill st-${status}${dotOnly ? ' dot-only' : ''}" title="${STATUS[status] || ''}"><i></i>${dotOnly ? '' : STATUS[status] || status}</span>`
const moodOf = status => (status === 'sleeping' || status === 'paused' ? 'sleep' : status === 'error' ? 'sad' : 'happy')

// Ranks: a bee climbs one rung at a time by finishing rounds, and its drawing changes with the rank
const RANKS = [
  { id: 'bronze', name: 'Bronze', at: 0, c: '#B9783F' },
  { id: 'silver', name: 'Silver', at: 5, c: '#8E9BAA' },
  { id: 'gold', name: 'Gold', at: 20, c: '#D99A1F' },
  { id: 'platinum', name: 'Platinum', at: 50, c: '#3FA79C' },
  { id: 'diamond', name: 'Diamond', at: 120, c: '#3F8FE6' },
  { id: 'master', name: 'Master', at: 300, c: '#9A5BDD' },
]
function rankOf(xp) {
  xp = Math.max(0, Math.floor(+xp || 0))
  let i = 0
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].at) i++
  const r = RANKS[i], nx = RANKS[i + 1]
  return { i, id: r.id, name: r.name, c: r.c, xp, next: nx ? nx.name : '', need: nx ? nx.at - xp : 0, pct: nx ? (xp - r.at) / (nx.at - r.at) : 1 }
}
const spark = (x, y, k, fill) => `<path transform="translate(${x} ${y}) scale(${k})" d="M0-4l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" fill="${fill}"/>`
// What each rank wears: wing and antenna colours, and something drawn on top
const RANK_LOOK = [
  {},
  { tip: '#8E9BAA', wing: ['#fff', '#B4C0CC'], on: '<path d="M20 31.4l-3.6-2.1v4.2zM20 31.4l3.6-2.1v4.2z" fill="#AEB9C6" stroke="#6F7C8B" stroke-width=".7" stroke-linejoin="round"/><circle cx="20" cy="31.4" r="1.1" fill="#6F7C8B"/>' },
  { tip: '#E2A93A', wing: ['#FFF6DC', '#E2B95A'], on: '<path d="M20 28.3l1 2.2 2.4.3-1.8 1.6.5 2.4-2.1-1.2-2.1 1.2.5-2.4-1.8-1.6 2.4-.3z" fill="#F4C445" stroke="#B9741A" stroke-width=".7" stroke-linejoin="round"/>' },
  { tip: '#3FA79C', wing: ['#DDF5F1', '#5FB8B0'], on: '<path d="M9 16.4q11-5 22 0" stroke="#3FA79C" stroke-width="2.4" stroke-linecap="round"/><circle cx="20" cy="13.9" r="1.9" fill="#BFF3EC" stroke="#2A857B" stroke-width=".7"/>' },
  { tip: '#3F8FE6', wing: ['#D9E9FF', '#5AA2EE'], on: '<path d="M20 10.6l3 3.4-3 4-3-4z" fill="#8CCBFF" stroke="#2F7FD6" stroke-width=".8" stroke-linejoin="round"/><path d="M17 14h6" stroke="#fff" stroke-opacity=".8" stroke-width=".7"/>' + spark(34, 26, .55, '#5AA2EE') + spark(5, 27, .4, '#5AA2EE') },
  { tip: '#9A5BDD', wing: ['#EBDDFB', '#A56BE0'], on: '<ellipse cx="20" cy="7.6" rx="7.4" ry="2.1" stroke="#F0A93B" stroke-width="1.5"/><path d="M20 11l2.6 3-2.6 3.6-2.6-3.6z" fill="#C79BF2" stroke="#7B3FC4" stroke-width=".8" stroke-linejoin="round"/>' + spark(35, 25, .6, '#F0A93B') + spark(4.5, 26, .45, '#A56BE0') + spark(33, 4, .4, '#A56BE0') },
]

// Bee: two antennae, rounded-rect body, a faint belly stripe, two eyes, two blush spots, a smile
// anim = status name, picks the animation: running flaps + sways, idle floats gently, paused breathes slowly, sleeping shows z's, error shivers, setup wobbles, stopped is still and grey
function beeSvg(color, mood = 'happy', size = 44, crown = false, anim = '', extra = '', rank = 0) {
  const look = RANK_LOOK[rank] || {}, wf = look.wing ? look.wing[0] : '#fff', ws = look.wing ? look.wing[1] : '#CFE3F2', tip = look.tip || '#3A2E22'
  const eyes = mood === 'sleep'
    ? '<path d="M12.6 21.5h4.4M23 21.5h4.4" stroke="#3A2E22" stroke-width="1.7" stroke-linecap="round"/>'
    : mood === 'grin' ? '<path d="M12.6 21.6q2.2-2.6 4.4 0M23 21.6q2.2-2.6 4.4 0" stroke="#3A2E22" stroke-width="1.7" stroke-linecap="round"/>'
    : mood === 'love' ? HEART_EYES
    : '<circle cx="14.8" cy="21" r="2" fill="#3A2E22"/><circle cx="25.2" cy="21" r="2" fill="#3A2E22"/><circle cx="15.5" cy="20.3" r=".6" fill="#fff"/><circle cx="25.9" cy="20.3" r=".6" fill="#fff"/>'
  const mouth = mood === 'sad' ? 'M17 28.2q3-2.8 6 0' : mood === 'wow' ? 'M20 25.2a1.7 2 0 1 0 .01 0' : mood === 'flat' ? 'M17.2 27h5.6' : mood === 'grin' ? 'M16 25.4q4 4.6 8 0' : 'M17 26q3 3 6 0'
  return `<svg class="bee${anim ? ' a-' + anim : ''}" width="${size}" height="${size}" viewBox="0 0 40 40" fill="none" aria-hidden="true">
<g class="bee-all">
<ellipse class="wing wing-l" cx="6.2" cy="16" rx="6.4" ry="4.1" transform="rotate(-28 6.2 16)" fill="${wf}" fill-opacity=".82" stroke="${ws}" stroke-width=".9"/>
<ellipse class="wing wing-r" cx="33.8" cy="16" rx="6.4" ry="4.1" transform="rotate(28 33.8 16)" fill="${wf}" fill-opacity=".82" stroke="${ws}" stroke-width=".9"/>
<g class="antennae"><path d="M15 12.5C14 8.5 12 6.5 9.5 6M25 12.5C26 8.5 28 6.5 30.5 6" stroke="#3A2E22" stroke-width="1.5" stroke-linecap="round"/>
<circle cx="9" cy="5.8" r="1.7" fill="${tip}"/><circle cx="31" cy="5.8" r="1.7" fill="${tip}"/></g>
<rect class="bee-body" x="6.5" y="10.5" width="27" height="25" rx="11.5" fill="${esc(color)}"/>
<path d="M9.5 31.2q10.5 3.6 21 0" stroke="#fff" stroke-opacity=".55" stroke-width="2.2" stroke-linecap="round"/>
${eyes}
<circle cx="11.6" cy="25.6" r="2.3" fill="#F28B82" fill-opacity=".5"/><circle cx="28.4" cy="25.6" r="2.3" fill="#F28B82" fill-opacity=".5"/>
<path d="${mouth}" stroke="#3A2E22" stroke-width="1.5" stroke-linecap="round"/>
${crown ? '<path d="M13.5 12.5l-1.2-6.2 4.3 3 3.4-4.6 3.4 4.6 4.3-3-1.2 6.2z" fill="#F0A93B" stroke="#B9741A" stroke-width=".9" stroke-linejoin="round"/>' : ''}
${look.on || ''}${extra}
</g>
<g class="zzz" fill="#7C83C9" font-family="Nunito, sans-serif" font-weight="800"><text class="z1" x="30" y="9" font-size="7">z</text><text class="z2" x="34.5" y="4.5" font-size="5">z</text></g>
</svg>`
}
const heart = (x, y, k) => `<path transform="translate(${x} ${y}) scale(${k})" d="M0 3C-5-1-2.6-4.6 0-2 2.6-4.6 5-1 0 3z" fill="#E5484D"/>`
const HEART_EYES = heart(14.8, 21.4, .62) + heart(25.2, 21.4, .62)
const badge = (fill, d) => `<circle cx="32" cy="31" r="6.6" fill="${fill}" stroke="#fff" stroke-width="1.4"/>${d}`
const bold = (x, y, size, fill, t) => `<text x="${x}" y="${y}" font-size="${size}" font-family="Nunito, sans-serif" font-weight="800" fill="${fill}" text-anchor="middle">${t}</text>`
// Group-chat stickers: name → [label, mood, what is drawn on top of the bee]. The names are also in queen.js (STICKERS)
const STICKER = {
  ok: ['OK', 'happy', badge('#3FA66B', '<path d="M28.9 31.2l2.2 2.2 4-4.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>')],
  thanks: ['Thanks', 'love', heart(33, 8, 1) + heart(6, 5, .6)],
  nice: ['Nice', 'grin', '<path d="M33 2l1.3 3.4 3.4 1.3-3.4 1.3L33 11.4l-1.3-3.4-3.4-1.3 3.4-1.3zM5.5 1.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="#F0A93B"/>'],
  hmm: ['Hmm', 'flat', bold(33.5, 11, 13, '#7C83C9', '?')],
  oops: ['Oops', 'sad', '<path d="M31.5 12.5c1.9 2.6 2.8 4 2.8 5.2a2.8 2.8 0 0 1-5.6 0c0-1.2.9-2.6 2.8-5.2z" fill="#7EC4EA"/>'],
  wow: ['Wow', 'wow', bold(34, 11.5, 13, '#E5484D', '!')],
  party: ['Party', 'grin', '<path d="M14.5 12.4L20 1.2l5.5 11.2z" fill="#B8A4E8" stroke="#8E76CF" stroke-width=".8" stroke-linejoin="round"/><circle cx="20" cy="1.6" r="1.6" fill="#F0A93B"/><circle cx="3.5" cy="7" r="1.1" fill="#E5484D"/><circle cx="36" cy="5" r="1.1" fill="#3FA66B"/><circle cx="37" cy="24" r="1" fill="#F0A93B"/><circle cx="2.8" cy="26" r="1" fill="#7EC4EA"/>'],
  zzz: ['Zzz', 'sleep', bold(31, 9.5, 8, '#7C83C9', 'z') + bold(36, 4.8, 6, '#7C83C9', 'z')],
}
const stickerSvg = (name, color, size = 84) => (STICKER[name] ? beeSvg(color || '#F6C86B', STICKER[name][1], size, false, '', STICKER[name][2]) : '')
const queenSvg = (size = 44, mood = 'happy', anim = '') => beeSvg('#F6C86B', mood, size, true, anim)
// The bee drawing for a bee's current status
const beeOf = (a, size = 44) => beeSvg(a.color, moodOf(a.status), size, false, a.status, '', rankOf(a.xp).i)
// The same bee with a fixed expression, for avatars in conversations
const beeFace = (a, size = 28, mood = 'happy', anim = '') => beeSvg(a.color, mood, size, false, anim, '', rankOf(a.xp).i)
// The rank next to a bee's name
function rankChip(a) {
  const r = rankOf(a.xp)
  return `<span class="rank" style="--rc:${r.c}" title="${r.name} · ${r.xp} round${r.xp === 1 ? '' : 's'} finished${r.next ? ` · ${r.need} more to ${r.next}` : ''}"><i></i>${r.name}</span>`
}

const ic = (d, extra = '') => `<svg class="ic" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`
const ICON = {
  more: ic('<circle cx="3.5" cy="8" r="1.25" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.25" fill="currentColor" stroke="none"/>'),
  play: ic('<path d="M5 3.2v9.6L12.5 8z" fill="currentColor" stroke="none"/>'),
  pause: ic('<path d="M5.5 3.5v9M10.5 3.5v9" stroke-width="2"/>'),
  stop: ic('<rect x="4" y="4" width="8" height="8" rx="1.6" fill="currentColor" stroke="none"/>'),
  resume: ic('<path d="M3 3.5v9M6.5 3.2v9.6L13.5 8z"/>'),
  chat: ic('<path d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H7l-3 2.5V11a2 2 0 0 1-1.5-2z"/>'),
  gear: ic('<g transform="scale(.6667)" stroke-width="2.1"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></g>'),
  trash: ic('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.8M9.2 7v3.8"/>'),
  branch: ic('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-7 3.5"/>'),
  folder: ic('<path d="M2 4.5a1 1 0 0 1 1-1h3l1.4 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>'),
  plus: ic('<path d="M8 3.2v9.6M3.2 8h9.6"/>'),
  caret: ic('<path d="M4 6l4 4 4-4"/>'),
  doc: ic('<path d="M9.5 2H4.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5zM9.5 2v3h3M6 8.5h4M6 11h4"/>'),
  image: ic('<rect x="2.2" y="3" width="11.6" height="10" rx="1.4"/><circle cx="5.8" cy="6.4" r="1.1"/><path d="M2.6 11.6l3.3-3.1 2.5 2.2 2-1.7 3.2 2.8"/>'),
  codefile: ic('<path d="M6 5.2L3.2 8 6 10.8M10 5.2L12.8 8 10 10.8"/>'),
  newFile: ic('<path d="M9 2H4.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M9 2l3.5 3.5V8M9 2v3.5h3.5M12 10.2v4M10 12.2h4"/>'),
  newFolder: ic('<path d="M14 8V5.5a1 1 0 0 0-1-1H7.4L6 3H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h5.5M12 10.2v4M10 12.2h4"/>'),
  x: ic('<path d="M4 4l8 8M12 4l-8 8"/>'),
  check: ic('<path d="M3.2 8.4l3 3 6.6-6.8"/>'),
  search: ic('<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2l3.3 3.3"/>'),
  hive: ic('<path d="M8 1.8l5.4 3.1v6.2L8 14.2l-5.4-3.1V4.9z"/><path d="M8 5.4l2.3 1.3v2.6L8 10.6 5.7 9.3V6.7z"/>'),
  chart: ic('<path d="M2.5 13.5h11M4.5 11V7.5M8 11V3.5M11.5 11V6"/>'),
  sprout: ic('<path d="M8 14V7.5M8 9C8 6 6 4.2 2.8 4.2 2.8 7.2 4.8 9 8 9zM8 7.5c0-2.6 1.8-4.3 5.2-4.3 0 2.8-1.9 4.3-5.2 4.3z"/>'),
  brain: ic('<path d="M6.2 2.6A2.1 2.1 0 0 0 4 4.7a2.2 2.2 0 0 0-1.5 2.9A2.3 2.3 0 0 0 3 11a2.2 2.2 0 0 0 3.2 2.2c.9-.3 1.8-1 1.8-2.2V4.4c0-1-.8-1.8-1.8-1.8zM9.8 2.6A2.1 2.1 0 0 1 12 4.7a2.2 2.2 0 0 1 1.5 2.9A2.3 2.3 0 0 1 13 11a2.2 2.2 0 0 1-3.2 2.2c-.9-.3-1.8-1-1.8-2.2"/>'),
  refresh: ic('<path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.8v2.6h-2.6"/>'),
  terminal: ic('<rect x="2" y="3" width="12" height="10" rx="1.6"/><path d="M4.8 6.5L6.8 8l-2 1.5M8.4 10h2.8"/>'),
  smile: ic('<circle cx="8" cy="8" r="6.2"/><path d="M5.6 9.6q2.4 2.4 4.8 0"/><circle cx="6" cy="6.6" r=".8" fill="currentColor" stroke="none"/><circle cx="10" cy="6.6" r=".8" fill="currentColor" stroke="none"/>'),
  send: ic('<path d="M8 12.8V3.4M4 7.2l4-4 4 4" stroke-width="1.8"/>'),
  link: ic('<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.7.7M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.7-.7"/>'),
  merge: ic('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="8" r="1.5"/><path d="M4.5 5v6M4.5 5c0 3 3 3 5.5 3"/>'),
  pr: ic('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H8M9.5 3L8 4.5 9.5 6"/>'),
  clock: ic('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>'),
  crown: ic('<path d="M2.5 12h11M3 10.5l-.8-6 3.3 2.6L8 3.2l2.5 3.9 3.3-2.6-.8 6z"/>'),
  moon: ic('<path d="M13 9.4A5.5 5.5 0 0 1 6.6 3a5.5 5.5 0 1 0 6.4 6.4z"/>'),
  eye: ic('<path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8s-2.3 4.2-6.2 4.2S1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.8"/>'),
  edit: ic('<path d="M10.8 2.8l2.4 2.4L6 12.4l-3 .6.6-3z"/>'),
  finder: ic('<path d="M2 4.5a1 1 0 0 1 1-1h3l1.4 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><path d="M6 9.5l2 1.5 2-1.5"/>'),
}

// ───────── Copy ─────────
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], DAYS3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmtDur = ms => { const s = Math.round(ms / 1000); return s < 60 ? s + 's' : s < 3600 ? `${Math.floor(s / 60)}m ${pad2(s % 60)}s` : `${Math.floor(s / 3600)}h ${pad2(Math.floor(s % 3600 / 60))}m` }
const fmtMin = ms => (ms < 60000 ? Math.round(ms / 1000) + ' s' : ms < 3600000 ? Math.round(ms / 60000) + ' min' : (ms / 3600000).toFixed(1) + ' h')
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n || 0)) + ' tok'
const fmtUsd = n => '$' + (n || 0).toFixed(2)
const costText = t => (!t ? '' : t.usd ? fmtUsd(t.usd) : t.tok ? fmtTok(t.tok) : '')
const tilde = (p, home) => (home && p && p.startsWith(home) ? '~' + p.slice(home.length) : p || '')
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const hmOf = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
function ago(t, now = Date.now()) {
  const s = Math.max(0, now - t) / 1000
  return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'
}

const isWeekdays = s => s.mode === 'weekdays' || (s.mode === 'weekly' && (s.days || []).join() === '1,2,3,4,5')
const isWeekends = s => s.mode === 'weekly' && [...(s.days || [])].sort().join() === '0,6'
// An event trigger in a few words. nameOf: bee id → name (optional)
function eventText(e, nameOf) {
  if (!e) return 'On event'
  if (e.type === 'github') return `On GitHub: ${(e.what || []).map(w => ({ pr: 'new PR', comment: 'new comment', ci: 'CI failure' }[w])).filter(Boolean).join(', ')}`
  if (e.type === 'bee') { const n = (e.ids || []).map(id => (nameOf ? nameOf(id) : '')).filter(Boolean); return `When ${n.length ? n.join(' or ') : 'a bee'} ${e.on === 'error' ? 'fails' : e.on === 'any' ? 'ends a round' : 'finishes'}` }
  return `On commit${e.branch ? ` to ${e.branch}` : ''}${e.remote ? ' (remote)' : ''}`
}
function schedText(s) {
  if (!s) return 'Manual'
  switch (s.mode) {
    case 'event': return eventText(s.event)
    case 'adhoc': return `Once · ${String(s.at || '').slice(5).replace('T', ' ')}`
    case 'daily': return `Daily ${s.time}`
    case 'weekdays': return `Weekdays ${s.time}`
    case 'weekly': return isWeekdays(s) ? `Weekdays ${s.time}` : isWeekends(s) ? `Weekends ${s.time}` : `Weekly ${[...(s.days || [])].sort((a, b) => (a || 7) - (b || 7)).map(d => DAYS[d]).join(' ')} ${s.time}`
    case 'monthly': return `Monthly day ${s.dom} ${s.time}`
    case 'interval': return s.every % 60 === 0 ? `Every ${s.every / 60} h` : `Every ${s.every} min`
    default: return 'Manual'
  }
}
// Schedule category (for the second filter row); weekdays count as weekly
const schedKind = s => (!s || s.mode === 'manual' ? null : s.mode === 'weekdays' ? 'weekly' : s.mode)

// Whether this is a day to run (same rules as core.slotKey)
function dayMatch(s, d) {
  switch (s.mode) {
    case 'daily': return true
    case 'weekdays': return d.getDay() !== 0 && d.getDay() !== 6
    case 'weekly': return (s.days || []).includes(d.getDay())
    case 'monthly': return d.getDate() === Math.min(s.dom || 1, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())
    default: return false
  }
}
// Next run time (Date) or null
function nextRun(s, now = new Date()) {
  if (!s || s.mode === 'manual' || s.mode === 'event') return null
  if (s.mode === 'adhoc') { const d = new Date(s.at); return s.at && d > now ? d : null }
  if (s.mode === 'interval') { const ms = Math.max(1, s.every || 60) * 60000; return new Date((Math.floor(now.getTime() / ms) + 1) * ms) }
  const [h, m] = String(s.time || '09:00').split(':').map(Number)
  for (let i = 0; i < 400; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m, 0, 0)
    if (d > now && dayMatch(s, d)) return d
  }
  return null
}
function whenText(d, now = new Date()) {
  if (!d) return ''
  const day0 = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day0(d) - day0(now)) / 86400000)
  const day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff > 1 && diff < 7 ? DAYS3[d.getDay()] : `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  return `${day} ${hmOf(d)}`
}

// ───────── Browser only ─────────
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i
const fileUrl = p => 'file://' + p.split('/').map(encodeURIComponent).join('/')
// Resolve a local path relative to the workspace
function resolvePath(p, base, home) {
  if (p.startsWith('~/') && home) return home + p.slice(1)
  if (p.startsWith('/')) return p
  const parts = (base + '/' + p).split('/'), out = []
  for (const x of parts) { if (x === '..') out.pop(); else if (x !== '.' && (x || !out.length)) out.push(x) }
  return out.join('/') || '/'
}
// Markdown → sanitized HTML. Tables get a horizontally scrollable wrapper; local images resolve to file://
function renderMd(md, base, home) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') return `<p>${esc(md)}</p>`
  const tpl = document.createElement('template')
  tpl.innerHTML = DOMPurify.sanitize(marked.parse(String(md || ''), { gfm: true, breaks: true }), { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'], FORBID_ATTR: ['style'] })
  for (const t of tpl.content.querySelectorAll('table')) { const w = document.createElement('div'); w.className = 'tbl'; t.replaceWith(w); w.appendChild(t) }
  for (const a of tpl.content.querySelectorAll('a')) { a.target = '_blank'; a.rel = 'noreferrer' }
  for (const img of tpl.content.querySelectorAll('img')) {
    const src = img.getAttribute('src') || ''
    if (/^(https?:|data:)/i.test(src)) continue
    if (!base) { img.remove(); continue }
    let p = src.replace(/^file:\/\//, '')
    try { p = decodeURIComponent(p) } catch {}
    p = resolvePath(p, base, home)
    img.setAttribute('src', fileUrl(p)); img.dataset.img = p; img.classList.add('local-img')
  }
  return tpl.innerHTML
}

let toastTimer = null
function toast(msg, kind) {
  let el = document.getElementById('toast')
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el) }
  el.textContent = msg
  el.className = 'show' + (kind ? ' ' + kind : '')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.className = ''), kind === 'err' ? 5200 : 2600)
}
// A raw failure → a soft line for the Activity list (the raw text stays in the tooltip)
function gentle(text) {
  const s = String(text || ''), job = /^(Dreaming|Gardening) failed/i.exec(s), at = job ? ` while ${job[1].toLowerCase()}` : ''
  const d = s.replace(/^(Dreaming|Gardening) failed:\s*/i, '').replace(/^Failed( to start)?:?\s*/i, '')
  if (/exit code (143|130|137)|SIG(TERM|INT|KILL)|interrupted/i.test(s)) return `got interrupted${at}, will try again later`
  if (/took too long|timed? ?out/i.test(s)) return `took too long${at} and stopped for now`
  if (/command not found|ENOENT/i.test(s)) return `can't find its command. Is the CLI installed?`
  if (/rate.?limit|usage limit|overloaded|\b(429|529)\b/i.test(s)) return `ran into a rate limit${at} and is taking a breather`
  if (/log ?in|sign ?in|unauthori[sz]ed|\b401\b|api key|credential/i.test(s)) return `needs you to sign in again`
  return `hit a snag${at}${d ? ': ' + d.slice(0, 90) : ''}`
}
// Shared handling of hive.call results: {error} → toast and return null
async function call(ch, ...args) {
  const r = await window.hive.call(ch, ...args)
  if (r && r.error) { toast(r.error, 'err'); return null }
  return r === undefined || r === null ? true : r
}
// Animation phase: stays continuous across re-renders
const animT = () => `--t:${Math.round(performance.now())}`

if (typeof module !== 'undefined' && module.exports)
  module.exports = { esc, gentle, STATUS, RANKS, rankOf, beeSvg, STICKER, stickerSvg, schedText, schedKind, dayMatch, nextRun, whenText, fmtDur, fmtTok, fmtUsd, ago, tilde, resolvePath, isWeekdays, isWeekends, eventText }
