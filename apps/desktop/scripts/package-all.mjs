#!/usr/bin/env node
/**
 * `pnpm package:all`: bu makinede üretilebilen tüm masaüstü paketleri.
 *
 *   macOS'ta:          macOS (bu makinenin mimarisi) + Windows x64
 *   Windows / Linux'ta: yalnızca Windows x64. macOS paketi (dmg/.app) yalnızca
 *                      macOS'ta oluşturulabilir (electron-builder kısıtı); bu
 *                      adım bir uyarıyla atlanır.
 *
 * Ek argümanlar (ör. --no-jre) her adıma aynen iletilir.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'package.mjs');
const extraArgs = process.argv.slice(2);

const run = (args) =>
  execFileSync(process.execPath, [packageScript, ...args, ...extraArgs], { stdio: 'inherit' });

try {
  if (process.platform === 'darwin') {
    run(['--clean', '--mac']);
    // Web/servis derlemesi macOS adımında yapıldı.
    run(['--win', '--x64', '--skip-build']);
  } else {
    console.warn(
      '\n⚠ Skipping the macOS package: it can only be built on macOS ' +
        '(https://electron.build/multi-platform-build).\n' +
        '  Run `pnpm package:mac` (or `pnpm package:all`) on a Mac to produce it.\n',
    );
    run(['--clean', '--win', '--x64']);
  }
} catch {
  // package.mjs hatayı zaten yazdırdı.
  process.exit(1);
}
