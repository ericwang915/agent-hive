// What the bees produced: files they wrote or named in a reply, and links they gave. Pure logic over log entries, no Electron
'use strict'

const DOC = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'tsv', 'md', 'txt', 'html', 'htm', 'key', 'pages', 'numbers', 'ipynb', 'rtf']
const IMG = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'heic']
const MEDIA = ['mp4', 'mov', 'mp3', 'wav', 'zip']
const SHOWN = [...DOC, ...IMG, ...MEDIA]
const extOf = p => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(p || '')); return m ? m[1].toLowerCase() : '' }
// doc | image | media | code (everything else a bee wrote)
const kindOf = p => { const e = extOf(p); return DOC.includes(e) ? 'doc' : IMG.includes(e) ? 'image' : MEDIA.includes(e) ? 'media' : 'code' }
// Safe to hand to the system's default app: documents and pictures, never something that runs
const canOpen = p => [...DOC, ...IMG, ...MEDIA].includes(extOf(p)) && !['html', 'htm'].includes(extOf(p))

const WRITES = /^(Write|Edit|MultiEdit|NotebookEdit|write_file|create_file|str_replace_editor|apply_patch)$/i
const URL_RE = /https?:\/\/[^\s<>"'`）】」』，。；]+/g
const PATH_RE = new RegExp(String.raw`(?:^|[\s\`"'(（「『【:：=])((?:~\/|\.{1,2}\/|\/)?(?:[^\s\`"'<>()（）「」『』【】，。；:*?|]+\/)*[^\s\`"'<>()（）「」『』【】，。；:*?|\/]+\.(?:${SHOWN.join('|')}))(?=$|[\s\`"')）」』】，。；:,.!?])`, 'gi')

// Where a link points, in two or three words
const SITES = [[/claude\.ai\/(code\/)?artifact/, 'Claude artifact'], [/docs\.google\.com\/presentation/, 'Google Slides'], [/docs\.google\.com\/document/, 'Google Doc'], [/docs\.google\.com\/spreadsheets/, 'Google Sheet'],
  [/drive\.google\.com/, 'Google Drive'], [/github\.com\/[^/]+\/[^/]+\/pull\/\d+/, 'Pull request'], [/github\.com\/[^/]+\/[^/]+\/issues\/\d+/, 'GitHub issue'], [/github\.com/, 'GitHub'], [/notion\.(so|site)/, 'Notion'],
  [/atlassian\.net\/wiki|confluence/, 'Confluence'], [/atlassian\.net\/browse|jira/, 'Jira'], [/figma\.com/, 'Figma'], [/linear\.app/, 'Linear'], [/slack\.com/, 'Slack']]
const siteOf = url => { const hit = SITES.find(([re]) => re.test(url)); if (hit) return hit[1]; try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'Link' } }
const trimUrl = u => { u = u.replace(/[.,;:!?*_~]+$/, ''); while (u.endsWith(')') && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) u = u.slice(0, -1); return u }

// entries: one bee's log → [{kind: 'file', path, t, via: 'wrote' | 'named'} | {kind: 'link', url, site, label, t}], each path and URL once, with the latest time it came up
function scan(entries) {
  const files = new Map(), links = new Map()
  const file = (p, t, via) => { p = String(p || '').trim(); if (!p || p.length > 1024) return; const old = files.get(p); files.set(p, { kind: 'file', path: p, t: Math.max(t || 0, old ? old.t : 0), via: via === 'wrote' || (old && old.via === 'wrote') ? 'wrote' : 'named' }) }
  for (const e of entries || []) {
    if (!e) continue
    if (e.role === 'tool' && WRITES.test(String(e.name || '')) && e.input) file(e.input.file_path || e.input.path || e.input.notebook_path, e.t, 'wrote')
    if (e.role !== 'assistant' || e.sub || typeof e.text !== 'string') continue
    const text = e.text
    for (const mm of text.matchAll(/\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)/g)) { const u = trimUrl(mm[2]); if (!links.has(u) || !links.get(u).label) links.set(u, { kind: 'link', url: u, site: siteOf(u), label: mm[1].trim(), t: e.t || 0 }) }
    for (const mm of text.matchAll(URL_RE)) {
      const u = trimUrl(mm[0])
      if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(u) || u.length > 600) continue
      const old = links.get(u)
      links.set(u, { kind: 'link', url: u, site: siteOf(u), label: old ? old.label : '', t: Math.max(e.t || 0, old ? old.t : 0) })
    }
    for (const mm of text.matchAll(/`([^`\n]{1,300})`/g)) if (SHOWN.includes(extOf(mm[1])) && !/^https?:/.test(mm[1])) file(mm[1], e.t, 'named')      // in backticks a name may hold spaces
    for (const mm of text.replace(/`[^`\n]{1,300}`/g, ' ').replace(URL_RE, ' ').matchAll(PATH_RE)) file(mm[1], e.t, 'named')
  }
  return [...files.values(), ...links.values()]
}

module.exports = { scan, kindOf, extOf, canOpen, siteOf, DOC, IMG }
