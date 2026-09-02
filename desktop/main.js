'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
  Tray,
} = require('electron');
const { createTrayMenu, installApplicationMenu } = require('./menu');

const APP_NAME = 'Listenfold';
const LOOPBACK_HOST = '127.0.0.1';
const NORMAL_MIN_SIZE = { width: 900, height: 640 };
const MINI_SIZE = { width: 520, height: process.platform === 'darwin' ? 190 : 172 };
const MINI_MIN_SIZE = { width: 430, height: 156 };
const BACKEND_START_TIMEOUT_MS = 25_000;
const BACKEND_START_ATTEMPTS = 3;

const DESKTOP_SHELL_CSS = `
  html.desktop-shell .topbar {
    -webkit-app-region: drag;
  }

  html.desktop-darwin .topbar {
    padding-left: 84px;
  }

  html.desktop-shell button,
  html.desktop-shell input,
  html.desktop-shell a,
  html.desktop-shell [role="button"],
  html.desktop-shell .brand,
  html.desktop-shell .now-playing-art,
  html.desktop-shell .now-playing-text {
    -webkit-app-region: no-drag;
  }

  html.desktop-mini-player .app-layout {
    display: block !important;
    height: 100vh !important;
  }

  html.desktop-mini-player .app-layout > .topbar,
  html.desktop-mini-player .app-layout > .workspace,
  html.desktop-mini-player .lyrics-drawer,
  html.desktop-mini-player .fullscreen-cinema,
  html.desktop-mini-player .dock-flyout,
  html.desktop-mini-player .settings-popover,
  html.desktop-mini-player .dialog-scrim,
  html.desktop-mini-player .settings-overlay,
  html.desktop-mini-player .modal-overlay {
    display: none !important;
  }

  html.desktop-mini-player .player {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    grid-template-rows: minmax(64px, 1fr) 42px !important;
    column-gap: 14px !important;
    padding: 16px 16px 10px !important;
    border: 0 !important;
    -webkit-app-region: drag;
  }

  html.desktop-darwin.desktop-mini-player .player {
    padding-top: 34px !important;
  }

  html.desktop-mini-player .player-left {
    position: relative !important;
    grid-column: 1 !important;
    grid-row: 1 !important;
    width: 100% !important;
    max-width: none !important;
    min-width: 0 !important;
  }

  html.desktop-mini-player .player-center {
    position: static !important;
    grid-column: 1 / -1 !important;
    grid-row: 2 !important;
    width: 100% !important;
    max-width: none !important;
    transform: none !important;
    flex-direction: row !important;
    gap: 12px !important;
  }

  html.desktop-mini-player .player-center .playback-controls {
    flex: 0 0 auto !important;
  }

  html.desktop-mini-player .player-center .scrub-container {
    flex: 1 1 auto !important;
    width: auto !important;
    min-width: 100px !important;
  }

  html.desktop-mini-player .player-right {
    grid-column: 2 !important;
    grid-row: 1 !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    margin: 0 !important;
  }

  html.desktop-mini-player .player-right > :not(.volume-widget),
  html.desktop-mini-player #shuffleBtn,
  html.desktop-mini-player #repeatBtn,
  html.desktop-mini-player .jump-btn,
  html.desktop-mini-player #dockTrackMoreBtn {
    display: none !important;
  }

  html.desktop-mini-player .volume-track-wrap {
    width: 68px !important;
  }

  html.desktop-mini-player .now-playing-art {
    width: 56px !important;
    height: 56px !important;
  }
`;

let mainWindow = null;
let tray = null;
let backendProcess = null;
let backendOrigin = null;
let backendReady = false;
let isQuitting = false;
let isMiniPlayer = false;
let normalWindowState = null;
let backendLogTail = '';
let currentPlaybackState = { playing: false, title: '', artist: '' };

