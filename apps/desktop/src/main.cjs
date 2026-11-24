
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  utilityProcess,
} = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

app.setName('TUKAKA Database Studio');

// Test ve taşınabilir kurulumlar için: uygulama verisini (Chromium profili ve
// studio.sqlite) ayrı bir klasöre yönlendirir.
if (process.env.TUKAKA_USER_DATA_DIR) {
  const dataDir = path.resolve(process.env.TUKAKA_USER_DATA_DIR);
  app.setPath('userData', dataDir);
  process.env.TUKAKA_DATA_DIR ??= dataDir;
}

/**
 * Üretim modu: paketleme betiği `service/` ve `renderer/` klasörlerini bu
 * dosyanın yanına koyar. Geliştirmede bunlar yoktur; servis `pnpm` ile, arayüz
 * Vite dev server'dan çalışır.
 */
const BUNDLED_SERVICE = path.join(__dirname, 'service', 'main.cjs');
const RENDERER_DIR = path.join(__dirname, 'renderer');
const isProduction = fs.existsSync(BUNDLED_SERVICE);

const projectRoot = path.resolve(__dirname, '../../..');
const DEV_SERVICE_PORT = 4317;
const DEV_WEB_URL = 'http://127.0.0.1:5173';

/** Üretimde arayüz bu özel protokolden yüklenir (file:// yerine). */
const APP_SCHEME = 'app';
const APP_HOST = 'tukaka';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const SERVICE_START_TIMEOUT_MS = 60_000;

// Her açılışta yeni bir oturum token'ı üretilir. Local service yalnızca bu
// token'ı taşıyan istekleri kabul eder; arayüz token'ı preload üzerinden alır.
const sessionToken = crypto.randomBytes(32).toString('hex');

let mainWindow = null;
let serviceProcess = null;
let serviceUrl = null;
let quitting = false;

// `app://` standart ve güvenli bir şema olmalı: fetch, CORS ve localStorage
// bu sayede http(s) gibi davranır. `app.ready` öncesinde kaydedilmelidir.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

// ---------------------------------------------------------------------------
// Local service
// ---------------------------------------------------------------------------

/**
 * IBM i (AS400) desteği için paketle gelen Java köprüsü ve gömülü JRE.
 * Gömülü JRE yoksa servis JAVA_HOME / PATH'teki Java'yı kullanır.
 */
function javaEnvironment() {
  const env = {};
  const javaDir = path.join(process.resourcesPath, 'java');
  const jreDir = path.join(process.resourcesPath, 'jre');

  if (fs.existsSync(javaDir)) env.TUKAKA_JAVA_DIR = javaDir;
  if (fs.existsSync(jreDir)) env.TUKAKA_JAVA_HOME = jreDir;

  return env;
}

/**
 * Üretim: paketlenmiş servis Electron'un kendi Node.js'i ile `utilityProcess`
 * içinde çalışır, boş bir port seçer ve hazır olunca portu mesajla bildirir.
 */
function startBundledService() {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(BUNDLED_SERVICE, [], {
      serviceName: 'TUKAKA Local Service',
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        LOCAL_SERVICE_PORT: '0',
        TUKAKA_SESSION_TOKEN: sessionToken,
        TUKAKA_ALLOWED_ORIGINS: APP_ORIGIN,
        ...javaEnvironment(),
      },
    });

    serviceProcess = child;

    const timer = setTimeout(() => {
      reject(new Error('TUKAKA Local Service did not start in time.'));
    }, SERVICE_START_TIMEOUT_MS);

    child.stdout?.on('data', (data) => process.stdout.write(`[Local Service] ${data}`));
    child.stderr?.on('data', (data) => process.stderr.write(`[Local Service] ${data}`));

    child.on('message', (message) => {
      if (message?.type === 'ready') {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${message.port}`);
      } else if (message?.type === 'error') {
        clearTimeout(timer);
        reject(new Error(message.message));
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      serviceProcess = null;
      reject(new Error(`TUKAKA Local Service exited with code ${code}.`));
      handleServiceExit(code);
    });
  });
}

/**
 * Geliştirme: servis `nest start --watch` ile sabit portta çalışır; böylece
 * tarayıcıdan da aynı servise erişilebilir.
 */
async function startDevService() {
  console.log('Starting TUKAKA Local Service (development)...');

  serviceProcess = spawn('pnpm', ['--filter', 'local-service', 'start:dev'], {
    cwd: projectRoot,
    shell: process.platform === 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LOCAL_SERVICE_PORT: String(DEV_SERVICE_PORT),
      TUKAKA_SESSION_TOKEN: sessionToken,
    },
  });

  serviceProcess.stdout.on('data', (data) => process.stdout.write(`[Local Service] ${data}`));
  serviceProcess.stderr.on('data', (data) => process.stderr.write(`[Local Service] ${data}`));
  serviceProcess.on('error', (error) => console.error('Local Service process error:', error));
  serviceProcess.on('exit', (code) => {
    serviceProcess = null;
    handleServiceExit(code);
  });

  const url = `http://127.0.0.1:${DEV_SERVICE_PORT}`;
  const deadline = Date.now() + SERVICE_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return url;
    } catch {
      // Servis henüz başlamamış olabilir.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('TUKAKA Local Service could not be started within 60 seconds.');
}

function handleServiceExit(code) {
  console.log(`Local Service exited with code: ${code}`);

  // Uygulama çalışırken servis beklenmedik şekilde kapandıysa kullanıcıyı uyar.
  if (!quitting && serviceUrl) {
    dialog.showErrorBox(
      'TUKAKA Local Service stopped',
      'The local database service stopped unexpectedly. The application will now close.',
    );
    app.quit();
  }
}

function stopLocalService() {
  if (!serviceProcess) return;

  console.log('Stopping TUKAKA Local Service...');
  serviceProcess.kill();
  serviceProcess = null;
}

// ---------------------------------------------------------------------------
// Arayüz
// ---------------------------------------------------------------------------

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // CodeMirror stilleri çalışma anında ekler.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  'connect-src http://127.0.0.1:*',
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * `app://tukaka/...` isteklerini `renderer/` klasöründen karşılar. Klasör
 * dışına çıkan yollar reddedilir; bilinmeyen yollar index.html'e düşer.
 */
function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const { host, pathname } = new URL(request.url);

    if (host !== APP_HOST) {
      return new Response('Not found', { status: 404 });
    }

    const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
    let filePath = path.resolve(RENDERER_DIR, relative || 'index.html');

    if (!filePath.startsWith(RENDERER_DIR + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(RENDERER_DIR, 'index.html');
    }

    const response = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(response.headers);

    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  });
}

