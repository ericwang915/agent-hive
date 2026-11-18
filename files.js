// Pure logic: the file browser in the chat window. Listing, reading and locating paths under a bee's folder. No Electron dependency.
'use strict'
const fs = require('fs'), path = require('path')

const HIDE = new Set(['.git', '.DS_Store'])
const MAX_LIST = 800, MAX_TEXT = 400 * 1024
const IMG = /\.(png|jpe?g|gif|webp|svg|bmp)$/i
const SUFFIX = /(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)$/          // file.js:12, file.js:12:3, file.js#L12, file.js#L12-L20

const real = p => { try { return fs.realpathSync(p) } catch { return '' } }
const within = (root, p) => p === root || p.startsWith(root + path.sep)

// Real path of rel under root. Throws when it is missing or escapes root (symlinks resolved)
function inside(root, rel) {
  const r = real(root), p = real(path.resolve(root, String(rel || '')))
  if (!r || !p || !within(r, p)) throw new Error('Not inside this bee\'s folder')
  return p
}

// One folder level: folders first, then files, by name
function list(root, rel) {
  const dir = inside(root, rel)
  const items = []
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (HIDE.has(d.name)) continue
    let isDir = d.isDirectory()
    if (d.isSymbolicLink()) { try { isDir = fs.statSync(path.join(dir, d.name)).isDirectory() } catch { continue } }
    items.push({ name: d.name, dir: isDir })
  }
  items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  return { items: items.slice(0, MAX_LIST), more: Math.max(0, items.length - MAX_LIST) }
}

const read = (root, rel) => readAt(inside(root, rel))
// file is an absolute path that the caller has already resolved
function readAt(file) {
  const st = fs.statSync(file)
  if (st.isDirectory()) throw new Error('That is a folder')
  if (!st.isFile()) throw new Error('Not a regular file')
  if (IMG.test(file)) return { kind: 'image', abs: file, size: st.size }
  const buf = Buffer.alloc(Math.min(st.size, MAX_TEXT))
  const fd = fs.openSync(file, 'r')
  try { fs.readSync(fd, buf, 0, buf.length, 0) } finally { fs.closeSync(fd) }
  if (buf.subarray(0, 8000).includes(0)) return { kind: 'binary', abs: file, size: st.size }
  return { kind: 'text', abs: file, size: st.size, mtime: st.mtimeMs, cut: st.size > MAX_TEXT, text: buf.toString('utf8') }
}

// Where a new entry (or a renamed one) would go: its folder must exist inside root, and the name must be a plain name
function insideNew(root, rel) {
  rel = String(rel || '').replace(/\/+$/, '')
  const name = path.basename(rel)
  if (!name || name === '.' || name === '..' || name.length > 255 || /[\0/\\]/.test(name)) throw new Error('That name cannot be used')
  return path.join(inside(root, path.dirname(rel) === '.' ? '' : path.dirname(rel)), name)
}
const exists = p => { try { fs.lstatSync(p); return true } catch { return false } }
const relOf = (root, abs) => path.relative(real(root), abs).split(path.sep).join('/')

// An existing entry under root, as it is named there: a symlink stays the link, not what it points at. The root itself is refused
function entry(root, rel) {
  rel = String(rel || '').replace(/\/+$/, '')
  if (!rel || rel === '.') throw new Error('The bee\'s folder itself cannot be changed here')
  const p = path.join(inside(root, path.dirname(rel) === '.' ? '' : path.dirname(rel)), path.basename(rel))
  if (path.basename(rel) === '..' || !exists(p)) throw new Error('Nothing at that path')
  return p
}
// New empty file or folder. → its path relative to root
function create(root, rel, dir) {
  const p = insideNew(root, rel)
  if (exists(p)) throw new Error('Something with that name is already there')
  if (dir) fs.mkdirSync(p); else fs.writeFileSync(p, '', { flag: 'wx' })
  memo.at = 0
  return { rel: relOf(root, p), dir: !!dir }
}
// Rename or move inside root. Never replaces what is already there
function rename(root, from, to) {
  const src = entry(root, from)
  const dst = insideNew(root, to)
  if (dst === src) return { rel: relOf(root, src) }
  if (exists(dst) && !(dst.toLowerCase() === src.toLowerCase())) throw new Error('Something with that name is already there')
  if (within(src, path.dirname(dst))) throw new Error('A folder cannot be moved into itself')
  fs.renameSync(src, dst)
  memo.at = 0
  return { rel: relOf(root, dst) }
}
// Save a text file. mtime: what the editor read; when the file changed on disk since, nothing is written unless force
function write(root, rel, text, o = {}) {
  const p = inside(root, rel), st = fs.statSync(p)
  if (!st.isFile()) throw new Error('Not a regular file')
  if (st.size > MAX_TEXT) throw new Error('This file is too large to edit here')
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_TEXT * 2) throw new Error('Too much text to save')
  if (o.mtime && !o.force && Math.abs(st.mtimeMs - o.mtime) > 1) return { changed: true }
  fs.writeFileSync(p, text)
  const now = fs.statSync(p)
  return { size: now.size, mtime: now.mtimeMs }
}

