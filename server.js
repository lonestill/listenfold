const path = require('path');
if (process.resourcesPath) {
  try {
    const m = require('module');
    const extraPaths = [
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules'),
      path.join(process.resourcesPath, 'app.asar', 'node_modules'),
    ];
    for (const p of extraPaths) {
      if (m.globalPaths && !m.globalPaths.includes(p)) m.globalPaths.push(p);
    }
  } catch {}
}
const express = require('express');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return res.status(403).json({ error: 'Cross-site API access denied' });
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const requestOrigin = new URL(`${req.protocol}://${req.get('host')}`).origin;
      if (originUrl.origin !== requestOrigin) {
        return res.status(403).json({ error: 'Cross-origin API access denied' });
      }
    } catch {
      return res.status(403).json({ error: 'Invalid request origin' });
    }
  }
  next();
});
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

process.on('uncaughtException', err => console.error('[UNCAUGHT EXCEPTION]', err.message));
process.on('unhandledRejection', reason => console.error('[UNHANDLED REJECTION]', reason));

// Cache & Directories
const cacheDir = process.env.LISTENFOLD_DATA_DIR || path.join(__dirname, '.cache');
const audioDir = path.join(cacheDir, 'audio');
const cookieFile = path.join(cacheDir, 'cookies.txt');
const ytdlpBinary = String(process.env.YTDLP_PATH || 'yt-dlp').trim() || 'yt-dlp';
function safeChmod(target, mode) {
  try { fs.chmodSync(target, mode); } catch {}
}
[cacheDir, audioDir].forEach(directory => {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  safeChmod(directory, 0o700);
});

const MAX_SEARCH_RESULTS = 50;
const MAX_RESCUE_TRACKS = 40;
const MAX_LIBRARY_TRACKS = 300;
const MAX_WAVE_TRACKS = 40;

const COOKIE_DOMAINS = new Set([
  'youtube.com',
  'www.youtube.com',
  'music.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'google.com',
  'accounts.google.com',
  'googlevideo.com',
  'yandex.ru',
  'passport.yandex.ru',
  'id.yandex.ru',
  'music.yandex.ru',
  'api.music.yandex.ru',
  'yandex.com',
  'passport.yandex.com',
  'music.yandex.com',
  'api.music.yandex.com',
  'yandex.by',
  'music.yandex.by',
  'yandex.kz',
  'music.yandex.kz',
]);

function normalizedCookieDomain(value) {
  return String(value || '')
    .replace(/^#HttpOnly_/i, '')
    .replace(/^\./, '')
    .trim()
    .toLowerCase();
}

function isAllowedCookieDomain(value) {
  return COOKIE_DOMAINS.has(normalizedCookieDomain(value));
}

function filteredCookieJar(contents) {
  const cookies = [];
  for (const line of String(contents || '').split(/\r?\n/)) {
    if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
    const parts = line.split('\t');
    if (parts.length >= 7 && isAllowedCookieDomain(parts[0])) cookies.push(line);
  }
  return {
    count: cookies.length,
    contents: `# Netscape HTTP Cookie File\n${cookies.join('\n')}${cookies.length ? '\n' : ''}`,
  };
}

function atomicWritePrivate(filePath, contents) {
  const tmpPath = `${filePath}.write-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.chmodSync(tmpPath, 0o600);
    fs.renameSync(tmpPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
  }
}

function sanitizeCookieJar(sourcePath) {
  const filtered = filteredCookieJar(fs.readFileSync(sourcePath, 'utf8'));
  atomicWritePrivate(cookieFile, filtered.contents);
  return filtered.count;
}

// In-Memory TTL Cache
const cache = {
  store: new Map(),
  get(k) {
    const item = this.store.get(k);
    if (!item) return null;
    if (Date.now() > item.exp) { this.store.delete(k); return null; }
    return item.val;
  },
  set(k, val, ttlSec = 300) {
    this.store.set(k, { val, exp: Date.now() + ttlSec * 1000 });
  },
  del(k) { this.store.delete(k); },
};

// Clear cached auth & library state
function clearServiceCaches() {
  for (const key of cache.store.keys()) {
    if (key === 'ym_auth' || key.startsWith('lib:') || key.startsWith('playlist:') || key.startsWith('status:') || key.startsWith('wave:')) {
      cache.del(key);
    }
  }
}

// Browser target discovery
function getAvailableBrowserTargets() {
  const targets = [];
  const homedir = os.homedir();
  const platform = process.platform;

  // 1. Gecko-based browsers with custom profile directories (Zen, Floorp, LibreWolf, Waterfox)
  const geckoProfiles = [
    {
      name: 'Zen Browser',
      roots: platform === 'darwin'
        ? [path.join(homedir, 'Library/Application Support/zen/Profiles')]
        : platform === 'win32'
          ? [path.join(process.env.APPDATA || '', 'zen/Profiles')]
          : [path.join(homedir, '.zen'), path.join(homedir, '.var/app/app.zen_browser.zen/.zen')],
    },
    {
      name: 'Floorp',
      roots: platform === 'darwin'
        ? [path.join(homedir, 'Library/Application Support/Floorp/Profiles')]
        : platform === 'win32'
          ? [path.join(process.env.APPDATA || '', 'Floorp/Profiles')]
          : [path.join(homedir, '.floorp')],
    },
    {
      name: 'LibreWolf',
      roots: platform === 'darwin'
        ? [path.join(homedir, 'Library/Application Support/librewolf/Profiles')]
        : platform === 'win32'
          ? [path.join(process.env.APPDATA || '', 'librewolf/Profiles')]
          : [path.join(homedir, '.librewolf')],
    },
    {
      name: 'Waterfox',
      roots: platform === 'darwin'
        ? [path.join(homedir, 'Library/Application Support/Waterfox/Profiles')]
        : platform === 'win32'
          ? [path.join(process.env.APPDATA || '', 'Waterfox/Profiles')]
          : [path.join(homedir, '.waterfox')],
    },
    {
      name: 'Mozilla Firefox',
      roots: platform === 'linux'
        ? [
            path.join(homedir, '.mozilla/firefox'),
            path.join(homedir, 'snap/firefox/common/.mozilla/firefox'),
            path.join(homedir, '.var/app/org.mozilla.firefox/.mozilla/firefox'),
          ]
        : [],
    },
  ];

  for (const { name, roots } of geckoProfiles) {
    for (const root of roots) {
      try {
        if (!fs.existsSync(root)) continue;
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const profileDir = path.join(root, entry.name);
          const cookieDb = path.join(profileDir, 'cookies.sqlite');
          if (fs.existsSync(cookieDb)) {
            targets.push({ id: `firefox:${profileDir}`, name });
          }
        }
      } catch {}
    }
  }

  // 2. Standard browsers supported out-of-the-box by yt-dlp
  const standardBrowsers = [
    { id: 'chrome', name: 'Google Chrome' },
    { id: 'firefox', name: 'Mozilla Firefox' },
    { id: 'edge', name: 'Microsoft Edge' },
    { id: 'brave', name: 'Brave' },
    { id: 'opera', name: 'Opera' },
    { id: 'opera_gx', name: 'Opera GX' },
    { id: 'vivaldi', name: 'Vivaldi' },
    { id: 'safari', name: 'Safari' },
    { id: 'chromium', name: 'Chromium' },
    { id: 'whale', name: 'Naver Whale' },
  ];
  targets.push(...standardBrowsers);

  // 3. Yandex Browser (Chromium based)
  const yandexUserData = platform === 'darwin'
    ? path.join(homedir, 'Library/Application Support/Yandex/YandexBrowser')
    : platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'Yandex/YandexBrowser/User Data')
      : path.join(homedir, '.config/yandex-browser');

  try {
    if (fs.existsSync(yandexUserData)) {
      targets.push({ id: `chrome:${yandexUserData}`, name: 'Yandex Browser' });
    }
  } catch {}

  return targets;
}

// Cookie export helper
function exportBrowserCookies() {
  const tmpFile = `${cookieFile}.export-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const targets = getAvailableBrowserTargets();
  let lastResult = { status: null, error: null };
  const probeUrls = ['https://music.youtube.com', 'https://music.yandex.ru'];

  for (const { id: browserId, name: browserName } of targets) {
    let result;
    const previousUmask = process.umask(0o077);
    try {
      result = spawnSync(ytdlpBinary, [
        '--cookies-from-browser', browserId,
        '--cookies', tmpFile,
        ...probeUrls,
        '--no-download', '--no-warnings', '--no-progress',
      ], {
        timeout: 20000,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (error) {
      result = { status: null, error };
    } finally {
      process.umask(previousUmask);
    }
    lastResult = result;

    let exported = false;
    try {
      exported = !result.error
        && fs.existsSync(tmpFile)
        && fs.statSync(tmpFile).size > 0;
      if (fs.existsSync(tmpFile)) safeChmod(tmpFile, 0o600);
    } catch {}

    if (exported) {
      try {
        const filtered = filteredCookieJar(fs.readFileSync(tmpFile, 'utf8'));
        if (filtered.count > 0) {
          atomicWritePrivate(cookieFile, filtered.contents);
          parseCookies();
          clearServiceCaches();
          return { ok: true, updated: true, browser: browserName, count: filtered.count, code: null };
        }
      } catch (err) {
        // Try next browser if filtered count empty
      } finally {
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
      }
    }
  }

  try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
  const code = lastResult.error?.code === 'ETIMEDOUT'
    ? 'TIMEOUT'
    : (lastResult.error?.code === 'ENOENT' ? 'YT_DLP_NOT_FOUND' : `YT_DLP_EXIT_${lastResult.status ?? 'UNKNOWN'}`);
  console.warn(`[Cookies] Export failed (${code})`);
  return { ok: false, updated: false, code };
}

let parsedCookies = {};
function parseCookies() {
  parsedCookies = {};
  if (!fs.existsSync(cookieFile)) return { ok: false, count: 0 };
  let count = 0;
  try {
    const lines = fs.readFileSync(cookieFile, 'utf8').split('\n');
    for (let line of lines) {
      if (!line) continue;
      if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length);
      else if (line.startsWith('#')) continue;
      const parts = line.split('\t');
      if (parts.length >= 7) {
        const domain = parts[0];
        if (!isAllowedCookieDomain(domain)) continue;
        const name = parts[5];
        const value = parts[6]?.trim();
        if (domain && name && value) {
          if (!parsedCookies[domain]) parsedCookies[domain] = {};
          parsedCookies[domain][name] = value;
          count += 1;
        }
      }
    }
    return { ok: count > 0, count };
  } catch (e) {
    return { ok: false, count: 0 };
  }
}

function getCookieString(domainPattern) {
  const matched = [];
  for (const [dom, cookies] of Object.entries(parsedCookies)) {
    if (dom.includes(domainPattern)) {
      for (const [k, v] of Object.entries(cookies)) {
        matched.push(`${k}=${v}`);
      }
    }
  }
  return matched.join('; ');
}

function getCookieHealth() {
  const exists = fs.existsSync(cookieFile);
  let stat = null;
  try { if (exists) stat = fs.statSync(cookieFile); } catch {}
  const count = Object.values(parsedCookies).reduce((sum, cookies) => sum + Object.keys(cookies).length, 0);
  const yandexCookies = getCookieString('yandex');
  const youtubeCookies = `${getCookieString('youtube')}; ${getCookieString('google')}`;
  return {
    ok: count > 0,
    filePresent: Boolean(stat && stat.size > 0),
    loaded: count > 0,
    yandexSession: /(?:^|;\s*)(?:Session_id|sessionid2|yandex_login)=/i.test(yandexCookies),
    youtubeSession: /(?:^|;\s*)(?:SAPISID|__Secure-\d?PAPISID|SID|LOGIN_INFO)=/i.test(youtubeCookies),
    updatedAt: stat ? stat.mtime.toISOString() : null,
  };
}

function cookieArgs() {
  try {
    return fs.existsSync(cookieFile) && fs.statSync(cookieFile).size > 0
      ? ['--cookies', cookieFile]
      : [];
  } catch {
    return [];
  }
}

let existingCookieCount = 0;
if (fs.existsSync(cookieFile)) {
  try {
    fs.chmodSync(cookieFile, 0o600);
    existingCookieCount = sanitizeCookieJar(cookieFile);
  } catch {
    console.warn('[Cookies] Existing cookie cache was unreadable and has been reset');
    atomicWritePrivate(cookieFile, '# Netscape HTTP Cookie File\n');
  }
}
if (existingCookieCount <= 0 && process.env.LISTENFOLD_SKIP_COOKIE_IMPORT !== '1') exportBrowserCookies();
parseCookies();

// HTTP request helper
function httpRequest(url, options = {}, redirectState = null) {
  const timeoutMs = options.timeout || 12000;
  const state = redirectState || { redirects: 0, deadline: Date.now() + timeoutMs };
  const remainingMs = state.deadline - Date.now();
  if (remainingMs <= 0) return Promise.reject(new Error('Request timeout'));

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let req = null;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported request protocol');
      const mod = parsed.protocol === 'https:' ? https : http;
      req = mod.request(parsed, {
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: remainingMs,
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (state.redirects >= 5) return done(new Error('Too many redirects'));
          let nextUrl;
          try {
            nextUrl = new URL(res.headers.location, parsed).href;
          } catch {
            return done(new Error('Invalid redirect URL'));
          }
          if (timer) clearTimeout(timer);
          settled = true;
          const nextOptions = res.statusCode === 303
            ? { ...options, method: 'GET', body: undefined }
            : options;
          return httpRequest(
            nextUrl,
            nextOptions,
            { redirects: state.redirects + 1, deadline: state.deadline },
          ).then(resolve, reject);
        }

        let data = '';
        let receivedBytes = 0;
        const maxBytes = options.maxBytes || 10 * 1024 * 1024;
        res.setEncoding('utf8');
        res.on('aborted', () => done(new Error('Response aborted')));
        res.on('error', done);
        res.on('data', chunk => {
          receivedBytes += Buffer.byteLength(chunk);
          if (receivedBytes > maxBytes) {
            res.destroy();
            return done(new Error('Response body too large'));
          }
          data += chunk;
        });
        res.on('end', () => done(null, { status: res.statusCode, headers: res.headers, data }));
      });
      req.on('error', done);
      req.on('timeout', () => {
        req.destroy();
        done(new Error('Request timeout'));
      });
      timer = setTimeout(() => {
        req.destroy();
        done(new Error('Request timeout'));
      }, remainingMs);
      if (options.body) req.write(options.body);
      req.end();
    } catch (err) {
      if (req && !req.destroyed) req.destroy();
      done(err);
    }
  });
}

