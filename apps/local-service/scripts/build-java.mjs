#!/usr/bin/env node
/**
 * IBM i (AS400) desteği için Java bileşenlerini hazırlar:
 *
 *   1. JTOpen (jt400.jar) JDBC sürücüsünü Maven Central'dan indirir ve SHA-1
 *      özetini doğrular (java/lib/).
 *   2. JDBC köprüsünü derleyip java/dist/tukaka-jdbc-bridge.jar üretir
 *      (JDK gerekir; çıktı Java 11+ ile çalışır).
 *
 * Kullanım:
 *   node scripts/build-java.mjs           # sürücü + köprü
 *   node scripts/build-java.mjs --test    # ayrıca testler için sqlite-jdbc
 *
 * JDK şu sırayla aranır: JAVA_HOME, macOS java_home, PATH.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const javaDir = path.join(serviceDir, 'java');
const libDir = path.join(javaDir, 'lib');
const testLibDir = path.join(libDir, 'test');
const distDir = path.join(javaDir, 'dist');
const sourceDir = path.join(javaDir, 'src');

const args = new Set(process.argv.slice(2));

/** Sürüm sabitlenir; güncellemek için burayı değiştirin. */
const DEPENDENCIES = [
  { group: 'net.sf.jt400', artifact: 'jt400', version: '21.0.7', dir: libDir, file: 'jt400.jar' },
];

const TEST_DEPENDENCIES = [
  { group: 'org.xerial', artifact: 'sqlite-jdbc', version: '3.54.1.0', dir: testLibDir, file: 'sqlite-jdbc.jar' },
];

const log = (message) => console.log(`[build-java] ${message}`);

async function fetchVerified({ group, artifact, version, dir, file }) {
  const target = path.join(dir, file);
  const base = `https://repo1.maven.org/maven2/${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}.jar`;

  const response = await fetch(`${base}.sha1`);
  if (!response.ok) throw new Error(`Checksum download failed for ${artifact}: ${response.status}`);
  const expected = (await response.text()).trim().split(/\s+/)[0].toLowerCase();

  const sha1 = (buffer) => createHash('sha1').update(buffer).digest('hex');

  if (existsSync(target) && sha1(readFileSync(target)) === expected) {
    log(`${artifact} ${version} already present`);
    return;
  }

  log(`downloading ${artifact} ${version}`);
  const jar = await fetch(base);
  if (!jar.ok) throw new Error(`Download failed for ${artifact}: ${jar.status}`);
  const buffer = Buffer.from(await jar.arrayBuffer());

  if (sha1(buffer) !== expected) {
    throw new Error(`Checksum mismatch for ${artifact} ${version}; refusing to use it.`);
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(target, buffer);
  log(`${artifact} ${version} verified (sha1 ${expected})`);
}

function findJdk() {
  const candidates = [];

  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);

  if (process.platform === 'darwin') {
    try {
      candidates.push(execFileSync('/usr/libexec/java_home', ['-v', '11+'], { encoding: 'utf8' }).trim());
    } catch {
      // java_home bulunamadı.
    }
  }

  const exe = process.platform === 'win32' ? '.exe' : '';

  for (const home of candidates) {
    const javac = path.join(home, 'bin', `javac${exe}`);
    if (existsSync(javac)) return { javac, jar: path.join(home, 'bin', `jar${exe}`) };
  }

  // PATH'te olabilir.
  try {
    execFileSync(`javac${exe}`, ['-version'], { stdio: 'ignore' });
    return { javac: `javac${exe}`, jar: `jar${exe}` };
  } catch {
    return null;
  }
}

function listSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return entry.name.endsWith('.java') ? [full] : [];
  });
}

function compileBridge() {
  const jdk = findJdk();

  if (!jdk) {
    log('JDK not found (set JAVA_HOME). Skipping bridge compilation; IBM i connections will be unavailable.');
    return false;
  }

  const classes = path.join(distDir, 'classes');
  rmSync(classes, { recursive: true, force: true });
  mkdirSync(classes, { recursive: true });

  execFileSync(
    jdk.javac,
    ['--release', '11', '-encoding', 'UTF-8', '-d', classes, ...listSources(sourceDir)],
    { stdio: 'inherit' },
  );

  const output = path.join(distDir, 'tukaka-jdbc-bridge.jar');
  execFileSync(jdk.jar, ['--create', '--file', output, '-C', classes, '.'], { stdio: 'inherit' });
  rmSync(classes, { recursive: true, force: true });

  log(`bridge built: ${path.relative(serviceDir, output)}`);
  return true;
}

const dependencies = [...DEPENDENCIES, ...(args.has('--test') ? TEST_DEPENDENCIES : [])];

for (const dependency of dependencies) {
  await fetchVerified(dependency);
}

compileBridge();