// ---------------------------------------------------------------------------
// Dosya seçici (arayüzden IPC ile)
// ---------------------------------------------------------------------------

const FILE_DIALOGS = {
  sqlite: {
    kind: 'open',
    options: {
      title: 'Open SQLite database',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite databases', extensions: ['sqlite', 'sqlite3', 'db', 'db3', 's3db'] },
        { name: 'All files', extensions: ['*'] },
      ],
    },
  },
  'sqlite-new': {
    kind: 'save',
    options: {
      title: 'Create SQLite database',
      defaultPath: 'database.sqlite',
      buttonLabel: 'Create',
      filters: [{ name: 'SQLite databases', extensions: ['sqlite', 'db'] }],
    },
  },
  'ssh-key': {
    kind: 'open',
    options: {
      title: 'Choose SSH private key',
      defaultPath: path.join(app.getPath('home'), '.ssh'),
      properties: ['openFile', 'showHiddenFiles'],
    },
  },
};

ipcMain.handle('tukaka:select-file', async (event, kind) => {
  // Yalnızca uygulamanın kendi sayfası dosya penceresi açabilir.
  if (!event.senderFrame || !isAllowedNavigation(event.senderFrame.url)) {
    throw new Error('File dialogs are not allowed from this page.');
  }

  const spec = FILE_DIALOGS[kind];

  if (!spec) {
    throw new Error(`Unknown file dialog: ${kind}`);
  }

  const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;

  if (spec.kind === 'save') {
    const result = await dialog.showSaveDialog(window, spec.options);

    if (result.canceled || !result.filePath) return null;

    // Boş bir dosya geçerli (boş) bir SQLite veritabanıdır.
    if (!fs.existsSync(result.filePath)) {
      fs.closeSync(fs.openSync(result.filePath, 'a'));
    }

    return result.filePath;
  }

  const result = await dialog.showOpenDialog(window, spec.options);

  return result.canceled ? null : (result.filePaths[0] ?? null);
});

function isAllowedNavigation(url) {
  return isProduction ? url.startsWith(`${APP_ORIGIN}/`) : url.startsWith(DEV_WEB_URL);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#111318',
    title: 'TUKAKA Database Studio',
    show: false,

    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--tukaka-session-token=${sessionToken}`,
        `--tukaka-service-url=${serviceUrl}`,
      ],
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Harici bağlantılar varsayılan tarayıcıda açılır; yeni pencere açılmaz.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
    }
  });

  if (isProduction) {
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  } else {
    void mainWindow.loadURL(DEV_WEB_URL);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Uygulama yaşam döngüsü
// ---------------------------------------------------------------------------

// Aynı anda tek örnek: ikinci açılış mevcut pencereyi öne getirir.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      if (isProduction) {
        registerAppProtocol();
      }

      serviceUrl = isProduction
        ? await startBundledService()
        : await startDevService();

      createWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    } catch (error) {
      console.error(error);
      dialog.showErrorBox('TUKAKA Startup Error', error.message);
      quitting = true;
      stopLocalService();
      app.quit();
    }
  });
}

app.on('before-quit', () => {
  quitting = true;
  stopLocalService();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