// yt-dlp execution
function ytdlp(args, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpBinary, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => (stdout += d.toString()));
    proc.stderr.on('data', d => (stderr += d.toString()));
    const timer = setTimeout(() => {
      try { process.platform === 'win32' ? proc.kill() : proc.kill('SIGKILL'); } catch {}
      reject(new Error('yt-dlp timeout'));
    }, timeoutMs);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.slice(0, 300) || `yt-dlp exit ${code}`));
    });
    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Yandex Music API client
function getYandexAuth() {
  const cached = cache.get('ym_auth');
  if (cached) return cached;

  let comCookieStr = getCookieString('yandex.com') || getCookieString('music.yandex.com');
  let ruCookieStr = getCookieString('yandex.ru') || getCookieString('music.yandex.ru');
  let cookieStr = comCookieStr || ruCookieStr || getCookieString('yandex');

  const auth = {
    cookieStr,
    isCom: Boolean(comCookieStr && comCookieStr.includes('Session_id')),
  };

  cache.set('ym_auth', auth, 600);
  return auth;
}

async function ymApi(endpoint, options = {}, retryOn401 = true) {
  const auth = getYandexAuth();
  // Always prioritize api.music.yandex.com where active session lives
  const baseHost = 'https://api.music.yandex.com';
  const origin = 'https://music.yandex.com';

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'application/json; q=1.0, text/*; q=0.8, */*; q=0.1',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Origin': origin,
    'Referer': `${origin}/`,
    'Cookie': auth.cookieStr,
    'X-Yandex-Music-Client': 'YandexMusicAndroid/24023231',
    ...options.headers,
  };

  const url = `${baseHost}${endpoint}`;
  const { status, data } = await httpRequest(url, {
    method: options.method || 'GET',
    headers,
    body: options.body,
  });

  if (status === 401 && retryOn401) {
    const refresh = exportChromeCookies();
    if (refresh.ok) {
      parseCookies();
      cache.del('ym_auth');
      return ymApi(endpoint, options, false);
    }
  }

  if (status !== 200) {
    throw new Error(`Yandex API ${status}: ${data.slice(0, 160)}`);
  }
  return JSON.parse(data);
}

function upgradeThumb(url) {
  if (!url) return null;
  if (url.includes('googleusercontent.com')) {
    return url.replace(/=w\d+-h\d+[^?&]*/, '=w1200-h1200-l90-rj').replace(/=s\d+[^?&]*/, '=s1200');
  }
  if (url.includes('avatars.yandex.net')) {
    return url.replace(/\/\d+x\d+$/, '/1000x1000');
  }
  return url;
}

function ymTrack(t) {
  const albumId = t.albums?.[0]?.id;
  const cover = t.coverUri ? `https://${t.coverUri.replace('%%', '1000x1000')}` : null;
  return {
    id: `ym-${t.id}`,
    ymId: t.id,
    title: t.title || 'Untitled',
    artist: (t.artists || []).map(a => a.name).join(', ') || 'Unknown',
    duration: Math.round((t.durationMs || 0) / 1000),
    thumbnail: cover,
    url: albumId ? `https://music.yandex.com/album/${albumId}/track/${t.id}` : `https://music.yandex.com/track/${t.id}`,
    source: 'yandex',
  };
}

function pickThumb(d) {
  let thumb = null;
  if (d.thumbnails?.length) {
    const sorted = [...d.thumbnails].sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
    thumb = sorted[0]?.url;
  } else {
    thumb = d.thumbnail;
  }
  return upgradeThumb(thumb);
}

function youtubeTrack(d) {
  return {
    id: d.id,
    title: d.title || 'Untitled',
    artist: d.artist || d.uploader || d.channel || 'Unknown',
    duration: Number(d.duration) || 0,
    thumbnail: pickThumb(d),
    url: `https://music.youtube.com/watch?v=${d.id}`,
    source: 'youtube',
  };
}

function safeTrackList(value, max = 80) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).filter(Boolean).map(track => plainTrack(track));
}

function trackQuery(track) {
  if (!track) return '';
  const identity = trackIdentity(track);
  return `${track.artist || identity.artist || ''} ${identity.title || track.title || ''}`.trim();
}