function resolveBackendRoot() {
  const originalFs = (() => {
    try { return require('original-fs'); } catch { return fs; }
  })();

  const isRealDirectory = dirPath => {
    try {
      return Boolean(dirPath && originalFs.statSync(dirPath).isDirectory());
    } catch {
      return false;
    }
  };

  const rawCandidates = [
    process.env.LISTENFOLD_APP_ROOT,
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked'),
    process.resourcesPath && path.join(process.resourcesPath, 'app'),
    process.resourcesPath && path.join(process.resourcesPath, 'backend'),
    path.resolve(__dirname, '..'),
    app.getAppPath(),
  ].filter(Boolean);

  const candidates = [];
  for (const c of rawCandidates) {
    if (typeof c === 'string' && c.endsWith('.asar')) {
      candidates.push(`${c}.unpacked`);
    } else {
      candidates.push(c);
    }
  }

  const root = candidates.find(candidate => (
    isRealDirectory(candidate)
    && fs.existsSync(path.join(candidate, 'server.js'))
    && fs.existsSync(path.join(candidate, 'public', 'index.html'))
  ));

  if (root) return root;

  const devRoot = path.resolve(__dirname, '..');
  if (isRealDirectory(devRoot) && fs.existsSync(path.join(devRoot, 'server.js'))) {
    return devRoot;
  }

  throw new Error('Не найден backend Listenfold (server.js + public/index.html)');
}

function getWindowIconPath() {
  try {
    const root = resolveBackendRoot();
    const isWin = process.platform === 'win32';
    const candidates = [
      isWin && path.join(root, 'build', 'icon.ico'),
      isWin && path.join(root, 'public', 'icons', 'listenfold.ico'),
      path.join(root, 'build', 'icons', '256x256.png'),
      path.join(root, 'public', 'icons', 'listenfold-icon-48.png'),
      path.join(root, 'public', 'icons', 'listenfold-icon.png'),
    ].filter(Boolean);
    return candidates.find(p => fs.existsSync(p)) || undefined;
  } catch {
    return undefined;
  }
}

function resolveYtdlpBinary(root) {
  const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const candidates = [
    process.env.YTDLP_PATH,
    process.resourcesPath && path.join(process.resourcesPath, 'bin', binaryName),
    path.join(root, 'build', 'bin', binaryName),
  ].filter(Boolean);

  return candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || binaryName;
}

function migrateLegacyUserData(targetDir) {
  const marker = path.join(targetDir, '.listenfold-migration-v1');
  if (fs.existsSync(marker)) return;

  try {
    const appDataRoot = app.getPath('appData');
    const legacyDirs = ['SonicFlow', 'sonicflow']
      .map(name => path.join(appDataRoot, name))
      .filter(source => path.resolve(source) !== path.resolve(targetDir));

    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    const source = legacyDirs.find(candidate => {
      try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
    });

    if (source) {
      for (const entry of fs.readdirSync(source)) {
        const destination = path.join(targetDir, entry);
        if (fs.existsSync(destination)) continue;
        fs.cpSync(path.join(source, entry), destination, { recursive: true, errorOnExist: false });
      }
    }

    fs.writeFileSync(marker, `${source ? 'migrated' : 'clean'}\n`, { mode: 0o600 });
  } catch (error) {
    console.warn('Legacy data migration skipped:', error.message);
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const reservation = net.createServer();
    reservation.unref();
    reservation.once('error', reject);
    reservation.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true }, () => {
      const address = reservation.address();
      const port = typeof address === 'object' && address ? address.port : null;
      reservation.close(error => {
        if (error) reject(error);
        else if (!port) reject(new Error('Не удалось подобрать локальный порт'));
        else resolve(port);
      });
    });
  });
}

