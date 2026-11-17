// electron-builder afterPack hook: ad-hoc sign the app bundle for unsigned builds.
// Without at least an ad-hoc signature, Apple silicon Macs refuse to launch the app.
// Skipped for signed builds (npm run dist:signed), where a Developer ID signature follows.
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin' || process.env.CSC_NAME) return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