function topArtists(tracks, limit = 4) {
  const counts = new Map();
  for (const track of tracks) {
    const artist = normalizeArtist(track.artist);
    if (!artist) continue;
    counts.set(artist, (counts.get(artist) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([artist]) => artist);
}

function uniqueTracks(tracks, limit = Infinity) {
  const seen = new Set();
  const out = [];
  for (const track of tracks.filter(Boolean)) {
    const identity = trackIdentity(track);
    const key = `${identity.artist}|${identity.title}|${identity.versionType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(track);
    if (out.length >= limit) break;
  }
  return out;
}

function interleaveLists(lists, limit) {
  const result = [];
  let cursor = 0;
  while (result.length < limit) {
    let pushed = false;
    for (const list of lists) {
      if (list[cursor]) {
        result.push(list[cursor]);
        pushed = true;
        if (result.length >= limit) break;
      }
    }
    if (!pushed) break;
    cursor += 1;
  }
  return result;
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const VERSION_PATTERNS = [
  ['remix', /(?:^|\s)(?:remix|remixed|ремикс|rework|bootleg)(?=\s|$)/u],
  ['remaster', /(?:^|\s)(?:remaster|remastered|ремастер|ремастеринг)(?=\s|$)/u],
  ['live', /(?:^|\s)(?:concert version|radio session|live|concert|broadcast|session|концерт|концертная|живое выступление|выступление)(?=\s|$)/u],
  ['clip', /(?:^|\s)(?:official music video|official animated video|official video|music video|video clip|официальный клип|клип)(?=\s|$)/u],
  ['acoustic', /(?:^|\s)(?:acoustic|unplugged|акустика|акустическая)(?=\s|$)/u],
  ['cover', /(?:^|\s)(?:cover|кавер)(?=\s|$)/u],
  ['instrumental', /(?:^|\s)(?:instrumental|instrumental version|инструментал|минус)(?=\s|$)/u],
  ['karaoke', /(?:^|\s)(?:karaoke|караоке)(?=\s|$)/u],
  ['slowed', /(?:^|\s)(?:slowed|slowed reverb|slowed down|замедлено)(?=\s|$)/u],
  ['sped-up', /(?:^|\s)(?:sped up|speed up|nightcore|ускорено)(?=\s|$)/u],
  ['lyrics', /(?:^|\s)(?:lyrics|lyric video|with lyrics|текст песни|со словами)(?=\s|$)/u],
  ['mix', /(?:^|\s)(?:mix|megamix|compilation|full album|playlist|one hour|1 hour|сборник|часовая)(?=\s|$)/u],
  ['excerpt', /(?:^|\s)(?:intro|outro|excerpt|snippet|teaser|preview|отрывок|фрагмент)(?=\s|$)/u],
];

function detectVersionType(value) {
  const normalized = normalizeText(value);
  const found = VERSION_PATTERNS.find(([, pattern]) => pattern.test(normalized));
  return found ? found[0] : 'original';
}

function normalizeArtist(value) {
  let artist = String(value || '')
    .replace(/\s*[-–—]\s*Topic\s*$/i, '')
    .replace(/\s+VEVO\s*$/i, '')
    .replace(/\s+(?:official(?:\s+music)?|music)\s*$/i, '')
    .split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0]
    .split(/\s*(?:,|&|\+|\bx\b)\s*/i)[0];
  artist = normalizeText(artist);
  return artist === 'unknown' || artist === 'various artists' ? '' : artist;
}

function isDecorativeTitlePart(value) {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  if (/^(?:19|20)\d{2}$/.test(normalized)) return true;
  if (detectVersionType(normalized) !== 'original') return true;
  return /(?:^|\s)(?:official|official video|official audio|music video|audio|visualizer|hd|hq|4k)(?=\s|$)/u.test(normalized);
}

function normalizeTitle(value, artist = '') {
  let title = String(value || '');
  const parts = title.split(/\s+[-–—]\s+/);
  if (parts.length > 1) {
    const left = normalizeArtist(parts[0]);
    const knownArtist = normalizeArtist(artist);
    if (knownArtist && textSimilarity(left, knownArtist) >= 0.65) title = parts.slice(1).join(' - ');
  }

  title = title
    .replace(/[\[(]([^\])]+)[\])]/g, (whole, inner) => (isDecorativeTitlePart(inner) ? ' ' : whole))
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, ' ');

  let normalized = normalizeText(title)
    .replace(/(?:^|\s)(?:official music video|official video|official audio|music video|lyric video|visualizer)(?=\s|$)/gu, ' ');

  for (const [, pattern] of VERSION_PATTERNS) normalized = normalized.replace(new RegExp(pattern.source, 'gu'), ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  const normalizedArtist = normalizeArtist(artist);
  if (normalizedArtist && normalized.startsWith(`${normalizedArtist} `)) {
    normalized = normalized.slice(normalizedArtist.length + 1).trim();
  }
  return normalized || normalizeText(value);
}

function bigrams(value) {
  const compact = value.replace(/\s+/g, '');
  if (compact.length < 2) return compact ? [compact] : [];
  const result = [];
  for (let i = 0; i < compact.length - 1; i += 1) result.push(compact.slice(i, i + 2));
  return result;
}

function textSimilarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 4) return 0.92;

  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  let tokenIntersection = 0;
  for (const token of aTokens) if (bTokens.has(token)) tokenIntersection += 1;
  const tokenDice = (2 * tokenIntersection) / (aTokens.size + bTokens.size);

  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  const remaining = new Map();
  for (const gram of aBigrams) remaining.set(gram, (remaining.get(gram) || 0) + 1);
  let gramIntersection = 0;
  for (const gram of bBigrams) {
    const count = remaining.get(gram) || 0;
    if (count > 0) {
      gramIntersection += 1;
      remaining.set(gram, count - 1);
    }
  }
  const gramDice = aBigrams.length + bBigrams.length
    ? (2 * gramIntersection) / (aBigrams.length + bBigrams.length)
    : 0;
  return Math.min(1, tokenDice * 0.65 + gramDice * 0.35);
}

function artistSimilarity(left, right) {
  const a = normalizeArtist(left).replace(/^the\s+/, '');
  const b = normalizeArtist(right).replace(/^the\s+/, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  let intersection = 0;
  for (const token of aTokens) if (bTokens.has(token)) intersection += 1;
  const coverage = intersection / Math.max(aTokens.size, bTokens.size);
  return Math.min(1, coverage * 0.8 + textSimilarity(a, b) * 0.2);
}

function trackIdentity(track) {
  let artist = normalizeArtist(track.artist);
  let title = normalizeTitle(track.title, track.artist);
  if (track.source === 'youtube') {
    const parts = String(track.title || '').split(/\s+[-–—]\s+/);
    if (parts.length > 1) {
      const titleArtist = normalizeArtist(parts[0]);
      const titlePart = normalizeTitle(parts.slice(1).join(' - '), titleArtist);
      if (titleArtist && titlePart && (!artist || artistSimilarity(titleArtist, artist) < 0.65)) {
        artist = titleArtist;
        title = titlePart;
      }
    }
  }
  return {
    artist,
    title,
    versionType: detectVersionType(track.title),
    duration: Number(track.duration) || 0,
  };
}

function durationSimilarity(left, right) {
  const a = Number(left) || 0;
  const b = Number(right) || 0;
  if (!a || !b) return 0.55;
  const delta = Math.abs(a - b);
  if (delta <= 3) return 1;
  if (delta <= 7) return 0.9;
  const ratio = delta / Math.max(a, b);
  if (ratio <= 0.05) return 0.82;
  if (ratio <= 0.1) return 0.55;
  if (ratio <= 0.2) return 0.25;
  return 0;
}

function scoreTrackForQuery(track, query) {
  const q = normalizeText(query);
  if (!q) return track.source === 'yandex' ? 0.51 : 0.5;
  const identity = trackIdentity(track);
  const combined = normalizeText(`${identity.artist} ${identity.title}`);
  const queryTokens = new Set(q.split(' ').filter(Boolean));
  const trackTokens = new Set(combined.split(' ').filter(Boolean));
  let overlap = 0;
  for (const token of queryTokens) if (trackTokens.has(token)) overlap += 1;
  const coverage = queryTokens.size ? overlap / queryTokens.size : 0;
  const precision = trackTokens.size ? overlap / trackTokens.size : 0;
  let score = coverage * 0.5 + precision * 0.16 + textSimilarity(q, combined) * 0.24;
  if (combined.includes(q) || q.includes(combined)) score += 0.1;

  const queryVersion = detectVersionType(query);
  if (queryVersion === 'original' && identity.versionType !== 'original') {
    const penalties = { mix: 0.38, live: 0.24, remix: 0.22, cover: 0.25, lyrics: 0.13, slowed: 0.3, 'sped-up': 0.3, excerpt: 0.42 };
    score -= penalties[identity.versionType] || 0.16;
  } else if (queryVersion !== 'original') {
    score += identity.versionType === queryVersion ? 0.12 : -0.28;
  }

  if (identity.duration > 1200 && queryVersion !== 'mix') score -= 0.45;
  else if (identity.duration > 600 && queryVersion !== 'mix') score -= 0.24;
  else if (identity.duration > 480 && queryVersion === 'original') score -= 0.08;
  if (identity.duration > 0 && identity.duration < 30 && queryVersion !== 'excerpt') score -= 0.35;
  else if (identity.duration > 0 && identity.duration < 60 && queryVersion !== 'excerpt') score -= 0.18;
  if (track.source === 'yandex') score += 0.015;
  return Math.max(0, Math.min(1, score));
}

function candidateMatchScore(original, candidate) {
  const from = trackIdentity(original);
  const to = trackIdentity(candidate);
  const title = textSimilarity(from.title, to.title);
  const artist = from.artist && to.artist ? artistSimilarity(from.artist, to.artist) : 0.5;
  const duration = durationSimilarity(from.duration, to.duration);
  let score = title * 0.55 + artist * 0.25 + duration * 0.2;
  const titleContainmentMismatch = from.title !== to.title
    && (from.title.includes(to.title) || to.title.includes(from.title));

  const versionMismatch = from.versionType !== to.versionType;
  if (versionMismatch) {
    const lyricOnly = [from.versionType, to.versionType].includes('lyrics')
      && [from.versionType, to.versionType].includes('original');
    score -= lyricOnly ? 0.18 : 0.35;
  }
  if (to.duration > 900 && from.duration > 0 && to.duration > from.duration * 1.5) score -= 0.3;
  if (titleContainmentMismatch) score = Math.min(score, 0.84);

  return {
    score: Math.max(0, Math.min(1, score)),
    title,
    artist,
    duration,
    versionMismatch,
    titleContainmentMismatch,
    durationDelta: from.duration && to.duration ? Math.abs(from.duration - to.duration) : null,
  };
}

function canGroupTracks(left, right) {
  if (left.source === right.source) return false;
  const a = trackIdentity(left);
  const b = trackIdentity(right);
  if (a.versionType !== b.versionType) return false;
  if (textSimilarity(a.title, b.title) < 0.96) return false;
  if (a.artist && b.artist && artistSimilarity(a.artist, b.artist) < 0.72) return false;
  if (a.duration && b.duration) {
    const tolerance = Math.max(7, Math.min(a.duration, b.duration) * 0.045);
    if (Math.abs(a.duration - b.duration) > tolerance) return false;
  }
  return true;
}

function plainTrack(track) {
  const { canonicalId, songKey, variants, sources, versionType, match, relevanceScore, ...plain } = track;
  return { ...plain };
}

function canonicalTrack(variants, query = '', forcedConfidence = null) {
  const scored = variants.map(track => ({ track: plainTrack(track), score: scoreTrackForQuery(track, query) }));
  scored.sort((a, b) => b.score - a.score
    || (a.track.source === b.track.source ? 0 : (a.track.source === 'yandex' ? -1 : 1)));
  const primary = scored[0].track;
  const identity = trackIdentity(primary);
  const durations = variants.map(track => Number(track.duration) || 0).filter(Boolean).sort((a, b) => a - b);
  const durationBucket = durations.length ? Math.round(durations[Math.floor(durations.length / 2)] / 10) * 10 : 0;
  const canonicalId = `sf-${crypto.createHash('sha1')
    .update(`${identity.artist}|${identity.title}|${identity.versionType}|${durationBucket}`)
    .digest('hex').slice(0, 16)}`;
  const songKey = `song-${crypto.createHash('sha1')
    .update(`${identity.artist}|${identity.title}`)
    .digest('hex').slice(0, 16)}`;
  const pairMatch = variants.length > 1 ? candidateMatchScore(variants[0], variants[1]) : null;
  const confidence = forcedConfidence == null ? pairMatch?.score ?? null : forcedConfidence;

  return {
    ...primary,
    canonicalId,
    songKey,
    variants: scored.map(item => item.track),
    sources: [...new Set(scored.map(item => item.track.source))],
    versionType: identity.versionType,
    match: {
      grouped: variants.length > 1,
      method: variants.length > 1 ? 'normalized-artist-title-duration' : 'single-source',
      confidence: confidence == null ? null : Number(confidence.toFixed(3)),
      queryScore: Number(scored[0].score.toFixed(3)),
      durationDelta: pairMatch?.durationDelta ?? null,
    },
  };
}

function canonicalizeTracks(tracks, query = '', limit = Infinity) {
  const ordered = tracks
    .filter(Boolean)
    .map((track, index) => ({ track: plainTrack(track), index, score: scoreTrackForQuery(track, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const deduped = [];

  for (const item of ordered) {
    const identity = trackIdentity(item.track);
    const duplicate = deduped.some(existing => {
      if (existing.track.source !== item.track.source) return false;
      const other = trackIdentity(existing.track);
      if (identity.versionType !== other.versionType || identity.title !== other.title) return false;
      if (identity.artist && other.artist && artistSimilarity(identity.artist, other.artist) < 0.96) return false;
      if (identity.duration && other.duration && Math.abs(identity.duration - other.duration) > 3) return false;
      return true;
    });
    if (!duplicate) deduped.push(item);
  }

  const groups = [];

  for (const item of deduped) {
    const group = groups.find(candidate => candidate.every(existing => existing.source !== item.track.source)
      && candidate.some(existing => canGroupTracks(existing, item.track)));
    if (group) group.push(item.track);
    else groups.push([item.track]);
  }

  return groups
    .map(group => canonicalTrack(group, query))
    .sort((a, b) => b.match.queryScore - a.match.queryScore)
    .slice(0, limit);
}

// Search API
function providerUnavailable(provider, cause) {
  const names = { yandex: 'Yandex Music', youtube: 'YouTube Music', all: 'Music providers' };
  const error = new Error(`${names[provider] || 'Music provider'} search unavailable`);
  error.code = 'PROVIDER_UNAVAILABLE';
  error.provider = provider;
  error.cause = cause;
  return error;
}

app.get('/api/search', async (req, res) => {
  const { q, source = 'all', limit = 30 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  if (!['all', 'yandex', 'youtube'].includes(source)) return res.status(400).json({ error: 'Invalid source' });
  const safeLimit = clampInteger(limit, 30, 1, MAX_SEARCH_RESULTS);

  const cacheKey = `search:v2:${source}:${q}:${safeLimit}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    let tracks = [];
    let availability = null;
    if (source === 'all') {
      const perSource = Math.min(MAX_SEARCH_RESULTS, Math.max(10, safeLimit));
      const [ymRes, ytRes] = await Promise.allSettled([
        searchYandex(q, perSource),
        searchYouTube(q, perSource),
      ]);
      availability = {
        yandex: ymRes.status === 'fulfilled',
        youtube: ytRes.status === 'fulfilled',
      };
      if (!availability.yandex && !availability.youtube) {
        throw providerUnavailable('all', new Error('All searches failed'));
      }
      const ymTracks = ymRes.status === 'fulfilled' ? ymRes.value.tracks : [];
      const ytTracks = ytRes.status === 'fulfilled' ? ytRes.value.tracks : [];
      tracks = canonicalizeTracks([...ymTracks, ...ytTracks], q, safeLimit);
    } else if (source === 'yandex') {
      const r = await searchYandex(q, safeLimit);
      tracks = canonicalizeTracks(r.tracks, q, safeLimit);
    } else {
      const r = await searchYouTube(q, safeLimit);
      tracks = canonicalizeTracks(r.tracks, q, safeLimit);
    }

    const result = {
      tracks: tracks.slice(0, safeLimit),
      ...(availability ? { availability } : {}),
    };
    if (!availability || (availability.yandex && availability.youtube)) cache.set(cacheKey, result, 120);
    res.json(result);
  } catch (err) {
    console.error(`Search error [${source}]:`, err.message);
    const unavailable = err.code === 'PROVIDER_UNAVAILABLE';
    res.status(unavailable ? 502 : 500).json({
      error: err.message,
      ...(unavailable ? { code: err.code, provider: err.provider } : {}),
      tracks: [],
    });
  }
});

async function searchYouTube(query, limit) {
  try {
    const raw = await ytdlp([
      `ytsearch${limit}:${query} music`,
      '--dump-json', '--flat-playlist', '--no-download', '--no-warnings',
      '--extractor-args', 'youtube:player_client=web_music',
    ], 18000);

    const tracks = raw.trim().split('\n').filter(Boolean).map(line => {
      try {
        const d = JSON.parse(line);
        return youtubeTrack(d);
      } catch { return null; }
    }).filter(Boolean);

    return { tracks };
  } catch (err) {
    throw providerUnavailable('youtube', err);
  }
}

async function searchYandex(query, limit) {
  try {
    const json = await ymApi(`/search?text=${encodeURIComponent(query)}&type=track&page=0&nocorrect=false`);
    const results = json.result?.tracks?.results || json.tracks?.results || [];
    return { tracks: results.slice(0, limit).map(ymTrack) };
  } catch (err) {
    throw providerUnavailable('yandex', err);
  }
}

function extractRotorTracks(data) {
  const tracks = [];
  const visit = value => {
    if (!value || tracks.length >= MAX_WAVE_TRACKS) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== 'object') return;
    const candidate = value.track || value;
    if (candidate && candidate.id && candidate.title && Array.isArray(candidate.artists)) {
      tracks.push(ymTrack(candidate));
      return;
    }
    for (const key of ['result', 'sequence', 'tracks', 'items']) visit(value[key]);
  };
  visit(data);
  return uniqueTracks(tracks, MAX_WAVE_TRACKS);
}

function normalizeYandexStationId(value) {
  const raw = String(value || '').normalize('NFC').trim();
  if (!raw || raw.length > 160 || raw.includes('/') || raw.includes('?') || raw.includes('#') || raw.includes('%')) {
    return '';
  }
  const separator = raw.indexOf(':');
  if (separator <= 0 || separator !== raw.lastIndexOf(':')) return '';
  const type = raw.slice(0, separator);
  const tag = raw.slice(separator + 1);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(type) || !/^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,127}$/u.test(tag)) return '';
  return `${type}:${tag}`;
}

function yandexStationPathId(stationId) {
  const normalized = normalizeYandexStationId(stationId);
  if (!normalized) throw new Error('Invalid Yandex station id');
  const separator = normalized.indexOf(':');
  return `${encodeURIComponent(normalized.slice(0, separator))}:${encodeURIComponent(normalized.slice(separator + 1))}`;
}