function probeBackend(port) {
  return new Promise(resolve => {
    const request = http.get({
      hostname: LOOPBACK_HOST,
      port,
      path: '/',
      headers: { 'User-Agent': `${APP_NAME}-Desktop` },
      timeout: 800,
    }, response => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

async function waitForBackend(port, child) {
  const deadline = Date.now() + BACKEND_START_TIMEOUT_MS;
  let delay = 80;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Backend завершился до запуска (${child.exitCode ?? child.signalCode})`);
    }
    if (await probeBackend(port)) return;
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(500, Math.round(delay * 1.35));
  }

  throw new Error('Backend не ответил за отведённое время');
}

function appendBackendLog(chunk, stream) {
  const text = String(chunk);
  backendLogTail = `${backendLogTail}${text}`.slice(-8_000);
  const logger = stream === 'stderr' ? console.error : console.info;
  for (const line of text.trimEnd().split('\n')) {
    if (line) logger(`[backend] ${line}`);
  }
}

function signalBackend(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else if (child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if (error.code !== 'ESRCH') console.error('Backend shutdown error:', error.message);
  }
}

function terminateBackend(child = backendProcess) {
  if (!child) return;
  signalBackend(child, 'SIGTERM');
  const killTimer = setTimeout(() => signalBackend(child, 'SIGKILL'), 1_800);
  killTimer.unref();
}

async function spawnBackendOnce(root, port) {
  backendLogTail = '';
  const serverPath = path.join(root, 'server.js');
  let userDataDir;
  try {
    userDataDir = app.getPath('userData');
  } catch {
    userDataDir = path.join(root, '.cache');
  }
  migrateLegacyUserData(userDataDir);
  let spawnCwd = root;
  try {
    if (!fs.statSync(spawnCwd).isDirectory()) {
      spawnCwd = path.dirname(spawnCwd);
    }
  } catch {
    spawnCwd = process.resourcesPath || app.getPath('userData') || require('os').tmpdir();
  }

  const candidateNodePaths = [
    process.env.NODE_PATH,
    path.join(root, 'node_modules'),
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules'),
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar', 'node_modules'),
    app.getAppPath && path.join(app.getAppPath(), 'node_modules'),
    path.resolve(__dirname, '..', 'node_modules'),
  ].filter(Boolean);

  const child = spawn(process.execPath, [serverPath], {
    cwd: spawnCwd,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: candidateNodePaths.join(path.delimiter),
      HOST: LOOPBACK_HOST,
      PORT: String(port),
      LISTENFOLD_DATA_DIR: userDataDir,
      YTDLP_PATH: resolveYtdlpBinary(root),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  backendProcess = child;
  let launchSucceeded = false;
  child.stdout.on('data', chunk => appendBackendLog(chunk, 'stdout'));
  child.stderr.on('data', chunk => appendBackendLog(chunk, 'stderr'));

  child.once('exit', (code, signal) => {
    const wasActiveBackend = backendProcess === child;
    if (wasActiveBackend) {
      backendProcess = null;
      backendReady = false;
    }
    if (!isQuitting && launchSucceeded && wasActiveBackend) {
      const reason = signal || `код ${code}`;
      dialog.showErrorBox(APP_NAME, `Локальный backend остановился (${reason}). Приложение будет закрыто.`);
      app.quit();
    }
  });

  const spawnError = new Promise((_resolve, reject) => {
    child.once('error', error => {
      backendLogTail = `${backendLogTail}\n${error.message}`.slice(-8_000);
      reject(error);
    });
  });

  await Promise.race([waitForBackend(port, child), spawnError]);
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`Backend завершился до запуска (${child.exitCode ?? child.signalCode})`);
  }
  backendReady = true;
  launchSucceeded = true;
}

async function startBackend() {
  const root = resolveBackendRoot();
  let lastError = null;

  for (let attempt = 1; attempt <= BACKEND_START_ATTEMPTS; attempt += 1) {
    const port = await findFreePort();
    try {
      await spawnBackendOnce(root, port);
      backendOrigin = `http://${LOOPBACK_HOST}:${port}`;
      return backendOrigin;
    } catch (error) {
      lastError = error;
      const failedChild = backendProcess;
      backendProcess = null;
      backendReady = false;
      terminateBackend(failedChild);
    }
  }

  const details = backendLogTail.trim().split('\n').slice(-6).join('\n');
  throw new Error(`${lastError?.message || 'Не удалось запустить backend'}${details ? `\n\n${details}` : ''}`);
}

function trustedIpcSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || !backendOrigin) return false;
  if (event.senderFrame && event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  try {
    return new URL(event.senderFrame?.url || event.sender.getURL()).origin === backendOrigin;
  } catch {
    return false;
  }
}

function requireTrustedIpc(event) {
  if (!trustedIpcSender(event)) throw new Error('IPC request rejected');
}

function safeExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 4_096) return null;
  try {
    const url = new URL(rawUrl, backendOrigin || undefined);
    if (url.username || url.password) return null;
    if (url.origin === backendOrigin) return url.href;
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function openExternal(rawUrl) {
  const url = safeExternalUrl(rawUrl);
  if (!url) return false;
  void shell.openExternal(url).catch(error => console.error('External URL error:', error.message));
  return true;
}

function currentWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return {
    focused: mainWindow.isFocused(),
    fullscreen: mainWindow.isFullScreen(),
    maximized: mainWindow.isMaximized(),
    miniPlayer: isMiniPlayer,
    visible: mainWindow.isVisible(),
  };
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:window-state', currentWindowState());
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  rebuildMenus();
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showWindow();
  rebuildMenus();
}

