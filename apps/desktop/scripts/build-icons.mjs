#!/usr/bin/env node
/**
 * build-resources/icon.svg kaynağından uygulama ikonlarını üretir:
 *
 *   build-resources/icon.png   1024×1024 (Linux, geliştirmede dock/pencere ikonu)
 *   build-resources/icon.icns  macOS
 *   build-resources/icon.ico   Windows (16–256 px)
 *   apps/web/public/favicon.svg  arayüz başlığı ve favicon (kenar boşluğu kırpılmış)
 *
 * macOS gerektirir (Chrome ile SVG çizimi, sips ve iconutil). Çıktılar repoya
 * eklenir; paketleme bu betiği çalıştırmaz.
 *
 * Kullanım: node apps/desktop/scripts/build-icons.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = path.join(desktopDir, 'build-resources');
const webPublic = path.resolve(desktopDir, '../web/public');
const source = path.join(resources, 'icon.svg');

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const work = mkdtempSync(path.join(os.tmpdir(), 'tukaka-icons-'));

try {
  // 1) SVG → 1024 px şeffaf PNG.
  const master = path.join(resources, 'icon.png');
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    '--window-size=1024,1024',
    `--user-data-dir=${path.join(work, 'chrome')}`,
    `--screenshot=${master}`,
    pathToFileURL(source).href,
  ], { stdio: 'ignore' });

  const resized = (size) => {
    const file = path.join(work, `icon-${size}.png`);
    execFileSync('sips', ['-z', String(size), String(size), master, '--out', file], { stdio: 'ignore' });
    return file;
  };

  // 2) macOS .icns (iconutil, standart iconset adlandırması).
  const iconset = path.join(work, 'icon.iconset');
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), readFileSync(resized(size)));
    writeFileSync(path.join(iconset, `icon_${size}x${size}@2x.png`), readFileSync(resized(size * 2)));
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(resources, 'icon.icns')]);

  // 3) Windows .ico: PNG sıkıştırmalı girdiler (Vista+ destekler).
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => readFileSync(resized(size)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // ayrılmış
  header.writeUInt16LE(1, 2); // tür: ikon
  header.writeUInt16LE(sizes.length, 4);

  let offset = 6 + 16 * sizes.length;
  const directory = sizes.map((size, index) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // genişlik (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // yükseklik
    entry.writeUInt8(0, 2); // palet
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4); // renk düzlemi
    entry.writeUInt16LE(32, 6); // bit derinliği
    entry.writeUInt32LE(images[index].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += images[index].length;
    return entry;
  });

  writeFileSync(path.join(resources, 'icon.ico'), Buffer.concat([header, ...directory, ...images]));

  // 4) Web favicon: aynı çizim, kenar boşluğu ve gölgesi olmadan.
  const favicon = readFileSync(source, 'utf8')
    .replace(/<!--[\s\S]*?-->\s*/, '')
    .replace('viewBox="0 0 1024 1024" width="1024" height="1024"', 'viewBox="100 100 824 824"')
    .replace(/ filter="url\(#shadow\)"/, '');
  writeFileSync(path.join(webPublic, 'favicon.svg'), favicon);

  console.log('Icons written to', path.relative(process.cwd(), resources), 'and apps/web/public/favicon.svg');
} finally {
  rmSync(work, { recursive: true, force: true });
}