function yandexStationImage(value, size = 600) {
  let image = String(value || '').trim();
  if (!image) return null;
  image = image.replace('%%', `${size}x${size}`);
  if (image.startsWith('//')) return `https:${image}`;
  if (!/^https?:\/\//i.test(image)) image = `https://${image.replace(/^\/+/, '')}`;
  return image;
}

function normalizeYandexStation(item) {
  const station = item?.station || item;
  const type = String(station?.id?.type || '').trim();
  const tag = String(station?.id?.tag || '').trim();
  const stationId = normalizeYandexStationId(`${type}:${tag}`);
  if (!stationId) return null;
  const title = String(station.name || item?.data?.title || item?.rupTitle || stationId).trim();
  const subtitle = String(item?.rupDescription || item?.data?.description || '').replace(/\u00a0/g, ' ').trim();
  const icon = yandexStationImage(station.icon?.imageUrl || item?.data?.imageUrl, 400);
  const image = yandexStationImage(station.fullImageUrl || item?.data?.imageUrl || station.icon?.imageUrl, 1000);
  return {
    id: stationId,
    stationId,
    source: 'yandex',
    provider: 'yandex',
    title,
    name: title,
    subtitle,
    description: subtitle,
    icon,
    image,
    thumbnail: image || icon,
    color: station.icon?.backgroundColor || null,
    type,
    tag,
    personalized: type === 'user' || type === 'personal',
  };
}

async function loadYandexStationCatalog(scope = 'dashboard') {
  const safeScope = scope === 'all' ? 'all' : 'dashboard';
  const cacheKey = `ym:rotor:stations:${safeScope}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await ymApi(safeScope === 'all'
    ? '/rotor/stations/list?language=ru'
    : '/rotor/stations/dashboard');
  const rawStations = safeScope === 'all'
    ? (Array.isArray(data.result) ? data.result : [])
    : (Array.isArray(data.result?.stations) ? data.result.stations : []);
  const seen = new Set();
  const stations = rawStations.map(normalizeYandexStation).filter(station => {
    if (!station || seen.has(station.stationId)) return false;
    seen.add(station.stationId);
    return true;
  });
  const result = {
    source: 'yandex',
    scope: safeScope,
    dashboardId: safeScope === 'dashboard' ? data.result?.dashboardId || null : null,
    stations,
  };
  cache.set(cacheKey, result, safeScope === 'dashboard' ? 300 : 1800);
  return result;
}

async function loadYandexStationInfo(stationId) {
  const normalized = normalizeYandexStationId(stationId);
  if (!normalized) throw new Error('Invalid Yandex station id');
  const cacheKey = `ym:rotor:station:${normalized}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const data = await ymApi(`/rotor/station/${yandexStationPathId(normalized)}/info`);
  const item = Array.isArray(data.result) ? data.result[0] : data.result;
  const station = normalizeYandexStation(item);
  if (!station) throw new Error('Yandex station was not found');
  cache.set(cacheKey, station, 900);
  return station;
}

function yandexRotorTrackId(track) {
  if (!track) return '';
  const candidates = [track, ...(Array.isArray(track.variants) ? track.variants : [])];
  for (const candidate of candidates) {
    if (candidate?.source && candidate.source !== 'yandex' && !candidate.ymId) continue;
    const trackId = String(candidate?.ymId || candidate?.id || '').replace(/^ym-/, '').trim();
    if (!/^\d+$/.test(trackId)) continue;
    const albumId = String(candidate?.url || '').match(/\/album\/(\d+)\/track\//)?.[1] || '';
    return albumId ? `${trackId}:${albumId}` : trackId;
  }
  return '';
}

function yandexRotorQueue(context = {}) {
  const candidates = [
    ...safeTrackList(context.history, 30),
    ...(context.currentTrack ? [context.currentTrack] : []),
    ...safeTrackList(context.queue, 30),
  ];
  return [...new Set(candidates.map(yandexRotorTrackId).filter(Boolean))].slice(-40);
}

async function loadYandexStationTracks(stationId, limit, context = {}) {
  const normalized = normalizeYandexStationId(stationId);
  if (!normalized) throw new Error('Invalid Yandex station id');
  const queue = yandexRotorQueue(context);
  let tracks = [];
  const maxBatches = Math.min(4, Math.max(1, Math.ceil(limit / 5) + 1));

  for (let batch = 0; batch < maxBatches && tracks.length < limit; batch += 1) {
    const params = new URLSearchParams({ settings2: 'true' });
    if (queue.length) params.set('queue', queue.join(','));
    const data = await ymApi(`/rotor/station/${yandexStationPathId(normalized)}/tracks?${params}`);
    const sequence = Array.isArray(data.result?.sequence) ? data.result.sequence : [];
    const batchTracks = extractRotorTracks(data);
    const previousCount = tracks.length;
    tracks = uniqueTracks([...tracks, ...batchTracks], MAX_WAVE_TRACKS);
    for (const item of sequence) {
      const rotorId = yandexRotorTrackId(ymTrack(item.track || item));
      if (rotorId && !queue.includes(rotorId)) queue.push(rotorId);
    }
    if (!sequence.length || tracks.length === previousCount) break;
  }

  return tracks.slice(0, limit);
}

async function loadYandexNativeWave(limit, stationId = '', context = {}) {
  const stationIds = stationId
    ? [normalizeYandexStationId(stationId)]
    : ['user:onyourwave', 'user:liked'];

  for (const candidateId of stationIds) {
    try {
      // Keep the mixed/custom Wave fast: only an explicitly selected Yandex
      // station is expanded across multiple native Rotor batches.
      const tracks = await loadYandexStationTracks(candidateId, stationId ? limit : Math.min(limit, 5), context);
      if (tracks.length) return tracks;
    } catch (err) {
      console.warn(`Yandex wave endpoint failed [${candidateId}]:`, err.message);
      if (stationId) throw err;
    }
  }

  return [];
}

// Read-only YouTube Music endpoints. These use the same signed browser session
// as the web client and return the real RD* station IDs from its home feed.
async function youtubeMusicReadRequest(endpoint, payload, retryAuth = true, requestParams = {}) {
  if (!['browse', 'next'].includes(endpoint)) throw new Error('Unsupported YouTube Music read endpoint');

  const origin = 'https://music.youtube.com';
  const cookie = providerCookieString(['youtube', 'google']);
  const sapisid = providerCookieValue(['__Secure-3PAPISID', 'SAPISID'], ['youtube', 'google']);
  if (!cookie || !sapisid) throw new Error('Нужен вход в YouTube Music');

  const config = await getYouTubeMusicConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`${timestamp} ${sapisid} ${origin}`).digest('hex');
  const authUser = providerCookieValue(['SESSION_INDEX'], ['youtube', 'google']) || '0';
  const body = JSON.stringify({
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: config.clientVersion,
        hl: 'ru',
        gl: 'RU',
        ...(config.visitorData ? { visitorData: config.visitorData } : {}),
      },
      user: {},
    },
    ...payload,
  });
  const query = new URLSearchParams({
    alt: 'json',
    key: config.apiKey,
    prettyPrint: 'false',
  });
  for (const [name, value] of Object.entries(requestParams || {})) {
    if (value != null && value !== '') query.set(name, String(value));
  }
  const response = await httpRequest(`${origin}/youtubei/v1/${endpoint}?${query.toString()}`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Origin: origin,
      Referer: `${origin}/`,
      Cookie: cookie,
      Authorization: `SAPISIDHASH ${timestamp}_${signature}`,
      'X-Origin': origin,
      'X-Goog-AuthUser': String(authUser),
      'X-Youtube-Client-Name': String(config.clientName),
      'X-Youtube-Client-Version': config.clientVersion,
      'X-Youtube-Bootstrap-Logged-In': 'true',
      ...(config.visitorData ? { 'X-Goog-Visitor-Id': config.visitorData } : {}),
    },
    body,
    timeout: 18000,
    maxBytes: 10 * 1024 * 1024,
  });

  if (response.status === 401 && retryAuth) {
    const refreshed = exportChromeCookies();
    if (refreshed.ok) {
      parseCookies();
      cache.del('ytm:innertube-config');
      return youtubeMusicReadRequest(endpoint, payload, false, requestParams);
    }
  }
  if (response.status !== 200) throw new Error(`YouTube Music API ${response.status}`);
  try {
    return JSON.parse(response.data);
  } catch {
    throw new Error('YouTube Music вернул некорректный ответ');
  }
}

function youtubeMusicText(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  if (typeof value.simpleText === 'string') return value.simpleText.trim();
  if (Array.isArray(value.runs)) return value.runs.map(run => run?.text || '').join('').trim();
  return '';
}

function youtubeMusicThumbnail(value) {
  let best = null;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (Array.isArray(node.thumbnails)) {
      for (const image of node.thumbnails) {
        if (!image?.url) continue;
        const area = (Number(image.width) || 0) * (Number(image.height) || 0);
        const bestArea = best ? (Number(best.width) || 0) * (Number(best.height) || 0) : -1;
        if (!best || area >= bestArea) best = image;
      }
      return;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return upgradeThumb(best?.url || null);
}

function youtubeMusicStationIds(value) {
  const ids = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'playlistId' && typeof child === 'string') ids.push(child);
      else if (key === 'browseId' && typeof child === 'string' && child.startsWith('VL')) ids.push(child.slice(2));
      else visit(child);
    }
  };
  visit(value);
  return [...new Set(ids)].filter(id => id === 'LM' || /^RD[A-Za-z0-9_-]{2,158}$/.test(id));
}

function pickYouTubeMusicStationId(value) {
  const score = id => {
    if (id === 'RDMM') return 100;
    if (id.startsWith('RDTM')) return 95;
    if (id.startsWith('RDAMVM')) return 90;
    if (id.startsWith('RDCLAK')) return 85;
    if (id.startsWith('RDEM')) return 80;
    if (id.startsWith('RDAMPL')) return 65;
    if (id.startsWith('RD')) return 70;
    return 0;
  };
  return youtubeMusicStationIds(value).sort((left, right) => score(right) - score(left))[0] || '';
}

function youtubeMusicResponsiveTexts(renderer) {
  return (renderer?.flexColumns || [])
    .map(column => youtubeMusicText(column?.musicResponsiveListItemFlexColumnRenderer?.text))
    .filter(Boolean);
}

function youtubeMusicStationKind(stationId) {
  if (stationId === 'LM') return 'library';
  if (stationId === 'RDMM' || stationId.startsWith('RDTM') || stationId.startsWith('RDCLAK')) return 'mix';
  return 'radio';
}

function parseYouTubeMusicStationCard(renderer, section = '') {
  const stationId = pickYouTubeMusicStationId(renderer);
  if (!stationId) return null;
  const responsiveTexts = youtubeMusicResponsiveTexts(renderer);
  const title = youtubeMusicText(renderer.title) || responsiveTexts[0] || section || 'YouTube Music радио';
  const rawSubtitle = youtubeMusicText(renderer.subtitle) || responsiveTexts.slice(1).join(' · ');
  const subtitle = [section, rawSubtitle].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join(' · ');
  const thumbnail = youtubeMusicThumbnail(renderer);
  return {
    id: stationId,
    stationId,
    provider: 'youtube',
    source: 'youtube',
    title,
    subtitle: subtitle || 'YouTube Music',
    thumbnail,
    cover: thumbnail,
    kind: youtubeMusicStationKind(stationId),
    native: true,
    url: `https://music.youtube.com/playlist?list=${encodeURIComponent(stationId)}`,
  };
}

