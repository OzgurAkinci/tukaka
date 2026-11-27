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
 *   ... --clean                      # önce release/ klasörünü temizle (eski sürümler kalmasın)
 *   ... --no-jre                     # Java çalışma ortamını gömme (IBM i için kullanıcının Java'sı gerekir)
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
import { createHash } from 'node:crypto';
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

const javaBuildDir = path.join(desktopDir, 'build/java');
const jreBuildDir = path.join(desktopDir, 'build/jre');
const cacheDir = path.join(desktopDir, 'build/cache');

/**
 * IBM i (AS400) için Java köprüsü ve jt400 sürücüsü. Köprü derlemesi JDK ister;
 * JDK yoksa paket IBM i desteği olmadan üretilir (uyarı verilir).
 */
function prepareJava() {
  step('Preparing IBM i (AS400) JDBC bridge');
  run('node', [path.join(serviceDir, 'scripts/build-java.mjs')]);

  const bridge = path.join(serviceDir, 'java/dist/tukaka-jdbc-bridge.jar');
  const driver = path.join(serviceDir, 'java/lib/jt400.jar');

  rmSync(javaBuildDir, { recursive: true, force: true });

  if (!existsSync(bridge) || !existsSync(driver)) {
    console.warn('  ! JDBC bridge not available (no JDK); IBM i connections will not work in this build.');
    return false;
  }

  mkdirSync(path.join(javaBuildDir, 'lib'), { recursive: true });
  cpSync(bridge, path.join(javaBuildDir, 'tukaka-jdbc-bridge.jar'));
  cpSync(driver, path.join(javaBuildDir, 'lib/jt400.jar'));
  return true;
}

/**
 * Hedef platform için Eclipse Temurin 21 JRE'yi indirir (SHA-256 doğrulamalı,
 * önbellekli) ve build/jre altına açar; böylece kullanıcıda Java gerekmez.
 */
async function prepareJre() {
  step(`Preparing Java runtime (${targetPlatform}-${targetArch})`);

  const os = { darwin: 'mac', win32: 'windows', linux: 'linux' }[targetPlatform];
  const architecture = { arm64: 'aarch64', x64: 'x64' }[targetArch];
  const api = `https://api.adoptium.net/v3/assets/latest/21/hotspot?os=${os}&architecture=${architecture}&image_type=jre&vendor=eclipse`;

  const assets = await (await fetch(api)).json();
  const pkg = assets?.[0]?.binary?.package;

  if (!pkg?.link || !pkg?.checksum) {
    throw new Error(`No Temurin JRE found for ${os}/${architecture}.`);
  }

  mkdirSync(cacheDir, { recursive: true });
  const archive = path.join(cacheDir, pkg.name);
  const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

  if (!existsSync(archive) || sha256(archive) !== pkg.checksum) {
    console.log(`  downloading ${pkg.name} (${Math.round(pkg.size / 1_048_576)} MB)`);
    const response = await fetch(pkg.link);
    if (!response.ok) throw new Error(`JRE download failed: ${response.status}`);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));

    if (sha256(archive) !== pkg.checksum) {
      rmSync(archive, { force: true });
      throw new Error('JRE checksum mismatch; refusing to bundle it.');
    }
  } else {
    console.log(`  using cached ${pkg.name}`);
  }

  // Arşiv tek bir kök klasör içerir (ör. jdk-21.0.x+y-jre); içeriği build/jre'ye taşı.
  const extractDir = path.join(cacheDir, 'extract');
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  // Windows'ta sistemin bsdtar'ı (zip açabilir) kullanılır; PATH'te önce
  // Git Bash'in GNU tar'ı olabilir, o zip açamaz ve "C:" yolunu uzak sunucu sanar.
  const systemTar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const tar = process.platform === 'win32' && existsSync(systemTar) ? systemTar : 'tar';
  run(tar, ['-xf', archive, '-C', extractDir]);

  const [root] = readdirSync(extractDir).filter((name) => !name.startsWith('.'));
  // macOS arşivi bir .jdk paketi gibidir: Contents/Home altında.
  const home = existsSync(path.join(extractDir, root, 'Contents/Home'))
    ? path.join(extractDir, root, 'Contents/Home')
    : path.join(extractDir, root);

  rmSync(jreBuildDir, { recursive: true, force: true });
  cpSync(home, jreBuildDir, { recursive: true, verbatimSymlinks: true });
  rmSync(extractDir, { recursive: true, force: true });

  // CDS arşivleri (classes*.jsa) yalnızca açılışı hızlandırır; macOS codesign
  // bunları imzalayamaz. JVM bunlar olmadan da çalışır.
  const serverDir = path.join(jreBuildDir, 'lib/server');
  if (existsSync(serverDir)) {
    for (const file of readdirSync(serverDir)) {
      if (file.endsWith('.jsa')) rmSync(path.join(serverDir, file));
    }
  }

  const exe = targetPlatform === 'win32' ? 'java.exe' : 'java';
  if (!existsSync(path.join(jreBuildDir, 'bin', exe))) {
    throw new Error('Bundled JRE is missing bin/java.');
  }
}

async function main() {
  if (args.has('--clean')) {
    step('Cleaning previous release artifacts');
    rmSync(path.join(desktopDir, 'release'), { recursive: true, force: true });
  }

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

  const javaReady = prepareJava();
  const bundleJre = javaReady && !args.has('--no-jre');

  if (bundleJre) {
    await prepareJre();
  } else {
    rmSync(jreBuildDir, { recursive: true, force: true });
  }

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
  // Java dosyaları asar dışında olmalı (JVM asar içinden okuyamaz).
  config.extraResources = [
    ...(javaReady ? [{ from: 'build/java', to: 'java' }] : []),
    ...(bundleJre ? [{ from: 'build/jre', to: 'jre' }] : []),
  ];

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
