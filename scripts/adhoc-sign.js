// electron-builder afterPack hook: ad-hoc sign the app bundle.
// There is no Apple Developer certificate; without at least an ad-hoc signature
// Apple silicon Macs refuse to launch the app at all.
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
