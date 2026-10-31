const { packager } = require('@electron/packager');
const path = require('node:path');
packager({
  dir: path.resolve(__dirname, '..'), name: 'Portio', platform: 'darwin', arch: 'arm64',
  appBundleId: 'jp.local.duochromium', appCategoryType: 'public.app-category.productivity',
  icon: path.resolve(__dirname, '../resources/AppIcon.icns'),
  out: process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../dist'), overwrite: true, prune: false,
  // Package only application files; never include local build outputs or profiles.
  ignore: [/^\/(?!(?:src|resources)(?:\/|$)|package\.json$|LICENSE$).+/],
  extendInfo: { NSCameraUsageDescription: 'サイトでビデオ通話や撮影を行う際にカメラを使用します。', NSMicrophoneUsageDescription: 'サイトで通話や音声入力を行う際にマイクを使用します。' }
}).then(paths => paths.forEach(p => {
  const { execFileSync } = require('node:child_process');
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', path.join(p, 'Portio.app')], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(p, 'Portio.app')], { stdio: 'inherit' });
  console.log(p);
})).catch(error => { console.error(error.message); process.exitCode = 1; });