function extractYouTubeMusicStations(response) {
  const stations = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const carousel = node.musicCarouselShelfRenderer;
    if (carousel) {
      const header = carousel.header?.musicCarouselShelfBasicHeaderRenderer || {};
      const section = youtubeMusicText(header.title) || youtubeMusicText(header.strapline);
      for (const item of carousel.contents || []) {
        const renderer = item.musicTwoRowItemRenderer || item.musicResponsiveListItemRenderer;
        const station = renderer ? parseYouTubeMusicStationCard(renderer, section) : null;
        if (station) stations.push(station);
      }
      return;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(response);
  return stations;
}

function youtubeMusicDuration(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
  const parts = String(value || '').trim().split(':').map(Number);
  if (!parts.length || parts.some(part => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseYouTubeMusicStationTrack(renderer) {
  const videoId = String(renderer?.videoId || '').trim();
  const title = youtubeMusicText(renderer?.title);
  if (!/^[\w-]{11}$/.test(videoId) || !title) return null;
  const byline = youtubeMusicText(renderer.longBylineText || renderer.shortBylineText);
  const artist = byline.split(/\s*[•·]\s*/u).find(Boolean) || 'Unknown';
  return youtubeTrack({
    id: videoId,
    title,
    artist,
    duration: youtubeMusicDuration(youtubeMusicText(renderer.lengthText) || renderer.lengthSeconds),
    thumbnails: renderer.thumbnail?.thumbnails || [],
  });
}

function extractYouTubeMusicStationTracks(response, limit) {
  const tracks = [];
  const visit = node => {
    if (!node || typeof node !== 'object' || tracks.length >= limit * 2) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node.playlistPanelVideoRenderer) {
      const track = parseYouTubeMusicStationTrack(node.playlistPanelVideoRenderer);
      if (track) tracks.push(track);
      return;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(response);
  return uniqueTracks(tracks.filter(isWaveSongCandidate), limit);
}

function youtubeMusicPlaylistPanel(response) {
  const direct = response?.continuationContents?.playlistPanelContinuation;
  if (direct) return direct;
  let found = null;
  const visit = node => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node.playlistPanelRenderer) {
      found = node.playlistPanelRenderer;
      return;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(response);
  return found;
}

function youtubeMusicContinuationToken(response) {
  const panel = youtubeMusicPlaylistPanel(response);
  for (const continuation of panel?.continuations || []) {
    for (const key of ['nextRadioContinuationData', 'nextContinuationData', 'reloadContinuationData']) {
      const token = continuation?.[key]?.continuation;
      if (typeof token === 'string' && token) return token;
    }
  }

  const contents = panel?.contents || panel?.items || [];
  const last = contents.at?.(-1) || contents[contents.length - 1];
  const renderer = last?.continuationItemRenderer;
  const directToken = renderer?.continuationEndpoint?.continuationCommand?.token;
  if (typeof directToken === 'string' && directToken) return directToken;
  for (const command of renderer?.continuationEndpoint?.commandExecutorCommand?.commands || []) {
    const token = command?.continuationCommand?.token;
    if (typeof token === 'string' && token) return token;
  }
  return '';
}

async function loadYouTubeStationPages(stationId, poolLimit) {
  const payload = {
    enablePersistentPlaylistPanel: true,
    isAudioOnly: true,
    tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
    playlistId: stationId,
  };
  let response = await youtubeMusicReadRequest('next', payload);
  let tracks = extractYouTubeMusicStationTracks(response, poolLimit);
  let token = youtubeMusicContinuationToken(response);
  const seenTokens = new Set();
  let page = 1;

  while (token && tracks.length < poolLimit && page < 5 && !seenTokens.has(token)) {
    seenTokens.add(token);
    response = await youtubeMusicReadRequest('next', payload, true, {
      ctoken: token,
      continuation: token,
    });
    const additions = extractYouTubeMusicStationTracks(response, poolLimit);
    if (additions.length) tracks = uniqueTracks([...tracks, ...additions], poolLimit);
    const nextToken = youtubeMusicContinuationToken(response);
    page += 1;
    if (!nextToken || seenTokens.has(nextToken)) break;
    token = nextToken;
  }
  return tracks;
}

async function loadYouTubeStation(stationId, limit = MAX_WAVE_TRACKS) {
  const id = String(stationId || '').trim();
  if (id !== 'LM' && !/^RD[A-Za-z0-9_-]{2,158}$/.test(id)) throw new Error('Некорректная станция YouTube Music');
  const safeLimit = clampInteger(limit, 30, 1, MAX_WAVE_TRACKS);
  // The public Wave still returns at most MAX_WAVE_TRACKS, but selected native
  // stations keep a deeper private pool so subsequent refills can move past
  // the first Innertube page instead of looping over the same tracks.
  const poolLimit = safeLimit >= MAX_WAVE_TRACKS ? 120 : safeLimit;
  const cacheKey = `ytm:station:v2:${id}:${poolLimit}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let tracks;
  if (id === 'LM') {
    const library = await loadYouTubeLibrary();
    tracks = uniqueTracks((library.tracks || []).filter(isWaveSongCandidate), poolLimit);
  } else {
    tracks = await loadYouTubeStationPages(id, poolLimit);
  }
  if (tracks.length) cache.set(cacheKey, tracks, poolLimit > MAX_WAVE_TRACKS ? 300 : 90);
  return tracks;
}

async function loadYouTubeStations() {
  const cacheKey = 'ytm:stations:v1';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const [home, personalTracks] = await Promise.all([
    youtubeMusicReadRequest('browse', { browseId: 'FEmusic_home' }),
    loadYouTubeStation('RDMM', 1).catch(() => []),
  ]);
  const base = [
    {
      id: 'RDMM',
      stationId: 'RDMM',
      provider: 'youtube',
      source: 'youtube',
      title: 'Мой микс',
      subtitle: 'Персональный микс YouTube Music',
      thumbnail: personalTracks[0]?.thumbnail || null,
      cover: personalTracks[0]?.thumbnail || null,
      kind: 'mix',
      native: true,
      url: 'https://music.youtube.com/playlist?list=RDMM',
    },
    {
      id: 'LM',
      stationId: 'LM',
      provider: 'youtube',
      source: 'youtube',
      title: 'Понравившиеся',
      subtitle: 'Твой плейлист YouTube Music',
      thumbnail: null,
      cover: null,
      kind: 'library',
      native: true,
      url: 'https://music.youtube.com/playlist?list=LM',
    },
  ];
  const result = [];
  const seen = new Set();
  const seenTitles = new Set();
  for (const station of [...base, ...extractYouTubeMusicStations(home)]) {
    if (!station?.stationId || seen.has(station.stationId)) continue;
    const titleKey = normalizeText(station.title);
    if (titleKey && seenTitles.has(titleKey)) continue;
    seen.add(station.stationId);
    if (titleKey) seenTitles.add(titleKey);
    result.push(station);
    if (result.length >= 20) break;
  }
  if (result.length) cache.set(cacheKey, result, 300);
  return result;
}

function youtubeWaveSeedFromTrack(track) {
  for (const variant of [track, ...(Array.isArray(track?.variants) ? track.variants : [])]) {
    const videoId = youtubeVideoId(variant);
    if (videoId) return videoId;
  }
  return '';
}

async function resolveYouTubeWaveSeed(context) {
  const pool = [
    ...(context.currentTrack ? [context.currentTrack] : []),
    ...safeTrackList(context.queue, 8),
    ...safeTrackList(context.history, 12),
    ...safeTrackList(context.liked, 16),
  ];
  for (const track of pool) {
    const videoId = youtubeWaveSeedFromTrack(track);
    if (videoId) return videoId;
  }

  // A Yandex-only current track still gets a real YouTube Music radio: resolve
  // one exact YouTube seed first, then ask RDAMVM for its autoplay station.
  for (const track of pool.slice(0, 3)) {
    const query = trackQuery(track);
    if (!query) continue;
    try {
      const searched = await searchYouTube(query, 5);
      const ranked = (searched.tracks || [])
        .filter(isWaveSongCandidate)
        .map(candidate => ({ candidate, match: candidateMatchScore(track, candidate) }))
        .sort((left, right) => right.match.score - left.match.score);
      const seed = ranked.find(item => item.match.score >= 0.58)?.candidate || ranked[0]?.candidate;
      const videoId = youtubeWaveSeedFromTrack(seed);
      if (videoId) return videoId;
    } catch {}
  }
  return '';
}

async function loadYouTubeNativeWave(context, limit) {
  const videoId = await resolveYouTubeWaveSeed(context);
  if (!videoId) return [];
  try {
    const raw = await ytdlp([
      ...cookieArgs(),
      '--flat-playlist', '--dump-json', '--no-download', '--no-warnings',
      '--extractor-args', 'youtube:player_client=web_music',
      '--playlist-end', String(Math.min(MAX_WAVE_TRACKS, limit + 8)),
      `https://music.youtube.com/watch?v=${videoId}&list=RDAMVM${videoId}`,
    ], 22000);
    return parseYouTubeTracks(raw).filter(isWaveSongCandidate);
  } catch (err) {
    console.warn('YouTube Music radio failed:', err.message);
    return [];
  }
}

function buildWaveQueries(context, source) {
  const seed = String(context.seed || '').trim();
  const current = context.currentTrack ? [context.currentTrack] : [];
  const pool = [
    ...current,
    ...safeTrackList(context.queue, 12),
    ...safeTrackList(context.liked, 40),
    ...safeTrackList(context.history, 40),
  ];
  const queries = [];

  // Exact listening context must win over broad mood phrases. Otherwise the
  // first YouTube results are often hour-long compilations posing as tracks.
  if (current[0]) queries.push(trackQuery(current[0]), `${current[0].artist || ''} radio`.trim());
  if (seed) queries.push(seed);

  for (const artist of topArtists(pool, 5)) {
    queries.push(source === 'youtube' ? `${artist} songs` : artist);
  }

  for (const track of pool.slice(0, 8)) {
    const query = trackQuery(track);
    if (query) queries.push(source === 'youtube' ? `${query} radio` : query);
  }

  if (!queries.length) {
    queries.push(
      source === 'youtube' ? 'new music mix' : 'новая музыка',
      source === 'youtube' ? 'daily mix music' : 'плейлист дня',
      'indie pop electronic',
    );
  }

  return [...new Set(queries.map(q => q.trim()).filter(Boolean))].slice(0, 8);
}

function isWaveSongCandidate(track) {
  const duration = Number(track?.duration) || 0;
  const title = normalizeText(track?.title);
  const version = detectVersionType(track?.title);
  if (duration > 900 || (duration > 480 && version === 'mix')) return false;
  if (track?.source === 'youtube' && duration > 0 && duration < 35) return false;
  if (track?.source === 'youtube' && /(?:лучшая музыка|музыка в машину|хиты \d{4}|топ \d+|best tracks|top hits|full album|час музыки|сборник песен|текст(?: песни)?|radio remix|deep remix)/u.test(title)) return false;
  if (track?.source === 'youtube' && ['mix', 'live', 'lyrics', 'cover', 'karaoke', 'excerpt', 'remix'].includes(version)) return false;
  return true;
}

async function searchForWave(source, queries, limit) {
  const effectiveQueries = source === 'custom' ? queries.slice(0, 3) : queries;
  const perQuery = Math.max(6, Math.min(12, Math.ceil(limit / Math.max(1, effectiveQueries.length)) + 4));
  const searcher = source === 'yandex' ? searchYandex : source === 'youtube' ? searchYouTube : null;

  if (searcher) {
    const batches = await mapLimit(effectiveQueries, 2, async query => {
      try {
        const data = await searcher(query, perQuery);
        return (data.tracks || []).filter(isWaveSongCandidate);
      } catch (err) {
        console.warn(`Wave ${source} search failed [${query}]:`, err.message);
        return [];
      }
    });
    return uniqueTracks(interleaveLists(batches, limit * 2), limit);
  }

  // Custom Wave fans each query out to both providers, so keep the query set
  // deliberately small and run all three representative seeds in parallel.
  const batches = await mapLimit(effectiveQueries, 3, async query => {
    const [ym, yt] = await Promise.allSettled([
      searchYandex(query, perQuery),
      searchYouTube(query, perQuery),
    ]);
    return [
      ...(ym.status === 'fulfilled' ? ym.value.tracks : []),
      ...(yt.status === 'fulfilled' ? yt.value.tracks : []),
    ].filter(isWaveSongCandidate);
  });
  return canonicalizeTracks(uniqueTracks(interleaveLists(batches, limit * 2), limit * 2), queries[0] || '', limit);
}

function waveTrackKey(track) {
  const identity = trackIdentity(track);
  return `${identity.artist}|${identity.title}|${identity.versionType}`;
}

function continueStationAfterCurrent(tracks, context) {
  if (!tracks.length) return tracks;
  const anchors = [
    context?.currentTrack,
    ...safeTrackList(context?.history, 12),
  ].filter(Boolean);
  for (const anchor of anchors) {
    const key = waveTrackKey(anchor);
    const index = tracks.findIndex(track => waveTrackKey(track) === key);
    if (index >= 0) return [...tracks.slice(index + 1), ...tracks.slice(0, index + 1)];
  }
  return tracks;
}

function filterWaveCandidates(tracks, context, limit) {
  const contextTracks = [
    ...(context.currentTrack ? [context.currentTrack] : []),
    ...safeTrackList(context.queue, 30),
    ...safeTrackList(context.history, 8),
    ...safeTrackList(context.disliked, 100),
  ];
  const excluded = new Set(contextTracks.map(waveTrackKey));
  const excludedTitles = new Set(contextTracks.map(track => trackIdentity(track).title).filter(Boolean));
  const seenTitles = [];
  const artistCounts = new Map();
  const filtered = [];
  for (const track of uniqueTracks(tracks)) {
    if (!isWaveSongCandidate(track) || excluded.has(waveTrackKey(track))) continue;
    const identity = trackIdentity(track);
    if (!identity.title || [...excludedTitles].some(title => textSimilarity(identity.title, title) >= 0.84)) continue;
    if (seenTitles.some(title => textSimilarity(identity.title, title) >= 0.84)) continue;
    const artistCount = artistCounts.get(identity.artist) || 0;
    if (identity.artist && artistCount >= 3) continue;
    seenTitles.push(identity.title);
    if (identity.artist) artistCounts.set(identity.artist, artistCount + 1);
    filtered.push(track);
    if (filtered.length >= limit) break;
  }
  return filtered;
}

app.get('/api/wave/stations', async (req, res) => {
  const source = String(req.query.source || 'yandex').toLowerCase();
  if (!['yandex', 'youtube'].includes(source)) return res.status(400).json({ error: 'Unsupported station source', stations: [] });
  const scope = req.query.scope === 'all' ? 'all' : 'dashboard';
  const query = normalizeText(req.query.q || '');
  const limit = clampInteger(req.query.limit, scope === 'dashboard' ? 20 : 80, 1, 200);

  try {
    if (source === 'youtube') {
      const stations = await loadYouTubeStations();
      const filtered = query
        ? stations.filter(station => normalizeText(`${station.title} ${station.subtitle} ${station.kind}`).includes(query))
        : stations;
      return res.json({ source, scope: 'home', total: filtered.length, stations: filtered.slice(0, limit) });
    }
    const catalog = await loadYandexStationCatalog(scope);
    const filtered = query
      ? catalog.stations.filter(station => normalizeText(`${station.title} ${station.subtitle} ${station.type}`).includes(query))
      : catalog.stations;
    res.json({
      ...catalog,
      total: filtered.length,
      stations: filtered.slice(0, limit),
    });
  } catch (err) {
    console.error(`${source} stations error:`, err.message);
    res.status(502).json({ error: err.message, source, stations: [] });
  }
});

app.post('/api/wave', async (req, res) => {
  const source = ['custom', 'youtube', 'yandex'].includes(req.body?.source) ? req.body.source : 'custom';
  const limit = clampInteger(req.body?.limit, 30, 8, MAX_WAVE_TRACKS);
  const context = req.body?.context || {};
  const requestedStationId = String(req.body?.stationId || context.stationId || '').trim();
  const yandexStationId = source === 'yandex' && requestedStationId
    ? normalizeYandexStationId(requestedStationId)
    : '';
  const youtubeStationId = source === 'youtube' && requestedStationId && (requestedStationId === 'LM' || /^RD[A-Za-z0-9_-]{2,158}$/.test(requestedStationId))
    ? requestedStationId
    : '';
  const stationId = source === 'yandex' ? yandexStationId : source === 'youtube' ? youtubeStationId : '';
  if (source === 'yandex' && requestedStationId && !yandexStationId) {
    return res.status(400).json({ error: 'Invalid Yandex station id', tracks: [] });
  }
  if (source === 'youtube' && requestedStationId && !youtubeStationId) {
    return res.status(400).json({ error: 'Invalid YouTube Music station id', tracks: [] });
  }
  const cacheKey = `wave:v2:${source}:${crypto.createHash('sha1').update(JSON.stringify({
    stationId,
    seed: context.seed || '',
    current: context.currentTrack ? trackQuery(context.currentTrack) : '',
    queue: safeTrackList(context.queue, 16).map(trackQuery),
    liked: safeTrackList(context.liked, 12).map(trackQuery),
    history: safeTrackList(context.history, 12).map(trackQuery),
    disliked: safeTrackList(context.disliked, 30).map(trackQuery),
  })).digest('hex')}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const queries = buildWaveQueries(context, source);
    const searchQueries = source === 'custom' ? queries.slice(0, 3) : queries;
    const fetchLimit = Math.min(MAX_WAVE_TRACKS, limit + 10);
    let tracks = [];
    let native = false;
    let fallback = false;
    let station = null;

    if (source === 'yandex') {
      const selectedStationId = stationId || 'user:onyourwave';
      const [nativeTracks, stationInfo] = await Promise.all([
        loadYandexNativeWave(fetchLimit, selectedStationId, context),
        loadYandexStationInfo(selectedStationId).catch(() => null),
      ]);
      station = stationInfo;
      native = nativeTracks.length > 0;
      tracks = filterWaveCandidates(nativeTracks, context, limit);

      // Rotor can return a healthy payload that becomes almost empty after we
      // remove the current queue/history/dislikes. Top it up from search then.
      if (!stationId && tracks.length < Math.min(4, limit)) {
        fallback = true;
        const searchedTracks = await searchForWave('yandex', searchQueries, fetchLimit);
        tracks = filterWaveCandidates([...tracks, ...searchedTracks], context, limit);
      }
    } else if (source === 'youtube') {
      const nativeTracks = stationId
        ? await loadYouTubeStation(stationId, MAX_WAVE_TRACKS)
        : await loadYouTubeNativeWave(context, fetchLimit);
      if (stationId) {
        station = (await loadYouTubeStations().catch(() => [])).find(item => item.stationId === stationId) || null;
      }
      native = nativeTracks.length > 0;
      const stationTracks = stationId ? continueStationAfterCurrent(nativeTracks, context) : nativeTracks;
      tracks = filterWaveCandidates(stationTracks, context, limit);
      if (!stationId && tracks.length < Math.min(4, limit)) {
        fallback = true;
        const searchedTracks = await searchForWave('youtube', searchQueries, fetchLimit);
        tracks = filterWaveCandidates([...tracks, ...searchedTracks], context, limit);
      }
    } else {
      const [yandexRadio, youtubeRadio] = await Promise.all([
        loadYandexNativeWave(fetchLimit),
        loadYouTubeNativeWave(context, fetchLimit),
      ]);
      native = yandexRadio.length > 0 || youtubeRadio.length > 0;
      tracks = filterWaveCandidates(interleaveLists([youtubeRadio, yandexRadio], fetchLimit * 2), context, limit);
      if (tracks.length < Math.min(4, limit)) {
        fallback = true;
        const searchedTracks = await searchForWave('custom', searchQueries, fetchLimit);
        tracks = filterWaveCandidates([...tracks, ...searchedTracks], context, limit);
      }
    }

    if (!tracks.length && source !== 'custom' && !stationId) {
      fallback = true;
      tracks = await searchForWave('custom', searchQueries, fetchLimit);
    }

    tracks = filterWaveCandidates(tracks, context, limit);

    const result = {
      source,
      stationId: stationId || null,
      station,
      title: station?.title || (source === 'youtube' ? 'YouTube Music Mix' : source === 'yandex' ? 'Яндекс Волна' : 'Моя волна'),
      subtitle: station?.subtitle || (native
        ? (source === 'youtube' ? 'Радиостанция YouTube Music' : source === 'yandex' ? 'Нативная станция Яндекс.Музыки' : 'YouTube Music и Яндекс.Музыка в одном потоке')
        : 'Собрано по твоей истории, лайкам и текущему треку'),
      queries: searchQueries,
      native,
      fallback,
      tracks,
    };
    if (tracks.length) cache.set(cacheKey, result, 120);
    res.json(result);
  } catch (err) {
    console.error('Wave error:', err.message);
    res.status(500).json({ error: err.message, tracks: [] });
  }
});

// Lyrics API
app.get('/api/lyrics', async (req, res) => {
  const { title, artist, duration, ymId } = req.query;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const cacheKey = `lyrics:${artist || ''}:${title}:${ymId || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const cleanTitle = (title || '').replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
  const cleanArtist = (artist || '').split(',')[0].replace(/\s*-\s*Topic$/i, '').trim();
  const durParam = duration ? `&duration=${Math.round(duration)}` : '';

  const sources = [];

  const [ymRes, lrcGetRes, lrcSearchRes] = await Promise.allSettled([
    // Yandex lyrics
    (async () => {
      if (!ymId) return null;
      const id = String(ymId).replace('ym-', '');
      const sup = await ymApi(`/tracks/${id}/supplement`);
      const l = sup.lyrics || sup.result?.lyrics;
      if (l && (l.fullLyrics || l.syncLyrics)) {
        return {
          id: 'yandex',
          name: 'Яндекс.Музыка',
          synced: Boolean(l.syncLyrics),
          syncedLyrics: l.syncLyrics || null,
          plainLyrics: l.fullLyrics || '',
        };
      }
      return null;
    })(),

    // LRCLIB direct match
    (async () => {
      const lrcUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(cleanArtist)}&track_name=${encodeURIComponent(cleanTitle)}${durParam}`;
      const r = await httpRequest(lrcUrl, { headers: { 'User-Agent': 'Listenfold/0.1' }, timeout: 4000 });
      if (r.status === 200) {
        const data = JSON.parse(r.data);
        if (data.plainLyrics || data.syncedLyrics) {
          return {
            id: 'lrclib_direct',
            name: 'LRCLIB (Синхронизировано)',
            synced: Boolean(data.syncedLyrics),
            syncedLyrics: data.syncedLyrics || null,
            plainLyrics: data.plainLyrics || '',
          };
        }
      }
      return null;
    })(),

    // LRCLIB search fallback
    (async () => {
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanArtist} ${cleanTitle}`)}`;
      const sr = await httpRequest(searchUrl, { headers: { 'User-Agent': 'Listenfold/0.1' }, timeout: 4000 });
      if (sr.status === 200) {
        const items = JSON.parse(sr.data);
        if (Array.isArray(items) && items.length > 0) {
          const item = items.find(i => i.syncedLyrics) || items[0];
          if (item && (item.plainLyrics || item.syncedLyrics)) {
            return {
              id: 'lrclib_search',
              name: 'LRCLIB Поиск',
              synced: Boolean(item.syncedLyrics),
              syncedLyrics: item.syncedLyrics || null,
              plainLyrics: item.plainLyrics || '',
            };
          }
        }
      }
      return null;
    })(),
  ]);

  if (ymRes.status === 'fulfilled' && ymRes.value) sources.push(ymRes.value);
  if (lrcGetRes.status === 'fulfilled' && lrcGetRes.value) sources.push(lrcGetRes.value);
  if (lrcSearchRes.status === 'fulfilled' && lrcSearchRes.value) {
    if (!sources.some(s => s.syncedLyrics === lrcSearchRes.value.syncedLyrics)) {
      sources.push(lrcSearchRes.value);
    }
  }

  const defaultSource = sources.find(s => s.synced) || sources[0] || null;

  const result = {
    sources,
    defaultSource: defaultSource ? defaultSource.id : null,
    syncedLyrics: defaultSource?.syncedLyrics || null,
    plainLyrics: defaultSource?.plainLyrics || null,
  };

  cache.set(cacheKey, result, 600);
  res.json(result);
});

// Playlists & collections
function remoteUrl(value) {
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw new Error('Invalid playlist URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid playlist URL');
  if (!isYandexUrl(parsed.href) && !isYouTubeUrl(parsed.href)) throw new Error('Unsupported music service URL');
  return parsed.href;
}

function parseYouTubeTracks(raw) {
  return raw.trim().split('\n').filter(Boolean).map(line => {
    try { return youtubeTrack(JSON.parse(line)); } catch { return null; }
  }).filter(Boolean);
}

async function loadPlaylist(inputUrl, options = {}) {
  const url = remoteUrl(inputUrl);
  const limit = options.limit == null ? null : clampInteger(options.limit, MAX_RESCUE_TRACKS, 1, MAX_RESCUE_TRACKS);
  const cacheKey = `playlist:v2:${limit || 'all'}:${url}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const trackMatch = url.match(/track\/(\d+)/);
  if (trackMatch && isYandexUrl(url)) {
    const trackId = trackMatch[1];
    const data = await ymApi(`/tracks/${trackId}`);
    const rawTrack = (data.result || data)?.[0];
    if (!rawTrack) throw new Error('Track not found');
    const track = ymTrack(rawTrack);
    const result = {
      title: track.title,
      artist: track.artist,
      cover: track.thumbnail || null,
      trackCount: 1,
      duration: track.duration || 0,
      tracks: [track],
      type: 'track',
      source: 'yandex',
      url,
    };
    cache.set(cacheKey, result, 600);
    return result;
  }

  const albumMatch = url.match(/album\/(\d+)/);
  if (albumMatch && isYandexUrl(url)) {
    const albumId = albumMatch[1];
    const data = await ymApi(`/albums/${albumId}/with-tracks`);
    const album = data.result || data;
    const tracks = (album.volumes || []).flat().map(ymTrack).slice(0, limit || undefined);
    const result = {
      title: album.title || `Альбом #${albumId}`,
      artist: (album.artists || []).map(a => a.name).join(', ') || '',
      year: album.year || null,
      genre: album.genre || null,
      cover: album.ogImage
        ? `https://${album.ogImage.replace('%%', '1000x1000')}`
        : (album.coverUri ? `https://${album.coverUri.replace('%%', '1000x1000')}` : (tracks[0]?.thumbnail || null)),
      trackCount: tracks.length,
      duration: tracks.reduce((sum, track) => sum + (track.duration || 0), 0),
      tracks,
      type: 'album',
      source: 'yandex',
      url,
    };
    cache.set(cacheKey, result, 600);
    return result;
  }

  const playlistMatch = url.match(/users\/([^/]+)\/playlists\/(\d+)/);
  if (playlistMatch && isYandexUrl(url)) {
    const [, user, kind] = playlistMatch;
    const data = await ymApi(`/users/${encodeURIComponent(decodeURIComponent(user))}/playlists/${kind}`);
    const playlist = data.result || data;
    const tracks = (playlist.tracks || []).map(item => ymTrack(item.track || item)).slice(0, limit || undefined);
    const result = {
      title: playlist.title || 'Плейлист',
      owner: playlist.owner?.name || playlist.owner?.login || '',
      cover: playlist.ogImage
        ? `https://${playlist.ogImage.replace('%%', '1000x1000')}`
        : (playlist.cover?.uri ? `https://${playlist.cover.uri.replace('%%', '1000x1000')}` : (tracks[0]?.thumbnail || null)),
      trackCount: tracks.length,
      duration: tracks.reduce((sum, track) => sum + (track.duration || 0), 0),
      tracks,
      type: 'playlist',
      source: 'yandex',
      url,
    };
    cache.set(cacheKey, result, 600);
    return result;
  }

  const args = [
    ...cookieArgs(),
    '--extractor-args', 'youtube:player_client=web_music',
    '--dump-json', '--flat-playlist', '--no-download', '--no-warnings',
  ];
  if (limit) args.push('--playlist-end', String(limit));
  args.push('--', url);
  const raw = await ytdlp(args, 30000);
  const tracks = parseYouTubeTracks(raw).slice(0, limit || undefined);
  const result = {
    title: 'Плейлист YouTube Music',
    cover: tracks[0]?.thumbnail || null,
    trackCount: tracks.length,
    duration: tracks.reduce((sum, track) => sum + (track.duration || 0), 0),
    tracks,
    type: 'playlist',
    source: 'youtube',
    url,
  };
  cache.set(cacheKey, result, 600);
  return result;
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

app.get('/api/playlist', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    res.json(await loadPlaylist(url));
  } catch (err) {
    console.error('Playlist load error:', err.message);
    res.status(500).json({ error: err.message, tracks: [] });
  }
});

app.post('/api/rescue', async (req, res) => {
  const { url, limit } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL required' });
  const safeLimit = clampInteger(limit, 30, 1, MAX_RESCUE_TRACKS);

  try {
    const playlist = await loadPlaylist(url, { limit: safeLimit });
    const originals = playlist.tracks.slice(0, safeLimit);
    const oppositeSource = playlist.source === 'yandex' ? 'youtube' : 'yandex';
    let providerFailure = null;
    const results = await mapLimit(originals, 3, async original => {
      if (providerFailure) throw providerFailure;
      const identity = trackIdentity(original);
      const query = `${original.artist || ''} ${identity.title || original.title}`.trim();
      let search;
      try {
        search = oppositeSource === 'yandex'
          ? await searchYandex(query, 7)
          : await searchYouTube(query, 7);
      } catch (err) {
        providerFailure = err;
        throw err;
      }
      const ranked = search.tracks
        .map(track => ({ track: plainTrack(track), score: candidateMatchScore(original, track) }))
        .sort((a, b) => b.score.score - a.score.score);
      const best = ranked[0] || null;
      const highConfidence = Boolean(best
        && best.score.score >= 0.86
        && best.score.title >= 0.88
        && !best.score.titleContainmentMismatch
        && !best.score.versionMismatch);
      const status = highConfidence ? 'matched' : (best && best.score.score >= 0.6 ? 'ambiguous' : 'missing');
      const confidence = best ? Number(best.score.score.toFixed(3)) : 0;
      const canonical = highConfidence
        ? canonicalTrack([original, best.track], query, best.score.score)
        : canonicalTrack([original], query);
      const item = {
        original: plainTrack(original),
        status,
        confidence,
      };
      if (highConfidence) item.match = best.track;
      else item.candidates = ranked.slice(0, 3).map(candidate => ({
        ...candidate.track,
        confidence: Number(candidate.score.score.toFixed(3)),
      }));
      return { item, canonical };
    });

    const items = results.map(result => result.item);
    const summary = {
      total: items.length,
      matched: items.filter(item => item.status === 'matched').length,
      ambiguous: items.filter(item => item.status === 'ambiguous').length,
      missing: items.filter(item => item.status === 'missing').length,
    };
    res.json({
      playlist,
      summary,
      items,
      tracks: results.map(result => result.canonical),
    });
  } catch (err) {
    console.error('Playlist rescue error:', err.message);
    const unavailable = err.code === 'PROVIDER_UNAVAILABLE';
    res.status(unavailable ? 502 : 500).json({
      error: err.message,
      ...(unavailable ? { code: err.code, provider: err.provider } : {}),
    });
  }
});

// User libraries
async function loadYandexLibrary() {
  const cacheKey = 'lib:yandex';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const acc = await ymApi('/account/status');
  const account = acc.result?.account || acc.account;
  const uid = account?.uid;
  const displayName = account?.fullName || account?.displayName || 'Моя музыка';
  if (!uid) throw new Error('Пользователь Яндекс.Музыки не найден в сессии');

  const likesData = await ymApi(`/users/${uid}/likes/tracks`);
  const trackItems = likesData.result?.library?.tracks || likesData.library?.tracks || [];
  const trackIds = trackItems.map(track => track.id).filter(Boolean).slice(0, MAX_LIBRARY_TRACKS);
  const tracks = [];
  const batchSize = 50;

  for (let i = 0; i < trackIds.length; i += batchSize) {
    const batch = trackIds.slice(i, i + batchSize);
    const body = `track-ids=${batch.join(',')}`;
    try {
      const batchData = await ymApi('/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const list = Array.isArray(batchData) ? batchData : (batchData.result || []);
      tracks.push(...list.map(ymTrack));
    } catch (err) {
      console.warn('Track batch error:', err.message);
    }
  }

  const result = { tracks, username: displayName };
  cache.set(cacheKey, result, 180);
  return result;
}

async function loadYouTubeLibrary() {
  const cacheKey = 'lib:youtube';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const health = getCookieHealth();
  if (!health.youtubeSession) {
    return {
      tracks: [],
      username: 'YouTube Music',
      unauthenticated: true,
      error: 'Требуется авторизация в YouTube Music для просмотра понравившихся треков',
    };
  }

  const raw = await ytdlp([
    ...cookieArgs(),
    '--extractor-args', 'youtube:player_client=web_music',
    'https://music.youtube.com/playlist?list=LM',
    '--dump-json', '--flat-playlist', '--no-download', '--no-warnings',
    '--playlist-end', String(MAX_LIBRARY_TRACKS),
  ], 30000);
  const tracks = parseYouTubeTracks(raw).slice(0, MAX_LIBRARY_TRACKS);
  const result = { tracks, username: 'Liked Music' };
  cache.set(cacheKey, result, 180);
  return result;
}

function providerCookieString(patterns) {
  const cookies = new Map();
  for (const [domain, values] of Object.entries(parsedCookies)) {
    if (!patterns.some(pattern => domain.includes(pattern))) continue;
    for (const [name, value] of Object.entries(values)) {
      if (!cookies.has(name)) cookies.set(name, value);
    }
  }
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function providerCookieValue(names, patterns) {
  const wanted = new Set(names);
  for (const [domain, values] of Object.entries(parsedCookies)) {
    if (!patterns.some(pattern => domain.includes(pattern))) continue;
    for (const [name, value] of Object.entries(values)) {
      if (wanted.has(name) && value) return value;
    }
  }
  return '';
}

function sanitizeLikeTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const clean = value => typeof value === 'string' ? value.slice(0, 600) : value;
  const sanitizeVariant = variant => {
    const value = variant?.track || variant;
    if (!value || typeof value !== 'object') return null;
    return {
      id: clean(value.id),
      ymId: clean(value.ymId),
      videoId: clean(value.videoId),
      title: clean(value.title),
      artist: clean(value.artist),
      url: clean(value.url),
      source: ['youtube', 'yandex'].includes(value.source) ? value.source : null,
      duration: Number(value.duration) || 0,
    };
  };
  const track = sanitizeVariant(raw);
  if (!track?.title) return null;
  track.variants = (Array.isArray(raw.variants) ? raw.variants : [])
    .slice(0, 12)
    .map(sanitizeVariant)
    .filter(Boolean);
  return track;
}

function youtubeVideoId(track) {
  const direct = String(track?.videoId || '').trim();
  if (/^[\w-]{11}$/.test(direct)) return direct;
  const sourceId = track?.source === 'youtube' ? String(track.id || '').trim() : '';
  if (/^[\w-]{11}$/.test(sourceId)) return sourceId;
  try {
    const parsed = new URL(track?.url || '');
    if (/(^|\.)youtube\.com$/.test(parsed.hostname)) {
      const videoId = parsed.searchParams.get('v');
      if (/^[\w-]{11}$/.test(videoId || '')) return videoId;
    }
  } catch {}
  return '';
}

function yandexTrackId(track) {
  const direct = String(track?.ymId || '').trim();
  if (/^\d+$/.test(direct)) return direct;
  const sourceId = track?.source === 'yandex' ? String(track.id || '').replace(/^ym-/, '') : '';
  if (/^\d+$/.test(sourceId)) return sourceId;
  try {
    const parsed = new URL(track?.url || '');
    if (/(^|\.)yandex\.(?:ru|com|by|kz)$/.test(parsed.hostname)) {
      const match = parsed.pathname.match(/\/track\/(\d+)/);
      if (match) return match[1];
    }
  } catch {}
  return '';
}

async function resolveLikeCandidate(track, provider) {
  const variants = [track, ...(track.variants || [])];
  const getId = provider === 'youtube' ? youtubeVideoId : yandexTrackId;
  const exact = variants.find(variant => variant?.source === provider && getId(variant));
  if (exact) return { track: exact, providerId: getId(exact), matched: false };

  const query = trackQuery(track);
  const result = provider === 'youtube'
    ? await searchYouTube(query, 8)
    : await searchYandex(query, 8);
  const ranked = (result.tracks || [])
    .map(candidate => ({ candidate, match: candidateMatchScore(track, candidate) }))
    .sort((left, right) => right.match.score - left.match.score);
  const best = ranked[0];
  if (!best || best.match.score < 0.78 || !getId(best.candidate)) {
    throw new Error('Точное совпадение трека не найдено');
  }
  return { track: best.candidate, providerId: getId(best.candidate), matched: true };
}

async function getYouTubeMusicConfig(force = false) {
  if (!force) {
    const cached = cache.get('ytm:innertube-config');
    if (cached) return cached;
  }
  const cookie = providerCookieString(['youtube', 'google']);
  if (!cookie) throw new Error('Нет активной сессии YouTube Music');
  const response = await httpRequest('https://music.youtube.com/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.7',
      Cookie: cookie,
    },
    timeout: 15000,
    maxBytes: 5 * 1024 * 1024,
  });
  if (response.status !== 200) throw new Error(`YouTube Music ${response.status}`);
  const read = pattern => response.data.match(pattern)?.[1] || '';
  const config = {
    apiKey: read(/"INNERTUBE_API_KEY":"([^"]+)"/),
    clientVersion: read(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/),
    clientName: Number(read(/"INNERTUBE_CONTEXT_CLIENT_NAME":(\d+)/)) || 67,
    visitorData: read(/"VISITOR_DATA":"([^"]+)"/),
  };
  if (!config.apiKey || !config.clientVersion) throw new Error('YouTube Music не отдал конфигурацию API');
  cache.set('ytm:innertube-config', config, 1800);
  return config;
}

async function likeYouTubeTrack(videoId, retryAuth = true) {
  const origin = 'https://music.youtube.com';
  const cookie = providerCookieString(['youtube', 'google']);
  const sapisid = providerCookieValue(['__Secure-3PAPISID', 'SAPISID'], ['youtube', 'google']);
  if (!cookie || !sapisid) throw new Error('Нужен вход в YouTube Music');
  const config = await getYouTubeMusicConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`${timestamp} ${sapisid} ${origin}`).digest('hex');
  const authUser = providerCookieValue(['SESSION_INDEX'], ['youtube', 'google']) || '0';
  const body = JSON.stringify({
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: config.clientVersion,
        hl: 'ru',
        gl: 'RU',
        ...(config.visitorData ? { visitorData: config.visitorData } : {}),
      },
      user: {},
    },
    target: { videoId },
  });
  const response = await httpRequest(`${origin}/youtubei/v1/like/like?alt=json&key=${encodeURIComponent(config.apiKey)}&prettyPrint=false`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Origin: origin,
      Referer: `${origin}/`,
      Cookie: cookie,
      Authorization: `SAPISIDHASH ${timestamp}_${signature}`,
      'X-Origin': origin,
      'X-Goog-AuthUser': String(authUser),
      'X-Youtube-Client-Name': String(config.clientName),
      'X-Youtube-Client-Version': config.clientVersion,
      'X-Youtube-Bootstrap-Logged-In': 'true',
      ...(config.visitorData ? { 'X-Goog-Visitor-Id': config.visitorData } : {}),
    },
    body,
    timeout: 15000,
    maxBytes: 2 * 1024 * 1024,
  });
  if (response.status === 401 && retryAuth) {
    const refreshed = exportChromeCookies();
    if (refreshed.ok) {
      parseCookies();
      cache.del('ytm:innertube-config');
      return likeYouTubeTrack(videoId, false);
    }
  }
  if (response.status !== 200) throw new Error(`YouTube Music API ${response.status}`);
}