function setMiniPlayer(enabled) {
  if (!mainWindow || mainWindow.isDestroyed() || enabled === isMiniPlayer) return isMiniPlayer;

  if (enabled) {
    normalWindowState = {
      bounds: mainWindow.getBounds(),
      fullscreen: mainWindow.isFullScreen(),
      maximized: mainWindow.isMaximized(),
    };
    if (normalWindowState.fullscreen) mainWindow.setFullScreen(false);
    if (normalWindowState.maximized) mainWindow.unmaximize();

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { workArea } = display;
    mainWindow.setMinimumSize(MINI_MIN_SIZE.width, MINI_MIN_SIZE.height);
    mainWindow.setBounds({
      x: workArea.x + workArea.width - MINI_SIZE.width - 24,
      y: workArea.y + 24,
      width: MINI_SIZE.width,
      height: MINI_SIZE.height,
    }, true);
    mainWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'normal');
    mainWindow.setFullScreenable(false);
    if (process.platform === 'darwin') {
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setFullScreenable(true);
    if (process.platform === 'darwin') mainWindow.setVisibleOnAllWorkspaces(false);
    mainWindow.setMinimumSize(NORMAL_MIN_SIZE.width, NORMAL_MIN_SIZE.height);
    if (normalWindowState?.bounds) mainWindow.setBounds(normalWindowState.bounds, true);
    if (normalWindowState?.maximized) mainWindow.maximize();
    if (normalWindowState?.fullscreen) mainWindow.setFullScreen(true);
    normalWindowState = null;
  }

  isMiniPlayer = enabled;
  mainWindow.webContents.send('desktop:mini-player-changed', enabled);
  sendWindowState();
  showWindow();
  rebuildMenus();
  return isMiniPlayer;
}

function toggleMiniPlayer() {
  return setMiniPlayer(!isMiniPlayer);
}

function sendMediaCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:media-command', command);
}

function installIpc() {
  const handle = (channel, handler) => {
    ipcMain.handle(channel, (event, ...args) => {
      requireTrustedIpc(event);
      return handler(...args);
    });
  };

  handle('desktop:window-minimize', () => mainWindow?.minimize());
  handle('desktop:window-toggle-maximize', () => {
    if (!mainWindow || isMiniPlayer) return currentWindowState();
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return currentWindowState();
  });
  handle('desktop:window-close', () => mainWindow?.close());
  handle('desktop:window-get-state', currentWindowState);
  handle('desktop:mini-player-toggle', toggleMiniPlayer);
  handle('desktop:mini-player-get-state', () => isMiniPlayer);
  handle('desktop:set-playback-state', state => {
    if (state && typeof state === 'object') {
      currentPlaybackState = {
        playing: Boolean(state.playing),
        title: String(state.title || '').trim(),
        artist: String(state.artist || '').trim(),
      };
      updateTrayTooltip();
      updateThumbarButtons();
    }
    return true;
  });
  handle('desktop:open-external', openExternal);
  handle('desktop:app-version', () => app.getVersion());
  handle('desktop:auth-login', service => openLoginWindow(service));
}

