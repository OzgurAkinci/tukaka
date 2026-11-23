#!/usr/bin/env node
/**
 * TUKAKA Database Studio masaüstü paketleme betiği.
 *
 * Kullanım (repo kökünden):
 *   pnpm package:desktop             # bu platform için yükleyici (dmg/zip, nsis, AppImage)
 *   pnpm package:desktop -- --dir    # yalnızca paketlenmemiş .app/klasör (hızlı test)
 *   pnpm package:desktop -- --stage  # yalnızca staging klasörünü hazırla
 *   ... --win | --mac | --linux      # hedef platform (varsayılan: bu makine)
 *   ... --x64 | --arm64              # hedef mimari (varsayılan: bu makine)
 *   ... --skip-build                 # web/servis derlemesini atla
 *
 * Adımlar:
 *   1. Web arayüzünü (Vite) ve servisi (tsc) derle.
 *   2. Servisi rolldown ile tek dosyada paketle. tsc çıktısı kullanılır çünkü
 *      Nest DI'ın ihtiyaç duyduğu decorator metadata'sı orada üretilmiştir.
 *   3. build/app altında yalnızca çalışma zamanı dosyalarını içeren bir staging
 *      klasörü oluştur; native modüller (better-sqlite3, keyring) buraya npm ile
 *      kurulur. Geliştirme node_modules'una dokunulmaz.
 *   4. electron-builder paketler. Native modüller N-API kullanır ve hazır
 *      binary'lerle gelir; Electron için yeniden derleme gerekmez (bu sayede
 *      macOS'ta Windows paketi de üretilebilir).
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '../..');
const webDir = path.join(repoRoot, 'apps/web');
const serviceDir = path.join(repoRoot, 'apps/local-service');
const stagingDir = path.join(desktopDir, 'build/app');

const args = new Set(process.argv.slice(2));
const require = createRequire(import.meta.url);

/** Servis paketine dahil edilmeyen, staging'e npm ile kurulan native modüller. */
const NATIVE_MODULES = ['better-sqlite3', '@napi-rs/keyring'];

/**
 * Nest ve sürücülerin yalnızca kurulu olduklarında `require` ettiği isteğe
 * bağlı paketler. Bulunamazlarsa çalışma anında sessizce atlanırlar.
 */
const OPTIONAL_MODULES = [
  /^@nestjs\/microservices(\/|$)/,
  /^@nestjs\/websockets(\/|$)/,
  /^@nestjs\/platform-socket\.io/,
  /^@fastify\//,
  /^pg-native$/,
  /^cloudflare:sockets$/,
  // ssh2: isteğe bağlı CPU algılama; yoksa saf JS'e düşer.
  /^cpu-features$/,
];

/**
 * Paketlenemeyen derlenmiş eklentiler (`*.node`). ssh2'nin `sshcrypto.node`
 * gibi isteğe bağlı eklentileri try/catch içinde yüklenir; bulunamazlarsa
 * kütüphane saf JavaScript uygulamasını kullanır.
 */
const isNativeAddon = (id) => id.endsWith('.node');

/** Hedef platform ve mimari (varsayılan: bu makine). */
const targetPlatform =
  args.has('--win') ? 'win32'
  : args.has('--linux') ? 'linux'
  : args.has('--mac') ? 'darwin'
  : process.platform;

const targetArch =
  args.has('--x64') ? 'x64'
  : args.has('--arm64') ? 'arm64'
  : process.arch;

const step = (message) => console.log(`\n\u001b[36m▸ ${message}\u001b[0m`);

