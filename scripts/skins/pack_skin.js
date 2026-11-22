#!/usr/bin/env node
// Pack skins/<id> (as build_skin.py wrote it) into what the app installs on request: <out>/<id>.zip, a preview
// picture <out>/<id>.webp, and its line in <out>/catalog.json. The three files are uploaded as assets of the
// "skins" release; a packed skin is not shipped with the app, so its folder stays out of the repository.
// usage: node scripts/skins/pack_skin.js <id> "<name>" "<about>" [--src skins] [--out dist-skins]
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process')
const store = require('../../skinstore')
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args.splice(i, 2)[1] }
const src = path.resolve(opt('src', 'skins')), out = path.resolve(opt('out', 'dist-skins')), [id, name, about] = args
if (!id || !name) { console.error('usage: pack_skin.js <id> "<name>" "<about>" [--src skins] [--out dist-skins]'); process.exit(2) }
const m = store.meta({ id, name, about, loops: store.LOOPS })
if (!m) { console.error(`"${id}" cannot be a skin id (lower case, 2-24 letters, not a built-in skin)`); process.exit(2) }
;(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-pack-')), dir = path.join(tmp, id)
  try {
    fs.cpSync(path.join(src, id), dir, { recursive: true, filter: f => path.basename(f) !== '.DS_Store' })
    fs.writeFileSync(path.join(dir, 'skin.json'), JSON.stringify(m))
    const ok = store.check(dir, id)                              // the same check the app runs; also drops loops the skin does not have
    fs.writeFileSync(path.join(dir, 'skin.json'), JSON.stringify(ok))
    fs.mkdirSync(out, { recursive: true })
    const zip = path.join(out, id + '.zip'); fs.rmSync(zip, { force: true })
    execFileSync('ditto', ['-c', '-k', '--norsrc', '--keepParent', dir, zip])
    fs.copyFileSync(path.join(dir, '4', 'happy.webp'), path.join(out, id + '.webp'))
    const file = path.join(out, 'catalog.json'); let cat = { skins: [] }
    try { cat = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
    cat.skins = cat.skins.filter(k => k.id !== id).concat({ ...ok, size: fs.statSync(zip).size, sha256: await store.sha256(zip) })
    fs.writeFileSync(file, JSON.stringify(cat, null, 2) + '\n')
    console.log(`${zip}  ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB  loops: ${ok.loops.join(', ') || 'none'}`)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})().catch(e => { console.error(String(e.message || e)); process.exit(1) })