let loginWindow = null;
function openLoginWindow(service) {
  return new Promise(resolve => {
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.focus();
      return resolve({ ok: false, error: 'Login window already open' });
    }

    const isYandex = service === 'yandex';
    const loginUrl = isYandex
      ? 'https://passport.yandex.ru/auth?retpath=https%3A%2F%2Fmusic.yandex.ru'
      : 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com';

    loginWindow = new BrowserWindow({
      width: 720,
      height: 800,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
      modal: false,
      title: isYandex ? 'Вход в Яндекс Музыку' : 'Вход в YouTube Music',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    let finished = false;
    const checkCookies = async () => {
      if (finished || !loginWindow || loginWindow.isDestroyed()) return;
      try {
        const cookies = await loginWindow.webContents.session.cookies.get({});
        const hasYandexAuth = isYandex && cookies.some(c =>
          c.domain.includes('yandex') && (c.name === 'Session_id' || c.name === 'sessionid2' || c.name === 'yandex_login')
        );
        const hasYoutubeAuth = !isYandex && cookies.some(c =>
          (c.domain.includes('youtube') || c.domain.includes('google')) && (c.name === 'SAPISID' || c.name === '__Secure-3PAPISID' || c.name === 'SID' || c.name === 'LOGIN_INFO')
        );

        if (hasYandexAuth || hasYoutubeAuth) {
          finished = true;
          const netscapeLines = ['# Netscape HTTP Cookie File'];
          for (const c of cookies) {
            if (!c.domain.includes('yandex') && !c.domain.includes('youtube') && !c.domain.includes('google')) continue;
            const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
            const flag = 'TRUE';
            const path = c.path || '/';
            const secure = c.secure ? 'TRUE' : 'FALSE';
            const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
            netscapeLines.push(`${domain}\t${flag}\t${path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`);
          }
          const cookieText = netscapeLines.join('\n') + '\n';

          if (backendOrigin) {
            try {
              const url = new URL('/api/cookies/import', backendOrigin);
              const postData = JSON.stringify({ text: cookieText });
              const req = http.request(url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(postData),
                },
              }, res => {
                res.resume();
                if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
                resolve({ ok: true, service });
              });
              req.on('error', () => {
                if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
                resolve({ ok: true, service });
              });
              req.write(postData);
              req.end();
              return;
            } catch {}
          }

          if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
          resolve({ ok: true, service });
        }
      } catch (err) {
        console.error('Error checking login cookies:', err);
      }
    };

    loginWindow.webContents.on('did-navigate', checkCookies);
    loginWindow.webContents.on('did-navigate-in-page', checkCookies);
    loginWindow.webContents.on('did-finish-load', checkCookies);

    loginWindow.on('closed', () => {
      loginWindow = null;
      if (!finished) resolve({ ok: false, canceled: true });
    });

    void loginWindow.loadURL(loginUrl);
  });
}

function getMediaIcon(name) {
  const svgs = {
    previous: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#ffffff"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="4" x2="5" y2="20" stroke="#ffffff" stroke-width="2"/></svg>',
    play: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#ffffff"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    pause: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#ffffff"><rect x="5" y="4" width="4" height="16"/><rect x="15" y="4" width="4" height="16"/></svg>',
    next: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#ffffff"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="4" x2="19" y2="20" stroke="#ffffff" stroke-width="2"/></svg>',
  };
  const svg = svgs[name];
  if (!svg) return nativeImage.createEmpty();
  try {
    return nativeImage.createFromBuffer(Buffer.from(svg));
  } catch {
    return nativeImage.createEmpty();
  }
}

function updateThumbarButtons() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const isPlaying = Boolean(currentPlaybackState.playing);
    mainWindow.setThumbarButtons([
      {
        tooltip: 'Предыдущий трек',
        icon: getMediaIcon('previous'),
        click: () => sendMediaCommand('previous'),
      },
      {
        tooltip: isPlaying ? 'Пауза' : 'Воспроизведение',
        icon: getMediaIcon(isPlaying ? 'pause' : 'play'),
        click: () => sendMediaCommand('play-pause'),
      },
      {
        tooltip: 'Следующий трек',
        icon: getMediaIcon('next'),
        click: () => sendMediaCommand('next'),
      },
    ]);
  } catch {
    // Non-fatal
  }
}

function updateTrayTooltip() {
  if (!tray) return;
  const { playing, title, artist } = currentPlaybackState;
  if (title) {
    const status = playing ? '▶' : '⏸';
    const trackInfo = artist ? `${artist} — ${title}` : title;
    const tip = `${APP_NAME}: ${status} ${trackInfo}`;
    tray.setToolTip(tip.slice(0, 127));
  } else {
    tray.setToolTip(APP_NAME);
  }
}