function run(command, commandArgs, cwd = repoRoot) {
  execFileSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function bundleService() {
  const { build } = await import('rolldown');

  const patterns = [
    ...NATIVE_MODULES.map((name) => new RegExp(`^${name.replace('/', '\\/')}(\\/|$)`)),
    ...OPTIONAL_MODULES,
  ];

  const external = (id) => isNativeAddon(id) || patterns.some((pattern) => pattern.test(id));

  await build({
    input: path.join(serviceDir, 'dist/main.js'),
    platform: 'node',
    external,
    logLevel: 'warn',
    output: {
      file: path.join(stagingDir, 'service/main.cjs'),
      format: 'cjs',
      codeSplitting: false,
      // Nest sınıf adlarını (Logger bağlamları, hata mesajları) korumak için.
      minify: false,
    },
  });
}

function writeStagingPackageJson() {
  const rootPackage = readJson(path.join(repoRoot, 'package.json'));
  const servicePackage = readJson(path.join(serviceDir, 'package.json'));

  const dependencies = Object.fromEntries(
    NATIVE_MODULES.map((name) => {
      const installed = readJson(
        path.join(serviceDir, 'node_modules', name, 'package.json'),
      ).version;

      if (!servicePackage.dependencies[name]) {
        throw new Error(`${name} is not a dependency of local-service.`);
      }

      return [name, installed];
    }),
  );

  writeFileSync(
    path.join(stagingDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'tukaka-database-studio',
        productName: 'TUKAKA Database Studio',
        version: rootPackage.version,
        description: 'Desktop database client',
        author: 'TUKAKA',
        private: true,
        main: 'main.cjs',
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * better-sqlite3 tüm platformların binary'lerini içerir; yalnızca hedef
 * platformunkini bırak.
 */
function pruneForeignPrebuilds() {
  const prebuildDir = path.join(stagingDir, 'node_modules/better-sqlite3/prebuilds');
  const keep = `${targetPlatform}-${targetArch}.node`;

  if (!existsSync(path.join(prebuildDir, keep))) {
    throw new Error(`better-sqlite3 has no prebuilt binary for ${keep}.`);
  }

  for (const file of readdirSync(prebuildDir)) {
    if (file !== keep) {
      rmSync(path.join(prebuildDir, file));
    }
  }
}

async function main() {
  if (!args.has('--skip-build')) {
    step('Building web UI');
    run('pnpm', ['--filter', 'web', 'build']);

    step('Building local service');
    run('pnpm', ['--filter', 'local-service', 'build']);
  }

  step(`Preparing staging directory (${path.relative(repoRoot, stagingDir)})`);
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  cpSync(path.join(desktopDir, 'src/main.cjs'), path.join(stagingDir, 'main.cjs'));
  cpSync(path.join(desktopDir, 'src/preload.cjs'), path.join(stagingDir, 'preload.cjs'));
  cpSync(path.join(webDir, 'dist'), path.join(stagingDir, 'renderer'), {
    recursive: true,
  });

  step('Bundling local service');
  await bundleService();

  writeStagingPackageJson();

  step(`Installing native modules into staging (${targetPlatform}-${targetArch})`);
  // Kurulum betikleri atlanır; native modüller hazır N-API binary'leriyle gelir.
  // --os/--cpu, hedef platformun isteğe bağlı native paketlerini (ör.
  // @napi-rs/keyring-win32-x64-msvc) seçer; böylece çapraz paketleme mümkün olur.
  run(
    'npm',
    [
      'install',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      `--os=${targetPlatform}`,
      `--cpu=${targetArch}`,
    ],
    stagingDir,
  );

  pruneForeignPrebuilds();

  if (args.has('--stage')) {
    console.log(`\nStaging ready: ${stagingDir}`);
    return;
  }

  step('Packaging with electron-builder');
  const { Arch, build, Platform } = require('electron-builder');
  const config = readJson(path.join(desktopDir, 'electron-builder.json'));
  delete config.$schema;

  config.electronVersion = require('electron/package.json').version;
  config.extraMetadata = { main: 'main.cjs' };

  const platform = {
    win32: Platform.WINDOWS,
    linux: Platform.LINUX,
    darwin: Platform.MAC,
  }[targetPlatform];

  const result = await build({
    projectDir: desktopDir,
    config,
    targets: platform.createTarget(
      args.has('--dir') ? ['dir'] : undefined,
      Arch[targetArch],
    ),
    publish: 'never',
  });

  console.log('\nArtifacts:');
  for (const file of result) {
    console.log(`  ${path.relative(repoRoot, file)}`);
  }

  console.log(`\nOutput directory: ${path.relative(repoRoot, path.join(desktopDir, 'release'))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