async function syncProviderLike(track, provider) {
  const resolved = await resolveLikeCandidate(track, provider);
  const libraryCache = cache.get(`lib:${provider}`);
  const already = Boolean(libraryCache?.tracks?.some(candidate => {
    const id = provider === 'youtube' ? youtubeVideoId(candidate) : yandexTrackId(candidate);
    return id && id === resolved.providerId;
  }));
  if (already) return { provider, status: 'already', matched: resolved.matched };

  if (provider === 'youtube') {
    await likeYouTubeTrack(resolved.providerId);
  } else {
    const accountData = await ymApi('/account/status');
    const account = accountData.result?.account || accountData.account;
    if (!account?.uid) throw new Error('Нужен вход в Яндекс.Музыку');
    await ymApi(`/users/${account.uid}/likes/tracks/add-multiple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `track-ids=${encodeURIComponent(resolved.providerId)}`,
    });
  }

  cache.del(`lib:${provider}`);
  cache.del('lib:map:v2');
  return { provider, status: 'synced', matched: resolved.matched };
}

app.post('/api/library/like-all', async (req, res) => {
  const track = sanitizeLikeTrack(req.body?.track);
  if (!track) return res.status(400).json({ error: 'Некорректный трек' });

  const providers = ['yandex', 'youtube'];
  const settled = await Promise.allSettled(providers.map(provider => syncProviderLike(track, provider)));
  const results = settled.map((result, index) => result.status === 'fulfilled'
    ? result.value
    : { provider: providers[index], status: 'failed', message: result.reason?.message || 'Ошибка синхронизации' });
  res.json({ ok: results.some(result => result.status !== 'failed'), results });
});

app.get('/api/library/yandex', async (req, res) => {
  try {
    res.json(await loadYandexLibrary());
  } catch (err) {
    console.error('Yandex library error:', err.message);
    res.status(500).json({ error: err.message, tracks: [] });
  }
});

app.get('/api/library/youtube', async (req, res) => {
  try {
    res.json(await loadYouTubeLibrary());
  } catch (err) {
    console.error('YouTube library error:', err.message);
    res.status(500).json({ error: err.message, tracks: [] });
  }
});

app.get('/api/library/map', async (req, res) => {
  const cached = cache.get('lib:map:v2');
  if (cached) return res.json(cached);

  const [yandexResult, youtubeResult] = await Promise.allSettled([
    loadYandexLibrary(),
    loadYouTubeLibrary(),
  ]);
  if (yandexResult.status === 'rejected' && youtubeResult.status === 'rejected') {
    return res.status(502).json({ error: 'Both music libraries are unavailable' });
  }

  const yandexTracks = yandexResult.status === 'fulfilled' ? yandexResult.value.tracks.slice(0, MAX_LIBRARY_TRACKS) : [];
  const youtubeTracks = youtubeResult.status === 'fulfilled' ? youtubeResult.value.tracks.slice(0, MAX_LIBRARY_TRACKS) : [];
  const groups = canonicalizeTracks([...yandexTracks, ...youtubeTracks]);
  const overlap = groups.filter(group => group.sources.includes('yandex') && group.sources.includes('youtube'));
  const yandexOnly = groups.filter(group => group.sources.length === 1 && group.sources[0] === 'yandex');
  const youtubeOnly = groups.filter(group => group.sources.length === 1 && group.sources[0] === 'youtube');
  const result = {
    summary: {
      total: yandexTracks.length + youtubeTracks.length,
      canonicalTotal: groups.length,
      yandexTotal: yandexTracks.length,
      youtubeTotal: youtubeTracks.length,
      overlap: overlap.length,
      yandexOnly: yandexOnly.length,
      youtubeOnly: youtubeOnly.length,
      capPerSource: MAX_LIBRARY_TRACKS,
    },
    availability: {
      yandex: yandexResult.status === 'fulfilled',
      youtube: youtubeResult.status === 'fulfilled',
    },
    overlap,
    yandexOnly,
    youtubeOnly,
  };
  cache.set('lib:map:v2', result, 180);
  res.json(result);
});

// Audio playback & streaming
const activeDownloads = new Map();

function isYandexUrl(url) {
  try {
    const parsed = new URL(String(url));
    return ['http:', 'https:'].includes(parsed.protocol)
      && /^music\.yandex\.(ru|com|by|kz)$/.test(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isYouTubeUrl(url) {
  try {
    const parsed = new URL(String(url));
    return ['http:', 'https:'].includes(parsed.protocol)
      && ['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be'].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function playbackUrl(value) {
  const input = String(value || '').trim();
  if (/^ym-\d+$/.test(input)) return input;
  let parsed;
  try { parsed = new URL(input); } catch { throw new Error('Invalid track URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid track URL');
  if (!isYandexUrl(parsed.href) && !isYouTubeUrl(parsed.href)) throw new Error('Unsupported music service URL');
  return parsed.href;
}

function unlinkQuietly(filePath) {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
}

async function downloadHttpsToFile(url, tmpPath, finalPath, timeoutMs = 45000) {
  unlinkQuietly(tmpPath);
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const redirectStatuses = new Set([301, 302, 303, 307, 308]);
    let request = null;
    let response = null;
    let output = null;
    let timer = null;
    let settled = false;

    const settle = err => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (!err) return resolve();

      if (response && !response.destroyed) response.destroy();
      if (output && !output.destroyed) {
        output.once('close', () => unlinkQuietly(tmpPath));
        output.destroy();
      }
      if (request && !request.destroyed) request.destroy();
      unlinkQuietly(tmpPath);
      reject(err);
    };

    const startDownload = (currentUrl, redirects = 0) => {
      if (settled) return;

      try {
        const parsed = new URL(currentUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return settle(new Error('Unsupported Yandex audio redirect protocol'));
        }

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return settle(new Error('Yandex audio download timeout'));

        const transport = parsed.protocol === 'https:' ? https : http;
        const currentRequest = transport.get(parsed, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: remainingMs,
        }, incoming => {
          if (settled) {
            incoming.destroy();
            return;
          }
          response = incoming;

          if (redirectStatuses.has(incoming.statusCode) && incoming.headers.location) {
            incoming.resume();
            if (redirects >= 5) return settle(new Error('Too many Yandex audio redirects'));

            let nextUrl;
            try {
              nextUrl = new URL(incoming.headers.location, parsed).href;
            } catch {
              return settle(new Error('Invalid Yandex audio redirect URL'));
            }

            response = null;
            request = null;
            startDownload(nextUrl, redirects + 1);
            return;
          }

          incoming.once('aborted', () => {
            if (response === incoming) settle(new Error('Yandex audio download aborted'));
          });
          incoming.once('error', err => {
            if (response === incoming) settle(err);
          });
          if (incoming.statusCode !== 200) {
            incoming.resume();
            return settle(new Error(`Yandex audio HTTP ${incoming.statusCode}`));
          }

          output = fs.createWriteStream(tmpPath, { flags: 'wx', mode: 0o600 });
          output.once('error', settle);
          pipeline(incoming, output).then(() => {
            if (!incoming.complete) return settle(new Error('Incomplete Yandex audio response'));
            settle();
          }, settle);
        });

        request = currentRequest;
        currentRequest.once('error', err => {
          if (request === currentRequest) settle(err);
        });
        currentRequest.once('timeout', () => {
          if (request === currentRequest) settle(new Error('Yandex audio download timeout'));
        });
      } catch (err) {
        settle(err);
      }
    };

    timer = setTimeout(() => settle(new Error('Yandex audio download timeout')), timeoutMs);
    startDownload(url);
  });

  try {
    fs.renameSync(tmpPath, finalPath);
    fs.chmodSync(finalPath, 0o600);
  } catch (err) {
    unlinkQuietly(tmpPath);
    throw err;
  }
}

async function prepareYandexTrack(url) {
  const match = url.match(/track\/(\d+)/) || url.match(/ym-(\d+)/) || url.match(/(\d{6,12})/);
  if (!match) throw new Error('Invalid Yandex Track URL');
  const trackId = match[1];
  const hash = crypto.createHash('md5').update(url).digest('hex');
  const filePath = path.join(audioDir, `${hash}.mp3`);

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 10000) return filePath;
  if (activeDownloads.has(url)) return activeDownloads.get(url);

  const dlPromise = (async () => {
    try {
      const dlInfo = await ymApi(`/tracks/${trackId}/download-info`);
      const list = Array.isArray(dlInfo) ? dlInfo : (dlInfo.result || []);
      const codecInfo = list.find(i => i.codec === 'mp3' && i.bitrateInKbps >= 192)
        || list.find(i => i.codec === 'mp3');
      if (!codecInfo?.downloadInfoUrl) throw new Error('Yandex MP3 download is unavailable');

      const infoUrl = new URL(codecInfo.downloadInfoUrl);
      infoUrl.searchParams.set('format', 'json');
      const infoRes = await httpRequest(infoUrl.href);
      if (infoRes.status !== 200) throw new Error(`Yandex download-info HTTP ${infoRes.status}`);
      const info = JSON.parse(infoRes.data);
      if (!info.host || !info.path || !info.s || !info.ts) throw new Error('Invalid Yandex download-info response');

      const sign = crypto.createHash('md5').update('XGRlBW9FXlekgbPrRHuSiA' + info.path.slice(1) + info.s).digest('hex');
      const downloadUrl = `https://${info.host}/get-mp3/${sign}/${info.ts}${info.path}`;
      const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      await downloadHttpsToFile(downloadUrl, tmp, filePath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 10000) return filePath;
      unlinkQuietly(filePath);
      throw new Error('Downloaded Yandex audio is empty');
    } catch (err) {
      console.warn(`Direct Yandex audio unavailable for ${trackId}:`, err.message);
      throw err;
    }
  })();

  activeDownloads.set(url, dlPromise);
  dlPromise.then(() => activeDownloads.delete(url), () => activeDownloads.delete(url));
  return dlPromise;
}

