// Regenerate the committed icon with: npm run icon (macOS).
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
(async () => {
  const root = path.resolve(__dirname, '..');
  const svg = path.join(root, 'resources/Portio.svg');
  const iconset = path.join(root, '.build/Portio.iconset');
  await fs.mkdir(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      await sharp(svg).resize(size * scale).png().toFile(path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
    }
  }
  await sharp(svg).resize(512).png().toFile(path.join(root, 'resources/Portio.png'));
  await fs.copyFile(svg, path.join(root, 'src/ui/icon.svg'));
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'resources/AppIcon.icns')]);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
