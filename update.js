// Upgrading: look for a newer release on GitHub, download it, check its signature, swap the app bundle. No Electron dependency.
'use strict'
const fs = require('fs'), path = require('path'), os = require('os')
const { execFile, spawn } = require('child_process')

const REPO = 'ericwang915/agent-hive'
const PAGE = `https://github.com/${REPO}/releases/latest`
const APP = 'Agent Hive.app'

const nums = v => String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map(n => parseInt(n, 10) || 0)
// Is version a newer than version b? ("v1.2.0" and "1.2.0" are the same)
function newer(a, b) {
  const x = nums(a), y = nums(b)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

// The latest release → {version, tag, notes, url}, or null when there is none
async function latest(fetchFn = fetch) {
  const res = await fetchFn(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agent-hive' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const o = await res.json()
  if (!o || !/^v?\d+\.\d+/.test(String(o.tag_name))) return null
  return { version: String(o.tag_name).replace(/^v/i, ''), tag: String(o.tag_name), notes: String(o.body || '').slice(0, 4000), url: String(o.html_url || PAGE) }
}

const sh = (cmd, args, opts = {}) => new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 8 << 20, ...opts }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim().split('\n').pop())) : resolve(String(out) + String(err)))))
// Who signed a bundle: the Apple team id, or '' for ad-hoc / unsigned
const teamOf = async app => { try { const mm = (await sh('codesign', ['-dv', app])).match(/^TeamIdentifier=(\S+)$/m); return mm && mm[1] !== 'not' ? mm[1] : '' } catch { return '' } }

// Where the running app lives, when it can be replaced in place. execPath = …/Agent Hive.app/Contents/MacOS/Agent Hive
function bundleOf(execPath) {
  const app = path.resolve(execPath, '..', '..', '..')
  if (!app.endsWith('.app') || app.includes('/AppTranslocation/') || app.startsWith('/Volumes/')) return ''
  try { fs.accessSync(path.dirname(app), fs.constants.W_OK); fs.accessSync(app, fs.constants.W_OK) } catch { return '' }
  return app
}

// Download a release and check it: a valid signature, from the same team as the running app, with the version we expect.
// → the path of the unpacked new bundle (in a temp folder next to nothing of ours)
async function fetchRelease(rel, o = {}) {
  const arch = o.arch || (process.arch === 'arm64' ? 'arm64' : 'x64')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hive-update-'))
  try {
    await sh('curl', ['-fsSL', '--retry', '2', '--max-time', '900', '-o', path.join(tmp, 'app.zip'), `https://github.com/${REPO}/releases/download/${rel.tag}/Agent-Hive-${arch}.zip`])
    await sh('ditto', ['-x', '-k', path.join(tmp, 'app.zip'), path.join(tmp, 'out')])
    const app = path.join(tmp, 'out', APP)
    if (!fs.existsSync(app)) throw new Error(`The download did not contain ${APP}`)
    await sh('codesign', ['--verify', '--deep', '--strict', app])
    const team = await teamOf(app)
    if ((o.team || '') !== team) throw new Error('The new version is signed by someone else than this one; not installing it')
    const v = (await sh('defaults', ['read', path.join(app, 'Contents', 'Info.plist'), 'CFBundleShortVersionString'])).trim()
    if (nums(v).join('.') !== nums(rel.version).join('.')) throw new Error(`Expected version ${rel.version} but the download is ${v}`)
    fs.rmSync(path.join(tmp, 'app.zip'), { force: true })
    return app
  } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e }
}

// After the app (pid) has quit: move the new bundle into place and open it. The old one is put back if the move fails
const swapScript = `
pid="$1"; new="$2"; dest="$3"; old="$dest.old-$$"
for i in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
mv "$dest" "$old" || { open "$dest"; exit 1; }
if mv "$new" "$dest"; then rm -rf "$old" "$(dirname "$(dirname "$new")")"; else mv "$old" "$dest"; fi
[ -n "$4" ] || open "$dest"
`
function swap(pid, fresh, dest, noOpen) {
  const child = spawn('/bin/bash', ['-c', swapScript, 'swap', String(pid), fresh, dest, noOpen ? '1' : ''], { detached: true, stdio: 'ignore' })
  child.unref()
  return child
}

module.exports = { REPO, PAGE, newer, latest, teamOf, bundleOf, fetchRelease, swap }