const AUDIO_CONTAINER_EXTS = ['.m4a', '.webm', '.opus', '.mp3', '.ogg', '.mp4'];

function findExistingAudioFile(basePath) {
  for (const ext of AUDIO_CONTAINER_EXTS) {
    const p = `${basePath}${ext}`;
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 10000) return p;
    } catch {}
  }
  return null;
}

async function prepareYouTubeTrack(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  const baseFilePath = path.join(audioDir, hash);

  const existing = findExistingAudioFile(baseFilePath);
  if (existing) return existing;

  if (activeDownloads.has(url)) return activeDownloads.get(url);

  const promise = (async () => {
    // 3 parallel extraction strategies (race: fastest valid stream wins)
    const strategies = [
      {
        name: 'tv_creator',
        args: ['--extractor-args', 'youtube:player_client=tv_embedded,web_creator', '-f', 'ba/b'],
      },
      {
        name: 'android_ios',
        args: ['--extractor-args', 'youtube:player_client=android,ios,web', '-f', 'ba/b'],
      },
      {
        name: 'standard_dlp',
        args: ['-f', 'ba/b'],
      },
    ];

    return new Promise((resolve, reject) => {
      const activeProcs = new Set();
      const stratBases = [];
      let finished = false;
      let completed = 0;
      const errors = [];

      const cleanup = (winnerProc = null) => {
        for (const p of activeProcs) {
          if (p !== winnerProc) {
            try { process.platform === 'win32' ? p.kill() : p.kill('SIGKILL'); } catch {}
          }
        }
        activeProcs.clear();
      };

      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          cleanup();
          reject(new Error('Время ожидания загрузки аудио истекло (все стратегии превысили таймаут)'));
        }
      }, 55000);

      strategies.forEach((strat, index) => {
        const stratBase = `${baseFilePath}_s${index}`;
        stratBases.push(stratBase);
        const template = `${stratBase}.%(ext)s`;

        const proc = spawn(ytdlpBinary, [
          ...cookieArgs(),
          ...strat.args,
          '-o', template,
          '--no-playlist', '--no-warnings', '--no-progress',
          '--', url,
        ], { windowsHide: true });

        activeProcs.add(proc);
        let stderr = '';
        proc.stderr?.on('data', d => (stderr += d.toString()));

        proc.on('close', code => {
          activeProcs.delete(proc);
          completed++;

          if (finished) {
            const residual = findExistingAudioFile(stratBase);
            if (residual) unlinkQuietly(residual);
            return;
          }

          const downloaded = findExistingAudioFile(stratBase);
          if (code === 0 && downloaded) {
            finished = true;
            clearTimeout(timer);
            cleanup(proc);

            const ext = path.extname(downloaded);
            const finalPath = `${baseFilePath}${ext}`;
            try {
              fs.renameSync(downloaded, finalPath);
              resolve(finalPath);
            } catch {
              resolve(downloaded);
            }

            // Cleanup any leftovers from other strategy files
            stratBases.forEach(base => {
              if (base !== stratBase) {
                const residual = findExistingAudioFile(base);
                if (residual) unlinkQuietly(residual);
              }
            });
            return;
          }

          const errBrief = stderr.slice(0, 180).trim() || `exit ${code}`;
          errors.push(`[${strat.name}]: ${errBrief}`);

          if (completed >= strategies.length) {
            finished = true;
            clearTimeout(timer);
            cleanup();

            const hasBotBlock = errors.some(e => /bot|403|Sign in to confirm/i.test(e));
            const msg = hasBotBlock
              ? 'YouTube заблокировал скачивание на данном IP (проверка на бота/403). Авторизуйтесь в YouTube Music в настройках приложения.'
              : `Не удалось загрузить аудио (${errors.join('; ')})`;
            reject(new Error(msg));
          }
        });

        proc.on('error', err => {
          activeProcs.delete(proc);
          completed++;
          if (!finished) {
            errors.push(`[${strat.name}]: ${err.message}`);
            if (completed >= strategies.length) {
              finished = true;
              clearTimeout(timer);
              cleanup();
              reject(new Error(`Сбой процессов загрузки: ${errors.join('; ')}`));
            }
          }
        });
      });
    });
  })();

  activeDownloads.set(url, promise);
  promise.then(() => activeDownloads.delete(url), () => activeDownloads.delete(url));
  return promise;
}

