// Extra skins: not shipped with the app, downloaded when the user asks for one and kept in the data folder.
// A skin pack is a zip holding <id>/skin.json and <id>/<colour 0-7>/<face or a-loop>.webp, published with a catalog
// as assets of one release ("skins") of the app's repository. Pictures only: nothing in a pack is ever run.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto')
const { execFile } = require('child_process')
const { pathToFileURL } = require('url')

const REPO = 'ericwang915/agent-hive'
const BASE = process.env.HIVE_SKINS || `https://github.com/${REPO}/releases/download/skins/`      // tests: packs served from somewhere else
const BUILT_IN = ['bee', 'maid', 'classic']
const MOODS = ['happy', 'grin', 'love', 'wow', 'flat', 'sad', 'sleep'], LOOPS = ['run', 'idle', 'sleep', 'error'], COLOURS = 8
const MAX_ZIP = 40 << 20, MAX_FILE = 2 << 20
const ID = /^[a-z][a-z0-9-]{1,23}$/

const sh = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 8 << 20 }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim().split('\n').pop())) : resolve(String(out)))))
const text = (v, n) => String(v || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n)
// What a catalog line or a pack's skin.json may say about a skin; null when it is not a skin this app can use
function meta(o) {
  if (!o || !ID.test(String(o.id)) || BUILT_IN.includes(o.id)) return null
  const name = text(o.name, 28)
  if (!name) return null
  return { id: o.id, name, about: text(o.about, 80), loops: (Array.isArray(o.loops) ? o.loops : []).filter(l => LOOPS.includes(l)) }
}
// The skins on offer. The addresses are built from the id, so a catalog cannot point the app anywhere else
async function catalog(fetchFn = fetch) {
  const res = await fetchFn(BASE + 'catalog.json', { headers: { 'User-Agent': 'agent-hive' } })
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const o = await res.json(), seen = new Set()
  return (Array.isArray(o && o.skins) ? o.skins : []).slice(0, 60).map(x => {
    const m = meta(x)
    if (!m || seen.has(m.id) || !/^[0-9a-f]{64}$/.test(String(x.sha256))) return null
    seen.add(m.id)
    return { ...m, sha256: x.sha256, size: Math.max(0, +x.size || 0), preview: `${BASE}${m.id}.webp` }
  }).filter(Boolean)
}
const isWebp = f => { const b = Buffer.alloc(12), fd = fs.openSync(f, 'r'); try { fs.readSync(fd, b, 0, 12, 0) } finally { fs.closeSync(fd) } return b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' }
// A folder is a usable skin when it holds skin.json for this id and, per colour, every face; nothing else may be in it
function check(dir, id) {
  let m
  try { m = meta(JSON.parse(fs.readFileSync(path.join(dir, 'skin.json'), 'utf8'))) } catch { throw new Error('The pack has no readable skin.json') }
  if (!m || m.id !== id) throw new Error('The pack is not the skin it was listed as')
  const top = fs.readdirSync(dir).filter(n => n !== '.DS_Store').sort()
  if (top.join() !== [...Array(COLOURS).keys(), 'skin.json'].join()) throw new Error('The pack does not have one folder per bee colour')
  const loops = new Set(LOOPS)
  for (let c = 0; c < COLOURS; c++) {
    const d = path.join(dir, String(c))
    if (!fs.lstatSync(d).isDirectory()) throw new Error('The pack holds something that is not a picture')
    const names = fs.readdirSync(d).filter(n => n !== '.DS_Store')
    for (const n of names) {
      const mm = n.match(/^(a-)?([a-z]+)\.webp$/), st = fs.lstatSync(path.join(d, n))
      if (!mm || !(mm[1] ? LOOPS : MOODS).includes(mm[2]) || !st.isFile() || st.size > MAX_FILE || !isWebp(path.join(d, n))) throw new Error('The pack holds something that is not a picture')
    }
    for (const f of MOODS) if (!names.includes(f + '.webp')) throw new Error(`The pack is missing a face (${f})`)
    for (const l of LOOPS) if (!names.includes(`a-${l}.webp`)) loops.delete(l)
  }
  return { ...m, loops: m.loops.filter(l => loops.has(l)) }
}
// The extra skins in the data folder, each with the address its pictures are read from
function installed(root) {
  let ids = []
  try { ids = fs.readdirSync(root) } catch {}
  return ids.filter(id => ID.test(id) && !BUILT_IN.includes(id)).sort().map(id => {
    try { return { ...check(path.join(root, id), id), dir: pathToFileURL(path.join(root, id)).href } } catch { return null }
  }).filter(Boolean)
}
const sha256 = f => new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex'))) })
// Unpack a zip that is already on disk into root/<id>. The old copy, if any, is replaced only once the new one checks out
async function unpack(zip, entry, root) {
  if (fs.statSync(zip).size > MAX_ZIP) throw new Error('The pack is larger than a skin should be')
  if (await sha256(zip) !== entry.sha256) throw new Error('The download does not match the catalog; not installing it')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hive-skin-'))
  try {
    await sh('ditto', ['-x', '-k', zip, tmp])
    const src = path.join(tmp, entry.id)
    if (!fs.existsSync(src) || !fs.lstatSync(src).isDirectory()) throw new Error('The pack is not the skin it was listed as')
    const m = check(src, entry.id), dest = path.join(root, entry.id)
    fs.mkdirSync(root, { recursive: true }); fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(src, dest, { recursive: true })
    return m
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}
async function install(entry, root) {
  if (!entry || !meta(entry)) throw new Error('No such skin')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hive-skin-dl-')), zip = path.join(tmp, 'skin.zip')
  try {
    await sh('curl', ['-fsSL', '--retry', '2', '--max-time', '300', '--max-filesize', String(MAX_ZIP), '-o', zip, `${BASE}${entry.id}.zip`])
    return await unpack(zip, entry, root)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}
function remove(id, root) {
  if (!ID.test(String(id)) || BUILT_IN.includes(id)) throw new Error('No such skin')
  fs.rmSync(path.join(root, id), { recursive: true, force: true })
}

module.exports = { BASE, BUILT_IN, MOODS, LOOPS, meta, catalog, check, installed, unpack, install, remove, sha256 }