// Find text in the files under root. → {hits: [{rel, line, text, col}], more}. Plain text, case-insensitive unless the query has an upper-case letter
function grep(root, q, o = {}) {
  const r = real(root), max = o.max || 200
  q = String(q || '')
  if (!r || !q.trim()) return { hits: [], more: false }
  const strict = /[A-Z]/.test(q), needle = strict ? q : q.toLowerCase(), hits = []
  let scanned = 0
  for (const rel of walk(r, 8000)) {
    if (rel.endsWith('/') || IMG.test(rel)) continue
    const file = path.join(r, rel)
    let st; try { st = fs.statSync(file) } catch { continue }
    if (!st.isFile() || st.size > 1024 * 1024 || !st.size) continue
    if ((scanned += st.size) > 64 * 1024 * 1024) return { hits, more: true }
    let text; try { text = fs.readFileSync(file, 'utf8') } catch { continue }
    if (text.slice(0, 8000).includes('\0')) continue
    if (!(strict ? text : text.toLowerCase()).includes(needle)) continue
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const col = (strict ? lines[i] : lines[i].toLowerCase()).indexOf(needle)
      if (col < 0) continue
      const from = Math.max(0, col - 40)
      hits.push({ rel, line: i + 1, col: col - from, text: lines[i].slice(from, from + 200) })
      if (hits.length >= max) return { hits, more: true }
    }
  }
  return { hits, more: false }
}

// A path as written in a conversation → where it is. rel is null when it lies outside root; null when nothing is there
function locate(root, raw, home) {
  let s = String(raw || '').trim().replace(/^file:\/\//, '')
  if (!s || s.length > 1024 || s.includes('\0')) return null
  const r = real(root)
  if (!r) return null
  const at = p => {
    if (p === '~') p = home || p
    else if (p.startsWith('~/') && home) p = path.join(home, p.slice(2))
    const abs = real(path.resolve(r, p))
    if (!abs) return null
    let dir = false
    try { dir = fs.statSync(abs).isDirectory() } catch { return null }
    return { abs, rel: within(r, abs) ? path.relative(r, abs) : null, dir }
  }
  const whole = at(s)
  if (whole) return { ...whole, line: 0 }
  const mm = s.match(SUFFIX)
  if (!mm) return null
  const got = at(s.slice(0, mm.index))
  return got && { ...got, line: got.dir ? 0 : +(mm[1] || mm[2]) }
}

// @-mention completion: paths under root matching q, best first. The walk is remembered for a few seconds
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', '.next', '.venv', 'venv', '__pycache__', '.DS_Store'])
let memo = { root: '', at: 0, paths: [] }
function walk(root, cap = 8000) {
  const out = [], todo = ['']
  while (todo.length && out.length < cap) {
    const rel = todo.shift()
    let ents = []
    try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }) } catch {}
    for (const d of ents) {
      if (SKIP.has(d.name)) continue
      const p = rel ? rel + '/' + d.name : d.name
      if (d.isDirectory()) { out.push(p + '/'); todo.push(p) } else if (d.isFile()) out.push(p)
    }
  }
  return out
}
function search(root, q, max = 10, now = Date.now()) {
  const r = real(root)
  if (!r) return []
  if (memo.root !== r || now - memo.at > 8000) memo = { root: r, at: now, paths: walk(r) }
  q = String(q || '').toLowerCase()
  const hits = []
  for (const p of memo.paths) {
    const low = p.toLowerCase(), base = low.replace(/\/$/, '').split('/').pop()
    const s = !q ? 0 : base.startsWith(q) ? 0 : base.includes(q) ? 1 : low.includes(q) ? 2 : -1
    if (s >= 0) hits.push([s, low.replace(/\/$/, '').split('/').length, p])
  }
  return hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].length - b[2].length || a[2].localeCompare(b[2])).slice(0, max).map(h => h[2])
}

module.exports = { search, list, read, readAt, locate, inside, entry, create, rename, write, grep, MAX_TEXT, MAX_LIST }