function parseByteRange(header, fileSize) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) return { invalid: true };

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= fileSize || end < start) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, fileSize - 1), invalid: false };
}

app.get('/api/audio', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  let safeUrl;
  try { safeUrl = playbackUrl(url); } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const yandexSource = isYandexUrl(safeUrl) || /^ym-\d+$/.test(safeUrl);
    const filePath = yandexSource ? await prepareYandexTrack(safeUrl) : await prepareYouTubeTrack(safeUrl);
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.mp3' ? 'audio/mpeg'
      : ext === '.webm' ? 'audio/webm'
      : ['.opus', '.ogg'].includes(ext) ? 'audio/ogg'
      : ext === '.aac' ? 'audio/aac'
      : 'audio/mp4';

    const range = parseByteRange(req.headers.range, fileSize);
    if (range?.invalid) {
      return res.status(416)
        .set('Content-Range', `bytes */${fileSize}`)
        .set('Accept-Ranges', 'bytes')
        .end();
    }

    const commonHeaders = {
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'X-Listenfold-Audio-Source': yandexSource ? 'yandex' : 'youtube',
      'X-Listenfold-Container': ext.slice(1) || 'unknown',
    };
    const streamOptions = range ? { start: range.start, end: range.end } : undefined;
    const contentLength = range ? range.end - range.start + 1 : fileSize;
    res.writeHead(range ? 206 : 200, {
      ...commonHeaders,
      'Content-Length': contentLength,
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}` } : {}),
    });
    const stream = fs.createReadStream(filePath, streamOptions);
    res.on('close', () => stream.destroy());
    stream.on('error', err => {
      console.error('Audio file read error:', err.message);
      res.destroy(err);
    });
    stream.pipe(res);
  } catch (err) {
    console.error('Audio streaming error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', async (req, res) => {
  const cached = cache.get('status:v2');
  if (cached) return res.json(cached);

  const cookies = getCookieHealth();
  const youtubePrivateProbe = cookies.youtubeSession;
  const youtubeProbeArgs = youtubePrivateProbe
    ? [
        ...cookieArgs(),
        '--extractor-args', 'youtube:player_client=web_music',
        '--dump-single-json', '--flat-playlist', '--playlist-end', '1',
        '--no-download', '--no-warnings',
        'https://music.youtube.com/playlist?list=LM',
      ]
    : [
        'ytsearch1:Listenfold music',
        '--dump-json', '--flat-playlist', '--no-download', '--no-warnings',
        '--extractor-args', 'youtube:player_client=web_music',
      ];

  const [versionResult, yandexResult, youtubeResult] = await Promise.allSettled([
    ytdlp(['--version'], 5000),
    cookies.yandexSession ? ymApi('/account/status', {}, false) : Promise.reject(new Error('No Yandex session')),
    ytdlp(youtubeProbeArgs, 12000),
  ]);
  const yandexAuthenticated = yandexResult.status === 'fulfilled'
    && Boolean(yandexResult.value?.result?.account?.uid || yandexResult.value?.account?.uid);
  const youtubeOk = youtubeResult.status === 'fulfilled' && youtubeResult.value.trim().length > 0;
  const rawVersion = versionResult.status === 'fulfilled' ? versionResult.value.trim().split('\n')[0] : '';
  const version = /^[\w.+-]{1,80}$/.test(rawVersion) ? rawVersion : null;
  const result = {
    ok: versionResult.status === 'fulfilled' && (yandexAuthenticated || youtubeOk),
    checkedAt: new Date().toISOString(),
    engines: {
      search: 'Yandex Music Web API + yt-dlp YouTube Music extractor',
      audio: 'Yandex download-info + canonical client failover; yt-dlp bestaudio for YouTube',
      lyrics: 'Yandex Music supplement + LRCLIB',
      cookies: 'yt-dlp Chrome browser-cookie export',
    },
    cookies,
    ytdlp: {
      ok: versionResult.status === 'fulfilled',
      version,
      engine: 'yt-dlp',
    },
    yandex: {
      ok: yandexAuthenticated,
      authenticated: yandexAuthenticated,
      engine: 'Yandex Music Web API (session-backed)',
    },
    youtube: {
      ok: youtubeOk,
      authenticated: youtubePrivateProbe && youtubeOk,
      engine: 'yt-dlp YouTube Music web client',
    },
  };
  cache.set('status:v2', result, 30);
  res.json(result);
});

app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  let safeUrl;
  try { safeUrl = playbackUrl(url); } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const cacheKey = `info:${safeUrl}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    if (isYandexUrl(safeUrl) || /^ym-\d+$/.test(safeUrl)) {
      const match = safeUrl.match(/track\/(\d+)/) || safeUrl.match(/^ym-(\d+)$/);
      if (!match) throw new Error('Invalid Yandex URL');
      const resData = await ymApi(`/tracks/${match[1]}`);
      const t = resData.result?.[0] || resData[0];
      if (!t) throw new Error('Track not found');
      const info = {
        ...ymTrack(t),
        playback: {
          engine: 'yandex-download-info',
          fallback: 'client-canonical-source-failover',
        },
      };
      cache.set(cacheKey, info, 3600);
      return res.json(info);
    }

    const raw = await ytdlp([
      ...cookieArgs(),
      '--extractor-args', 'youtube:player_client=web_music',
      '--dump-json', '--no-download', '--no-playlist', '--no-warnings',
      '--', safeUrl,
    ]);
    const d = JSON.parse(raw);
    const info = {
      ...youtubeTrack(d),
      playback: {
        engine: 'yt-dlp-bestaudio',
      },
    };
    cache.set(cacheKey, info, 3600);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/refresh-cookies', (req, res) => {
  const outcome = exportBrowserCookies();
  if (!outcome.ok) {
    return res.status(502).json({
      ok: false,
      error: 'Не удалось автоматически найти cookies в браузерах. Попробуйте войти через аккаунт или вставить cookies вручную.',
      code: outcome.code,
    });
  }

  res.json({
    ok: true,
    updated: outcome.updated,
    browser: outcome.browser,
    count: outcome.count,
    cookies: getCookieHealth(),
  });
});

app.post('/api/cookies/import', (req, res) => {
  const text = req.body?.text || (typeof req.body === 'string' ? req.body : '');
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ ok: false, error: 'Передан пустой текст cookies' });
  }

  const filtered = filteredCookieJar(text);
  if (filtered.count <= 0) {
    return res.status(400).json({
      ok: false,
      error: 'В переданном тексте не найдены cookies для YouTube или Яндекс',
    });
  }

  atomicWritePrivate(cookieFile, filtered.contents);
  parseCookies();
  clearServiceCaches();

  res.json({
    ok: true,
    count: filtered.count,
    cookies: getCookieHealth(),
  });
});

app.get('/api/cookies/status', (req, res) => {
  res.json(getCookieHealth());
});

app.listen(PORT, HOST, () => {
  console.log(`Listenfold ready at http://${HOST}:${PORT}`);
});
