// electron-builder afterPack hook: make the terminal helper executable, then ad-hoc sign the app bundle for unsigned builds.
// Without at least an ad-hoc signature, Apple silicon Macs refuse to launch the app.
// Skipped for signed builds (npm run dist:signed), where a Developer ID signature follows.
const { execFileSync } = require('child_process')
const path = require('path'), fs = require('fs')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // The terminal's helper must be executable for both architectures, whatever the install left behind
  for (const arch of ['arm64', 'x64']) try { fs.chmodSync(path.join(app, 'Contents', 'Resources', 'app', 'node_modules', 'node-pty', 'prebuilds', `darwin-${arch}`, 'spawn-helper'), 0o755) } catch {}
  if (process.env.CSC_NAME) return
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