function installNavigationGuards(window) {
  const guardNavigation = (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin === backendOrigin) return;
    } catch {
      // Invalid and non-web schemes are denied below.
    }
    event.preventDefault();
    openExternal(targetUrl);
  };

  window.webContents.on('will-navigate', guardNavigation);
  window.webContents.on('will-redirect', guardNavigation);
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  const mayWriteClipboard = (contents, permission, requestingOrigin) => {
    if (contents !== window.webContents || permission !== 'clipboard-sanitized-write') return false;
    try {
      return new URL(requestingOrigin).origin === backendOrigin;
    } catch {
      return false;
    }
  };
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(mayWriteClipboard(contents, permission, details?.requestingUrl));
  });
  window.webContents.session.setPermissionCheckHandler((contents, permission, requestingOrigin) => (
    mayWriteClipboard(contents, permission, requestingOrigin)
  ));
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const iconPath = getWindowIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: NORMAL_MIN_SIZE.width,
    minHeight: NORMAL_MIN_SIZE.height,
    show: false,
    frame: isMac,
    title: APP_NAME,
    icon: iconPath,
    autoHideMenuBar: !isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    backgroundColor: '#090a0c',
    ...(isMac ? { vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  installNavigationGuards(mainWindow);

  mainWindow.once('ready-to-show', () => {
    if (!isQuitting) {
      showWindow();
      updateThumbarButtons();
    }
  });
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      await mainWindow.webContents.insertCSS(DESKTOP_SHELL_CSS, { cssOrigin: 'author' });
    } catch (error) {
      console.error('Desktop CSS injection failed:', error.message);
    }
    mainWindow.webContents.send('desktop:mini-player-changed', isMiniPlayer);
    sendWindowState();
    updateThumbarButtons();
  });

  for (const eventName of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur', 'show', 'hide']) {
    mainWindow.on(eventName, () => {
      sendWindowState();
      updateThumbarButtons();
    });
  }

  mainWindow.on('close', event => {
    if (!isQuitting && tray) {
      event.preventDefault();
      mainWindow.hide();
      rebuildMenus();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(backendOrigin);
}

function registerMediaShortcuts() {
  const shortcuts = {
    MediaPlayPause: 'play-pause',
    MediaNextTrack: 'next',
    MediaPreviousTrack: 'previous',
  };
  for (const [accelerator, command] of Object.entries(shortcuts)) {
    const registered = globalShortcut.register(accelerator, () => sendMediaCommand(command));
    if (!registered) console.warn(`Global shortcut unavailable: ${accelerator}`);
  }
}

function rebuildMenus() {
  if (!app.isReady()) return;
  const options = {
    appName: APP_NAME,
    isMiniPlayer: () => isMiniPlayer,
    isWindowVisible: () => Boolean(mainWindow?.isVisible()),
    quit: () => app.quit(),
    sendMediaCommand,
    showWindow,
    toggleMiniPlayer,
    toggleWindow,
  };
  installApplicationMenu(options);
  if (tray) tray.setContextMenu(createTrayMenu(options));
}

function createTray() {
  try {
    const root = resolveBackendRoot();
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    let iconPath = isWin
      ? path.join(root, 'public', 'icons', 'listenfold.ico')
      : path.join(root, 'public', 'icons', 'listenfold-icon-48.png');
    if (!fs.existsSync(iconPath)) {
      iconPath = path.join(root, 'public', 'icons', 'listenfold-icon-48.png');
    }
    let icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) return;
    const size = isMac ? 18 : (isWin ? 16 : 22);
    icon = icon.resize({ width: size, height: size });
    tray = new Tray(icon);
    updateTrayTooltip();
    tray.on('click', toggleWindow);
    tray.on('double-click', showWindow);
    rebuildMenus();
  } catch (error) {
    console.warn('Tray unavailable:', error.message);
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    app.setName(APP_NAME);
    installIpc();
    await startBackend();
    createWindow();
    createTray();
    rebuildMenus();
    registerMediaShortcuts();
  }).catch(error => {
    console.error(error);
    dialog.showErrorBox(`${APP_NAME}: ошибка запуска`, error.message);
    isQuitting = true;
    terminateBackend();
    app.quit();
  });

  app.on('activate', () => {
    if (mainWindow) showWindow();
    else if (backendReady) createWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    terminateBackend();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  process.once('SIGINT', () => app.quit());
  process.once('SIGTERM', () => app.quit());
}
