// electron-builder afterSign hook for signed builds: notarize the app with Apple and staple the ticket,
// before the .zip and .dmg are made, so the app verifies offline wherever it ends up.
// Credentials come from a notarytool keychain profile named in NOTARYTOOL_PROFILE; create one with
//   xcrun notarytool store-credentials <profile> --apple-id <id> --team-id <team> --password <app-specific password>
// Nothing secret lives in this repo.
const { execFileSync } = require('child_process')
const path = require('path'), os = require('os'), fs = require('fs')

exports.default = async function (context) {
  const profile = process.env.NOTARYTOOL_PROFILE
  if (context.electronPlatformName !== 'darwin' || !profile) return
  const name = context.packager.appInfo.productFilename, app = path.join(context.appOutDir, `${name}.app`)
  const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notarize-')), `${name}.zip`)
  execFileSync('ditto', ['-c', '-k', '--keepParent', app, zip])
  console.log(`  • notarizing ${name}.app (${path.basename(context.appOutDir)})`)
  const out = execFileSync('xcrun', ['notarytool', 'submit', zip, '--keychain-profile', profile, '--wait'], { encoding: 'utf8' })
  fs.rmSync(path.dirname(zip), { recursive: true, force: true })
  if (!/status:\s*Accepted/.test(out)) throw new Error('Notarization was not accepted:\n' + out)
  execFileSync('xcrun', ['stapler', 'staple', app], { stdio: 'inherit' })
}
