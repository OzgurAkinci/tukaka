
const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

app.setName('TUKAKA Database Studio');

const projectRoot = path.resolve(__dirname, '../../..');

const LOCAL_SERVICE_URL = 'http://127.0.0.1:4317';
const WEB_URL = 'http://127.0.0.1:5173';

let mainWindow = null;
let localServiceProcess = null;

// Her açılışta yeni bir oturum token'ı üretilir. Local service yalnızca bu
// token'ı taşıyan istekleri kabul eder; arayüz token'ı preload üzerinden alır.
const sessionToken = crypto.randomBytes(32).toString('hex');

function startLocalService() {
  console.log('Starting TUKAKA Local Service...');

  const isWindows = process.platform === 'win32';

  localServiceProcess = spawn(
    'pnpm',
    ['--filter', 'local-service', 'start:dev'],
    {
      cwd: projectRoot,
      shell: isWindows,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TUKAKA_SESSION_TOKEN: sessionToken,
      },
    },
  );

  localServiceProcess.stdout.on('data', (data) => {
    console.log(`[Local Service] ${data}`);
  });

  localServiceProcess.stderr.on('data', (data) => {
    console.error(`[Local Service] ${data}`);
  });

  localServiceProcess.on('error', (error) => {
    console.error('Local Service process error:', error);
  });

  localServiceProcess.on('exit', (code) => {
    console.log(`Local Service exited with code: ${code}`);
    localServiceProcess = null;
  });
}

async function waitForLocalService() {
  const maxAttempts = 60;
  const delay = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${LOCAL_SERVICE_URL}/health`);

      if (response.ok) {
        console.log('Local Service is ready.');
        return;
      }
    } catch {
      // Servis henüz başlamamış olabilir.
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error(
    'TUKAKA Local Service could not be started within 60 seconds.',
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#111318',
    title: 'TUKAKA Database Studio',

    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--tukaka-session-token=${sessionToken}`],
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(
      path.join(__dirname, '../../web/dist/index.html'),
    );
  } else {
    mainWindow.loadURL(WEB_URL);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function stopLocalService() {
  if (localServiceProcess && !localServiceProcess.killed) {
    console.log('Stopping TUKAKA Local Service...');

    localServiceProcess.kill();
    localServiceProcess = null;
  }
}

app.whenReady().then(async () => {
  try {
    startLocalService();

    await waitForLocalService();

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    console.error(error);

    dialog.showErrorBox(
      'TUKAKA Startup Error',
      error.message,
    );

    app.quit();
  }
});

app.on('before-quit', () => {
  stopLocalService();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
