// Listenfold client

const PLACEHOLDER_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%2314161c'/%3E%3Ctext x='100' y='115' text-anchor='middle' fill='%2348505e' font-size='40'%3E♪%3C/text%3E%3C/svg%3E";
const persistedSession = loadJSON('lf_session', {});
const restoredQueue = Array.isArray(persistedSession.queue) ? persistedSession.queue : [];
const restoredIndex = Number.isInteger(persistedSession.currentIndex) ? persistedSession.currentIndex : -1;
const persistedSource = getStorageItem('lf_source_preference');
const persistedWaveSource = getStorageItem('lf_wave_source');
const persistedWaveMood = getStorageItem('lf_wave_mood');
const persistedWaveStationId = getStorageItem('lf_wave_station');
const persistedWaveDislikes = loadJSON('lf_wave_dislikes', []);

// State
const state = {
  queue: restoredQueue,
  currentIndex: restoredIndex >= 0 && restoredIndex < restoredQueue.length ? restoredIndex : -1,
  currentTrack: persistedSession.currentTrack || null,
  currentCanonicalTrack: null,
  isPlaying: false,
  volume: parseFloat(getStorageItem('lf_volume') ?? '0.8'),
  shuffle: Boolean(persistedSession.shuffle),
  repeat: ['none', 'all', 'one'].includes(persistedSession.repeat) ? persistedSession.repeat : 'none', // none | all | one
  searchSource: ['all', 'youtube', 'yandex'].includes(persistedSource) ? persistedSource : 'all', // all | youtube | yandex
  liked: loadJSON('lf_liked', []),
  history: loadJSON('lf_history', []),
  currentView: 'search',
  currentTracksList: [],
  searchResults: [],
  isLoading: false,
  isFullscreen: false,
  fsActiveTab: 'stage', // stage | lyrics | queue
  drawerLyricsOpen: false,

  // Multi-Source Lyrics State
  lyricsSources: [],
  currentLyricsSourceId: null,
  lyrics: null, // { plainLyrics, syncedLyrics, parsedLrc: [] }
  activeLrcIdx: -1,

  // Durable playback + source failover
  variantSelections: persistedSession.variantSelections || {},
  restoredTime: Number.isFinite(persistedSession.currentTime) ? Math.max(0, persistedSession.currentTime) : 0,
  needsSessionRestore: Boolean(persistedSession.currentTrack),
  playbackSpeed: Number.isFinite(persistedSession.playbackSpeed) ? persistedSession.playbackSpeed : 1,

  // Rescue / Library Map
  rescueData: null,
  rescueLoading: false,
  libraryMapData: null,
  libraryMapTab: 'overlap',
  waveData: null,
  waveSource: ['custom', 'youtube', 'yandex'].includes(persistedWaveSource) ? persistedWaveSource : 'custom',
  waveMood: persistedWaveMood || 'all',
  waveStationId: persistedWaveStationId || '',
  waveStationProviderId: '',
  waveStations: [],
  waveActive: false,
  waveLoading: false,
  waveLyricsOpen: false,
  isUserScrollingWaveLyrics: false,
  waveDislikes: Array.isArray(persistedWaveDislikes) ? persistedWaveDislikes : [],
  homeRecommendations: [],

  // Karaoke Lab
  karaokeOffsets: loadJSON('lf_karaoke_offsets', {}),
  karaokeOffset: 0,
  karaokeLoop: false,
  karaokeLoopIndex: -1,
};

// Concurrency & Playback Safety
let playToken = 0;
const MAX_AUTO_RETRIES = 1;
let playbackSession = null;
let sessionSaveTimer = null;
let lastTimedSessionSave = 0;
let lyricsRequestToken = 0;
let homeRecommendationsLoading = false;
let waveLoadToken = 0;
let waveRefillPromise = null;
let wavePlayWhenBuffered = false;
let waveRefillRun = 0;
const likeSyncs = new Map();

// DOM helpers
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const dom = {
  // Topbar & Search
  searchInput:        $('#searchInput'),
  refreshCookiesBtn:  $('#refreshCookiesBtn'),
  shortcutsBtn:       $('#shortcutsBtn'),
  desktopSidebarToggle: $('#desktopSidebarToggle'),
  desktopMinimizeBtn: $('#desktopMinimizeBtn'),
  desktopMaximizeBtn: $('#desktopMaximizeBtn'),
  desktopCloseBtn:    $('#desktopCloseBtn'),
  ambientBackdrop:    $('#ambientBackdrop'),

  // Views & Table
  mainView:           $('#mainView'),
  welcomeScreen:      $('#welcomeScreen'),
  collectionHeader:   $('#collectionHeader'),
  collectionTitle:    $('#collectionTitle'),
  collectionSubtitle: $('#collectionSubtitle'),
  collectionCover:    $('#collectionCover'),
  heroCoverPlayBtn:   $('#heroCoverPlayBtn'),
  heroAmbientGlow:    $('#heroAmbientGlow'),
  heroSrcBadge:       $('#heroSrcBadge'),
  collectionType:     $('#collectionType'),
  heroArtistWrap:     $('#heroArtistWrap'),
  heroArtistName:     $('#heroArtistName'),
  heroArtistDot:      $('#heroArtistDot'),
  heroDuration:       $('#heroDuration'),
  heroDurationVal:    $('#heroDurationVal'),
  heroDurDot:         $('#heroDurDot'),
  heroPlayAllBtn:     $('#heroPlayAllBtn'),
  heroShuffleBtn:     $('#heroShuffleBtn'),
  heroQueueAllBtn:    $('#heroQueueAllBtn'),
  heroOpenLinkBtn:    $('#heroOpenLinkBtn'),
  heroFilterInput:    $('#heroFilterInput'),
  searchResults:      $('#searchResults'),
  trackList:          $('#trackList'),
  queueView:          $('#queueView'),
  queueList:          $('#queueList'),
  queueEmpty:         $('#queueEmpty'),
  queuePreviewList:   $('#queuePreviewList'),
  clearQueueBtn:      $('#clearQueueBtn'),
  sidebarLikedCount:  $('#sidebarLikedCount'),
  loading:            $('#loading'),
  loadingText:        $('#loadingText'),

  // Playlist Rescue
  rescueView:          $('#rescueView'),
  rescueUrlInput:      $('#rescueUrlInput'),
  rescueRunBtn:        $('#rescueRunBtn'),
  rescueSummary:       $('#rescueSummary'),
  rescueResults:       $('#rescueResults'),
  rescueExportJsonBtn: $('#rescueExportJsonBtn'),
  rescueExportM3uBtn:  $('#rescueExportM3uBtn'),

  // Cross-provider Library Map
  libraryMapView:      $('#libraryMapView'),
  libraryMapLoadBtn:   $('#libraryMapLoadBtn'),
  libraryMapSummary:   $('#libraryMapSummary'),
  libraryMapTabs:      $('#libraryMapTabs'),
  libraryMapList:      $('#libraryMapList'),

  // Runtime provider status
  statusYandex:        $('#statusYandex'),
  statusYoutube:       $('#statusYoutube'),
  statusEngine:        $('#statusEngine'),

  // Home Hub
  hubGreeting:        $('#hubGreeting'),
  hubLaunchYm:        $('#hubLaunchYm'),
  hubYmPlayBtn:       $('#hubYmPlayBtn'),
  hubLaunchYt:        $('#hubLaunchYt'),
  hubYtPlayBtn:       $('#hubYtPlayBtn'),
  hubLaunchWave:      $('#hubLaunchWave'),
  hubWavePlayBtn:     $('#hubWavePlayBtn'),
  hubLinkInput:       $('#hubLinkInput'),
  hubLinkBtn:         $('#hubLinkBtn'),
  hubRecommendations: $('#hubRecommendations'),
  hubRefreshRecs:     $('#hubRefreshRecs'),
  hubRecentSection:   $('#hubRecentSection'),
  hubRecentGrid:      $('#hubRecentGrid'),
  hubViewAllHistory:  $('#hubViewAllHistory'),

  // Wave / Recommendations
  waveView:           $('#waveView'),
  waveMoodTabs:       $('#waveMoodTabs'),
  waveStations:       $('#waveStations'),
  waveStationList:    $('#waveStationList'),
  waveStationsPrev:   $('#waveStationsPrev'),
  waveStationsNext:   $('#waveStationsNext'),
  waveSourceTabs:     $('#waveSourceTabs'),
  waveTuneBtn:        $('#waveTuneBtn'),
  waveTunePanel:      $('#waveTunePanel'),
  waveSeedInput:      $('#waveSeedInput'),
  waveRunBtn:         $('#waveRunBtn'),
  waveRefreshBtn:     $('#waveRefreshBtn'),
  waveStatus:         $('#waveStatus'),
  waveSubline:        $('#waveSubline'),
  waveResults:        $('#waveResults'),
  waveRadioStage:     $('#waveRadioStage'),
  waveBackdrop:       $('#waveBackdrop'),
  waveNowCover:       $('#waveNowCover'),
  waveNowCoverEmpty:  $('#waveNowCoverEmpty'),
  waveNowSource:      $('#waveNowSource'),
  waveNowTitle:       $('#waveNowTitle'),
  waveNowArtist:      $('#waveNowArtist'),
  waveNextCard:       $('#waveNextCard'),
  waveNextCover:      $('#waveNextCover'),
  waveNextTitle:      $('#waveNextTitle'),
  waveNextArtist:     $('#waveNextArtist'),
  waveNextSource:     $('#waveNextSource'),
  wavePlayBtn:        $('#wavePlayBtn'),
  waveSkipBtn:        $('#waveSkipBtn'),
  waveLikeBtn:        $('#waveLikeBtn'),
  waveDislikeBtn:     $('#waveDislikeBtn'),
  waveRejectNextBtn:  $('#waveRejectNextBtn'),
  wavePlayNextBtn:    $('#wavePlayNextBtn'),
  waveLyricsBtn:      $('#waveLyricsBtn'),
  waveLyricsPanel:    $('#waveLyricsPanel'),
  waveLyricsTitle:    $('#waveLyricsTitle'),
  waveLyricsSources:  $('#waveLyricsSources'),
  waveLyricsBody:     $('#waveLyricsBody'),
  waveLyricsFullscreenBtn: $('#waveLyricsFullscreenBtn'),
  waveLyricsCloseBtn: $('#waveLyricsCloseBtn'),
  waveFullscreenBtn:  $('#waveFullscreenBtn'),
  waveProgressBar:    $('#waveProgressBar'),
  waveCurrentTime:    $('#waveCurrentTime'),
  waveTotalTime:      $('#waveTotalTime'),

  // Bottom Player Bar
  playerArtwork:      $('#playerArtwork'),
  artworkPlaceholder: $('#artworkPlaceholder'),
  artworkWrap:        $('#artworkWrap'),
  playerInfoWrap:     $('#playerInfoWrap'),
  playerTitle:        $('#playerTitle'),
  playerArtist:       $('#playerArtist'),
  playerSourceTag:    $('#playerSourceTag'),
  playBtn:            $('#playBtn'),
  iconPlay:           $('.icon-play'),
  iconPause:          $('.icon-pause'),
  prevBtn:            $('#prevBtn'),
  nextBtn:            $('#nextBtn'),
  shuffleBtn:         $('#shuffleBtn'),
  repeatBtn:          $('#repeatBtn'),
  likeBtn:            $('#likeBtn'),
  progressWrapper:    $('#progressWrapper'),
  progressBar:        $('#progressBar'),
  progressFill:       $('#progressFill'),
  progressBuffered:   $('#progressBuffered'),
  scrubTooltip:       $('#scrubTooltip'),
  currentTime:        $('#currentTime'),
  totalTime:          $('#totalTime'),
  volumeBar:          $('#volumeBar'),
  volumeFill:         $('#volumeFill'),
  volumeBtn:          $('#volumeBtn'),
  visualizer:         $('#visualizer'),
  lyricsBtn:          $('#lyricsBtn'),
  expandPlayerBtn:    $('#expandPlayerBtn'),
  desktopMiniPlayerBtn: $('#desktopMiniPlayerBtn'),

  // Lyrics Drawer (Desktop Side)
  lyricsDrawer:        $('#lyricsDrawer'),
  drawerLyricsTitle:   $('#drawerLyricsTitle'),
  drawerLyricsSources: $('#drawerLyricsSources'),
  drawerLyricsBody:    $('#lyricsDrawerBody'),
  lyricsDrawerBody:    $('#lyricsDrawerBody'),
  drawerCopyLyricsBtn: $('#drawerCopyLyricsBtn'),
  drawerLrcResumeBtn:  $('#drawerLrcResumeBtn'),
  closeLyricsDrawerBtn:$('#closeLyricsDrawerBtn'),
  karaokeOffsetDown:   $('#karaokeOffsetDown'),
  karaokeOffsetUp:     $('#karaokeOffsetUp'),
  karaokeOffsetValue:  $('#karaokeOffsetValue'),
  karaokeLoopBtn:      $('#karaokeLoopBtn'),
  karaokeExportBtn:    $('#karaokeExportBtn'),

  // Fullscreen Cinema Stage
  fullscreenPlayer:   $('#fullscreenPlayer'),
  fsBackdrop:         $('#fsBackdrop'),
  fsCloseBtn:         $('#fsCloseBtn'),
  fsTabStage:         $('#fsTabStage'),
  fsTabLyrics:        $('#fsTabLyrics'),
  fsTabQueue:         $('#fsTabQueue'),
  fsPaneStage:        $('#fsPaneStage'),
  fsPaneLyrics:       $('#fsPaneLyrics'),
  fsPaneQueue:        $('#fsPaneQueue'),
  fsArtwork:          $('#fsArtwork'),
  fsArtworkPlaceholder:$('#fsArtworkPlaceholder'),
  fsArtworkCard:      $('#fsArtworkCard'),
  fsTitle:            $('#fsTitle'),
  fsArtist:           $('#fsArtist'),
  fsLikeBtn:          $('#fsLikeBtn'),
  fsPlayBtn:          $('#fsPlayBtn'),
  fsPrevBtn:          $('#fsPrevBtn'),
  fsNextBtn:          $('#fsNextBtn'),
  fsShuffleBtn:       $('#fsShuffleBtn'),
  fsRepeatBtn:        $('#fsRepeatBtn'),
  fsLrcFontDecBtn:    $('#fsLrcFontDecBtn'),
  fsLrcFontIncBtn:    $('#fsLrcFontIncBtn'),
  fsLrcCopyBtn:       $('#fsLrcCopyBtn'),
  fsLrcResumeBtn:     $('#fsLrcResumeBtn'),
  fsProgressBar:      $('#fsProgressBar'),
  fsProgressFill:     $('#fsProgressFill'),
  fsProgressBuffered: $('#fsProgressBuffered'),
  fsProgressDot:      $('#fsProgressDot'),
  fsCurrentTime:      $('#fsCurrentTime'),
  fsTotalTime:        $('#fsTotalTime'),
  fsQualityBadge:     $('#fsQualityBadge'),
  fsSourceBadge:      $('#fsSourceBadge'),
  fsNextPreviewWidget:$('#fsNextPreviewWidget'),
  fsNextArt:          $('#fsNextArt'),
  fsNextTitle:        $('#fsNextTitle'),
  fsVolFill:          $('#fsVolFill'),
  fsVolInput:         $('#fsVolInput'),
  fsLyricsSources:    $('#fsLyricsSources'),
  fsLyricsContainer:  $('#fsLyricsContainer'),
  fsQueueList:        $('#fsQueueList'),
  fsKaraokeOffsetDown:$('#fsKaraokeOffsetDown'),
  fsKaraokeOffsetUp:  $('#fsKaraokeOffsetUp'),
  fsKaraokeOffsetValue:$('#fsKaraokeOffsetValue'),
  fsKaraokeLoopBtn:   $('#fsKaraokeLoopBtn'),
  fsKaraokeExportBtn: $('#fsKaraokeExportBtn'),
  fsKaraokeSpeedBtn:  $('#fsKaraokeSpeedBtn'),

  // In-Dock Karaoke & Advanced Tools
  playerLeft:         $('.player-left'),
  dockLiveLyric:      $('#dockLiveLyric'),
  dockLyricText:      $('#dockLyricText'),
  dockLeftLyric:      $('#dockLeftLyric'),
  dockMetaBlock:      $('#dockMetaBlock'),
  dockLyricsPrompter: $('#dockLyricsPrompter'),
  prompterRoller:     $('#prompterRoller'),
  prompterCurText:    $('#prompterCurText'),
  prompterNextText:   $('#prompterNextText'),
  dockTrackMoreBtn:   $('#dockTrackMoreBtn'),
  dockJumpBackBtn:    $('#dockJumpBackBtn'),
  dockJumpFwdBtn:     $('#dockJumpFwdBtn'),
  dockSpeedBtn:       $('#dockSpeedBtn'),
  dockEqBtn:          $('#dockEqBtn'),
  dockQueueBtn:       $('#dockQueueBtn'),
  volumeWidget:       $('#volumeWidget'),

  // Flyout Popovers
  dockTrackMenu:      $('#dockTrackMenu'),
  dfCopyLink:         $('#dfCopyLink'),
  dfFindSimilar:      $('#dfFindSimilar'),
  dfDownload:         $('#dfDownload'),
  dockQueuePopover:   $('#dockQueuePopover'),
  closeDockQueueBtn:  $('#closeDockQueueBtn'),
  dockQueueList:      $('#dockQueueList'),
  dockEqPopover:      $('#dockEqPopover'),
  closeDockEqBtn:     $('#closeDockEqBtn'),

  // Custom Context Menu
  customContextMenu:  $('#customContextMenu'),
  ctxHeader:          $('#ctxHeader'),
  ctxArt:             $('#ctxArt'),
  ctxTitle:           $('#ctxTitle'),
  ctxArtist:          $('#ctxArtist'),
  ctxItemsList:       $('#ctxItemsList'),

  // Control Center & Overlays
  settingsBtn:        $('#settingsBtn'),
  settingsPopover:    $('#settingsPopover'),
  settingsCloseBtn:   $('#settingsCloseBtn'),
  tileAmbientBlur:    $('#tileAmbientBlur'),
  statusAmbientBlur:  $('#statusAmbientBlur'),
  tileHqCovers:       $('#tileHqCovers'),
  statusHqCovers:     $('#statusHqCovers'),
  shortcutsModal:     $('#shortcutsModal'),
  closeShortcutsBtn:  $('#closeShortcutsBtn'),
  setShortcutsBtn:    $('#setShortcutsBtn'),
  toastContainer:     $('#toastContainer'),
};

// Audio engine & parametric equalizer
const audio = new Audio();
audio.volume = state.volume;
audio.preload = 'auto';

let audioCtx = null;
let analyser = null;
let dataArray = null;
let animFrame = null;
let mediaSourceNode = null;
let eqFilterNodes = [];

const BAND_COLORS = ['#2dd4bf', '#60a5fa', '#c084fc', '#fb923c', '#4ade80', '#f472b6', '#38bdf8', '#fb7185', '#facc15'];

const DEFAULT_EQ_BANDS = [
  { id: 1, freq: 100, gain: 0, q: 1.0, type: 'lowshelf', color: '#2dd4bf' },
  { id: 2, freq: 300, gain: 0, q: 1.0, type: 'peaking', color: '#60a5fa' },
  { id: 3, freq: 1000, gain: 0, q: 1.0, type: 'peaking', color: '#c084fc' },
  { id: 4, freq: 3000, gain: 0, q: 1.0, type: 'peaking', color: '#fb923c' },
  { id: 5, freq: 7000, gain: 0, q: 1.0, type: 'peaking', color: '#4ade80' },
  { id: 6, freq: 14000, gain: 0, q: 1.0, type: 'highshelf', color: '#f472b6' },
];

const EQ_PRESETS = {
  flat: [
    { freq: 100, gain: 0, q: 1.0, type: 'lowshelf' },
    { freq: 300, gain: 0, q: 1.0, type: 'peaking' },
    { freq: 1000, gain: 0, q: 1.0, type: 'peaking' },
    { freq: 3000, gain: 0, q: 1.0, type: 'peaking' },
    { freq: 7000, gain: 0, q: 1.0, type: 'peaking' },
    { freq: 14000, gain: 0, q: 1.0, type: 'highshelf' },
  ],
  bass: [
    { freq: 100, gain: 8.5, q: 0.9, type: 'lowshelf' },
    { freq: 250, gain: 4.0, q: 1.0, type: 'peaking' },
    { freq: 1000, gain: 0, q: 1.0, type: 'peaking' },
    { freq: 3000, gain: 0.5, q: 1.0, type: 'peaking' },
    { freq: 7000, gain: 1.5, q: 1.0, type: 'peaking' },
    { freq: 14000, gain: 2.5, q: 1.0, type: 'highshelf' },
  ],
  vocal: [
    { freq: 100, gain: -3.0, q: 1.0, type: 'lowshelf' },
    { freq: 300, gain: 1.0, q: 1.0, type: 'peaking' },
    { freq: 1200, gain: 4.5, q: 1.2, type: 'peaking' },
    { freq: 3500, gain: 3.5, q: 1.1, type: 'peaking' },
    { freq: 7000, gain: 1.0, q: 1.0, type: 'peaking' },
    { freq: 14000, gain: 0, q: 1.0, type: 'highshelf' },
  ],
  rock: [
    { freq: 100, gain: 5.5, q: 1.0, type: 'lowshelf' },
    { freq: 300, gain: 2.0, q: 1.0, type: 'peaking' },
    { freq: 1000, gain: -1.5, q: 1.0, type: 'peaking' },
    { freq: 3000, gain: 2.5, q: 1.0, type: 'peaking' },
    { freq: 7000, gain: 4.5, q: 1.0, type: 'peaking' },
    { freq: 14000, gain: 5.5, q: 1.0, type: 'highshelf' },
  ],
  treble: [
    { freq: 100, gain: -2.5, q: 1.0, type: 'lowshelf' },
    { freq: 300, gain: 0, q: 1.0, type: 'peaking' },
    { freq: 1000, gain: 1.0, q: 1.0, type: 'peaking' },
    { freq: 3000, gain: 3.5, q: 1.0, type: 'peaking' },
    { freq: 7000, gain: 6.5, q: 1.0, type: 'peaking' },
    { freq: 14000, gain: 8.0, q: 1.0, type: 'highshelf' },
  ],
  electronic: [
    { freq: 100, gain: 6.5, q: 0.9, type: 'lowshelf' },
    { freq: 300, gain: 3.0, q: 1.0, type: 'peaking' },
    { freq: 1000, gain: -2.0, q: 1.0, type: 'peaking' },
    { freq: 3000, gain: 2.0, q: 1.0, type: 'peaking' },
    { freq: 7000, gain: 4.0, q: 1.0, type: 'peaking' },
    { freq: 14000, gain: 5.5, q: 1.0, type: 'highshelf' },
  ],
  acoustic: [
    { freq: 100, gain: 3.0, q: 1.0, type: 'lowshelf' },
    { freq: 300, gain: 1.5, q: 1.0, type: 'peaking' },
    { freq: 1000, gain: 0.5, q: 1.0, type: 'peaking' },
    { freq: 3000, gain: 2.0, q: 1.0, type: 'peaking' },
    { freq: 7000, gain: 3.5, q: 1.0, type: 'peaking' },
    { freq: 14000, gain: 3.0, q: 1.0, type: 'highshelf' },
  ],
};

function loadStoredEqBands() {
  try {
    const raw = localStorage.getItem('lf_eq_bands');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((b, i) => ({
          id: b.id || (i + 1),
          freq: Math.max(20, Math.min(20000, Number(b.freq) || 1000)),
          gain: Math.max(-21, Math.min(21, Number(b.gain) || 0)),
          q: Math.max(0.1, Math.min(10, Number(b.q) || 1.0)),
          type: ['lowshelf', 'peaking', 'highshelf'].includes(b.type) ? b.type : 'peaking',
          color: b.color || BAND_COLORS[i % BAND_COLORS.length],
        }));
      }
    }
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_EQ_BANDS));
}

state.eqBands = loadStoredEqBands();
state.eqPreset = localStorage.getItem('lf_eq_preset') || 'flat';
state.selectedEqBand = -1;

function initAudioContext() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    dataArray = new Uint8Array(analyser.frequencyBinCount);

    mediaSourceNode = audioCtx.createMediaElementSource(audio);
    rebuildEqAudioGraph();
  } catch (e) {
    console.warn('AudioContext init:', e.message);
  }
}

function rebuildEqAudioGraph() {
  if (!audioCtx || !mediaSourceNode) return;

  try { mediaSourceNode.disconnect(); } catch {}
  for (const n of eqFilterNodes) {
    try { n.disconnect(); } catch {}
  }
  eqFilterNodes = [];

  let last = mediaSourceNode;
  for (const band of state.eqBands) {
    const filter = audioCtx.createBiquadFilter();
    filter.type = band.type || 'peaking';
    filter.frequency.value = band.freq;
    filter.gain.value = band.gain;
    filter.Q.value = band.q || 1.0;
    last.connect(filter);
    last = filter;
    eqFilterNodes.push(filter);
  }

  last.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function updateFilterNode(index) {
  const band = state.eqBands[index];
  const node = eqFilterNodes[index];
  if (!band || !node || !audioCtx) return;
  const t = audioCtx.currentTime;
  node.type = band.type;
  node.frequency.setTargetAtTime(band.freq, t, 0.015);
  node.gain.setTargetAtTime(band.gain, t, 0.015);
  node.Q.setTargetAtTime(band.q || 1.0, t, 0.015);
}

function setEqPreset(preset, notify = true) {
  state.eqPreset = preset;
  localStorage.setItem('lf_eq_preset', preset);

  if (EQ_PRESETS[preset]) {
    const pBands = EQ_PRESETS[preset];
    state.eqBands = pBands.map((p, idx) => ({
      id: idx + 1,
      freq: p.freq,
      gain: p.gain,
      q: p.q || 1.0,
      type: p.type || 'peaking',
      color: BAND_COLORS[idx % BAND_COLORS.length],
    }));
    localStorage.setItem('lf_eq_bands', JSON.stringify(state.eqBands));
    initAudioContext();
    rebuildEqAudioGraph();
  }

  if (typeof updateEqPresetUI === 'function') updateEqPresetUI();
  if (typeof updateEqBottomPanel === 'function') updateEqBottomPanel();
  if (typeof drawEqCanvas === 'function') drawEqCanvas();
  if (notify) toast(`Эквалайзер: ${preset.toUpperCase()}`);
}

// Thumbnails
function upgradeThumb(url) {
  if (!url) return null;
  if (state.settings?.hqCovers === false) return url;
  if (url.includes('googleusercontent.com')) {
    return url.replace(/=w\d+-h\d+[^?&]*/, '=w1200-h1200-l90-rj').replace(/=s\d+[^?&]*/, '=s1200');
  }
  if (url.includes('avatars.yandex.net')) {
    return url.replace(/\/\d+x\d+$/, '/1000x1000');
  }
  if (url.includes('i.ytimg.com/vi/')) {
    return url.replace(/\/(hqdefault|mqdefault|default|sddefault)\.jpg/, '/maxresdefault.jpg');
  }
  return url;
}

// Session persistence
function trackIdentity(track) {
  if (!track) return '';
  return String(track.canonicalId || track.id || track.url || `${track.artist || ''}\u0000${track.title || ''}`);
}

function sourceName(source) {
  if (source === 'yandex') return 'Яндекс';
  if (source === 'youtube') return 'YouTube';
  return source ? String(source) : 'Источник';
}

function sourceClass(source) {
  if (source === 'yandex') return 'ym';
  if (source === 'youtube') return 'yt';
  return 'local';
}

function getTrackVariants(track) {
  if (!track) return [];
  const rawVariants = Array.isArray(track.variants) ? track.variants : [];
  const candidates = [];

  if (track.url) {
    const base = { ...track };
    delete base.variants;
    candidates.push(base);
  }

  rawVariants.forEach(raw => {
    const variant = raw?.track || raw;
    if (!variant || typeof variant !== 'object') return;
    candidates.push({
      title: track.title,
      artist: track.artist,
      thumbnail: track.thumbnail,
      duration: track.duration,
      ...variant,
      available: variant.available !== false && Boolean(variant.url),
    });
  });

  if (!candidates.length) candidates.push({ ...track, available: false });

  const seen = new Set();
  return candidates.filter(variant => {
    const key = variant.url || `${variant.source || 'unknown'}:${variant.id || variant.ymId || variant.videoId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(variant => ({
    ...variant,
    available: variant.available !== false && Boolean(variant.url),
  }));
}

function getSelectedVariantIndex(track, variants = getTrackVariants(track)) {
  const selected = state.variantSelections[trackKey(track)];
  if (selected) {
    const idx = variants.findIndex(v => v.url === selected || `${v.source}:${v.id || v.ymId || v.videoId || ''}` === selected);
    if (idx >= 0 && variants[idx].available !== false) return idx;
  }

  const preferredSource = (state.currentView === 'wave' || state.waveActive) && ['youtube', 'yandex'].includes(state.waveSource)
    ? state.waveSource
    : (['youtube', 'yandex'].includes(state.searchSource) ? state.searchSource : null);
  if (preferredSource) {
    const preferred = variants.findIndex(v => v.source === preferredSource && v.available !== false && v.url);
    if (preferred >= 0) return preferred;
  }

  const available = variants.findIndex(v => v.available !== false && v.url);
  return available >= 0 ? available : 0;
}

function materializeTrack(canonical, variantIndex) {
  const variants = getTrackVariants(canonical);
  const safeIndex = variantIndex >= 0 && variantIndex < variants.length ? variantIndex : getSelectedVariantIndex(canonical, variants);
  const variant = variants[safeIndex] || canonical;
  return {
    ...canonical,
    ...variant,
    id: canonical.id || variant.id,
    canonicalId: canonical.canonicalId || canonical.id || variant.canonicalId || variant.id,
    title: canonical.title || variant.title || 'Без названия',
    artist: canonical.artist || variant.artist || 'Неизвестный исполнитель',
    thumbnail: canonical.thumbnail || variant.thumbnail || null,
    variants,
    activeVariantIndex: safeIndex,
  };
}

function versionLabel(versionType) {
  const labels = {
    original: 'Original',
    live: 'Live',
    remix: 'Remix',
    mix: 'Mix',
    cover: 'Cover',
    lyrics: 'Lyrics',
    slowed: 'Slowed',
    'sped-up': 'Sped up',
    excerpt: 'Excerpt',
    clip: 'Clip',
    acoustic: 'Acoustic',
    instrumental: 'Instrumental',
    remaster: 'Remaster',
  };
  return labels[versionType] || (versionType ? String(versionType) : '');
}

function qualityLabel(track) {
  if (!track) return 'AUTO';
  const explicit = track.qualityLabel || track.audioQuality || track.quality;
  if (explicit) return String(explicit).toUpperCase();
  const bitrate = Number(track.bitrateInKbps || track.bitrate || track.kbps);
  const codec = track.codec ? String(track.codec).toUpperCase() : '';
  if (Number.isFinite(bitrate) && bitrate > 0) return `${codec ? `${codec} ` : ''}${Math.round(bitrate)}K`;
  return codec || 'AUTO';
}

function sourceStackHtml(track, rowIndex, activeIndex = getSelectedVariantIndex(track)) {
  const variants = getTrackVariants(track);
  return `<div class="source-stack">${variants.map((variant, variantIndex) => {
    const unavailable = variant.available === false || !variant.url;
    const quality = qualityLabel(variant);
    return `
      <button type="button"
        class="source-variant ${sourceClass(variant.source)} ${variantIndex === activeIndex ? 'active' : ''} ${unavailable ? 'unavailable' : ''}"
        data-track-index="${rowIndex}" data-variant-index="${variantIndex}"
        aria-pressed="${variantIndex === activeIndex}"
        ${unavailable ? 'disabled' : ''}
        title="${unavailable ? 'Источник недоступен' : `Слушать через ${esc(sourceName(variant.source))}${quality !== 'AUTO' ? ` · ${esc(quality)}` : ''}`}">
        ${esc(sourceName(variant.source))}
      </button>
    `;
  }).join('')}</div>`;
}

function persistSession(immediate = false) {
  const write = () => {
    sessionSaveTimer = null;
    const currentTime = playbackSession?.token === playToken
      ? Math.max(0, playbackSession.resumeTime || 0)
      : (state.needsSessionRestore ? (state.restoredTime || 0) : (Number.isFinite(audio.currentTime) ? audio.currentTime : 0));
    saveJSON('lf_session', {
      queue: state.queue,
      currentIndex: state.currentIndex,
      currentTrack: state.currentCanonicalTrack || state.currentTrack,
      currentTime,
      shuffle: state.shuffle,
      repeat: state.repeat,
      variantSelections: state.variantSelections,
      playbackSpeed: state.playbackSpeed || 1,
    });
  };

  if (immediate) {
    clearTimeout(sessionSaveTimer);
    write();
    return;
  }
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(write, 250);
}

function syncQueueUI() {
  renderSidebarQueue();
  renderFsQueue();
  renderDockQueue();
  if (state.currentView === 'queue') showView('queue');
  persistSession();
}

async function responseJson(res, fallbackMessage = 'Ошибка запроса') {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `${fallbackMessage} (HTTP ${res.status})`);
  }
  return data;
}

// Loading skeletons
function renderTableSkeleton(container, count = 8) {
  if (!container) return;
  container.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-row">
      <div class="sk-index sk-shimmer"></div>
      <div class="sk-main">
        <div class="sk-art sk-shimmer"></div>
        <div class="sk-text">
          <div class="sk-title sk-shimmer"></div>
          <div class="sk-artist sk-shimmer"></div>
        </div>
      </div>
      <div class="sk-source sk-shimmer"></div>
      <div class="sk-dur sk-shimmer"></div>
      <div style="width:26px"></div>
    </div>
  `).join('');
}

function renderLyricsSkeleton(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="lyrics-skeleton-wrap">
      <div class="sk-lrc-line sk-shimmer"></div>
      <div class="sk-lrc-line sk-shimmer"></div>
      <div class="sk-lrc-line sk-shimmer"></div>
      <div class="sk-lrc-line sk-shimmer"></div>
      <div class="sk-lrc-line sk-shimmer"></div>
    </div>
  `;
}

// Search & links
let searchTimer = null;

function debouncedSearch(query) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => search(query), 300);
}

async function search(query) {
  query = query.trim();
  if (!query) return;

  const isHttpUrl = /^https?:\/\//i.test(query);
  const isYandexTrackUrl = /^https?:\/\/(?:www\.)?music\.yandex\.(?:ru|com|by|kz)\/(?:.*\/)?track\/\d+(?:[/?#]|$)/i.test(query);

  // A Yandex track link usually contains /album/.../track/...; route it before albums.
  if (isHttpUrl && isYandexTrackUrl) {
    await openDirectUrl(query);
    return;
  }

  // Direct playlist / album link
  if (isHttpUrl && (query.includes('playlist') || query.includes('album') || query.includes('list='))) {
    await loadPlaylistUrl(query);
    return;
  }

  // Direct single track link
  if (isHttpUrl) {
    await openDirectUrl(query);
    return;
  }

  // Regular text search
  setLoading(true, `Поиск «${query}»...`);
  showView('search');
  dom.searchResults.classList.remove('hidden');
  dom.welcomeScreen.classList.add('hidden');
  dom.collectionHeader.classList.add('hidden');
  renderTableSkeleton(dom.trackList, 8);

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&source=${state.searchSource}&limit=36`);
    const data = await responseJson(res, 'Ошибка поиска');

    state.searchResults = data.tracks || [];
    state.currentTracksList = state.searchResults;
    if (state.searchSource === 'all' && data.availability) {
      const unavailable = [
        data.availability.yandex === false ? 'Яндекс' : null,
        data.availability.youtube === false ? 'YouTube' : null,
      ].filter(Boolean);
      if (unavailable.length) toast(`Частичный поиск: ${unavailable.join(' и ')} недоступен`);
    }
    if (state.searchSource === 'all') {
      renderCanonicalSearch(state.searchResults, dom.trackList);
    } else {
      renderTrackTable(state.searchResults, dom.trackList, false);
    }
  } catch (err) {
    console.error('Search error:', err);
    dom.trackList.innerHTML = `<div class="loader-view"><span>Ошибка поиска: ${esc(err.message)}</span></div>`;
  } finally {
    setLoading(false);
  }
}

async function loadPlaylistUrl(url) {
  showView('search');
  setLoading(true, 'Загрузка плейлиста / альбома...');
  try {
    const res = await fetch(`/api/playlist?url=${encodeURIComponent(url)}`);
    const data = await responseJson(res, 'Ошибка загрузки плейлиста');

    const tracks = data.tracks || [];
    if (!tracks.length) throw new Error('В плейлисте не найдено треков');

    const isYm = url.includes('yandex') || data.source === 'yandex';
    const isYt = url.includes('youtube') || data.source === 'youtube';

    setupCollectionHeader({
      title: data.title || (isYm ? 'Яндекс.Музыка' : 'YouTube Music'),
      artist: data.artist || data.owner || '',
      type: data.type || 'playlist',
      source: isYm ? 'yandex' : (isYt ? 'youtube' : 'local'),
      coverUrl: data.cover || tracks[0]?.thumbnail || null,
      coverSvg: isYm ? YM_OFFICIAL_SVG : YT_OFFICIAL_SVG,
      tracks,
      duration: data.duration || tracks.reduce((a, t) => a + (t.duration || 0), 0),
      url,
    });

    dom.searchResults.classList.remove('hidden');
    dom.welcomeScreen.classList.add('hidden');
    state.currentTracksList = tracks;
    renderTrackTable(tracks, dom.trackList, false);

    // Opening a collection only opens it. Playback stays an explicit action.
    toast(`Открыт ${data.type === 'album' ? 'альбом' : 'плейлист'}: ${data.title}`);
  } catch (err) {
    toast(`Ошибка загрузки: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

async function openDirectUrl(url) {
  showView('search');
  setLoading(true, 'Загрузка трека...');
  try {
    const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
    const track = await responseJson(res, 'Ошибка загрузки трека');
    state.searchResults = [track];
    state.currentTracksList = state.searchResults;
    if (dom.welcomeScreen) dom.welcomeScreen.classList.add('hidden');
    if (dom.searchResults) dom.searchResults.classList.remove('hidden');
    renderTrackTable(state.searchResults, dom.trackList, false);
    toast(`Открыт трек: ${track.title}`);
  } catch (err) {
    toast(`Ошибка: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

// Table rendering
function renderTrackTable(tracks, container, isQueue = false) {
  if (!container) return;
  container.classList.remove('version-stack-list');
  if (!tracks || !tracks.length) {
    container.innerHTML = `
      <div class="loader-view">
        <span>Список пуст</span>
      </div>
    `;
    return;
  }

  container.innerHTML = tracks.map((track, i) => {
    const isCurrent = trackKey(state.currentTrack) === trackKey(track);
    const isLiked = state.liked.some(t => trackKey(t) === trackKey(track));
    const activeVariantIndex = isCurrent && Number.isInteger(state.currentTrack?.activeVariantIndex)
      ? state.currentTrack.activeVariantIndex
      : getSelectedVariantIndex(track);
    const typeLabel = versionLabel(track.versionType);

    return `
      <div class="table-row ${isCurrent ? 'active-row' : ''} ${isCurrent && state.isPlaying ? 'playing-row' : ''}" role="button" tabindex="0"
        aria-label="${esc(`Воспроизвести ${track.title} — ${track.artist}`)}"
        aria-current="${isCurrent ? 'true' : 'false'}"
        data-index="${i}" data-track-id="${esc(trackKey(track))}" data-track-url="${esc(track.url || '')}">
        <div class="row-index">
          <span class="row-index-num">${i + 1}</span>
          <div class="row-eq">
            <div class="eq-stick"></div>
            <div class="eq-stick"></div>
            <div class="eq-stick"></div>
          </div>
          <svg class="row-play-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4"/>
          </svg>
        </div>

        <div class="row-main">
          <img class="row-art" src="${track.thumbnail || PLACEHOLDER_IMG}" alt="" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'">
          <div class="row-text">
            <div class="row-title">${esc(track.title)}${typeLabel && typeLabel !== 'Original' ? ` <span class="track-version">${esc(typeLabel)}</span>` : ''}</div>
            <div class="row-artist">${esc(track.artist)}</div>
          </div>
        </div>

        <div class="row-source">
          ${sourceStackHtml(track, i, activeVariantIndex)}
        </div>

        <div class="row-duration">${fmtTime(track.duration)}</div>

        <div class="row-actions">
          <button class="action-icon-btn add-btn" title="В очередь" data-idx="${i}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="action-icon-btn like-item-btn ${isLiked ? 'liked' : ''}" title="В избранное" data-idx="${i}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${isLiked ? '#ef4444' : 'none'}" stroke="${isLiked ? '#ef4444' : 'currentColor'}" stroke-width="2" class="heart-icon"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.table-row').forEach(el => {
    const activate = () => {
      const idx = parseInt(el.dataset.index, 10);
      if (!Number.isInteger(idx)) return;
      if (isQueue) {
        state.currentIndex = idx;
        playTrack(state.queue[idx]);
      } else {
        state.queue = [...tracks];
        state.currentIndex = idx;
        playTrack(tracks[idx]);
      }
    };

    el.addEventListener('click', e => {
      if (e.target.closest('.action-icon-btn')) return;
      activate();
    });

    el.addEventListener('keydown', e => {
      if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      activate();
    });
  });

  container.querySelectorAll('.source-variant').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.disabled || btn.classList.contains('unavailable')) return;
      const idx = parseInt(btn.dataset.trackIndex, 10);
      const variantIndex = parseInt(btn.dataset.variantIndex, 10);
      const track = isQueue ? state.queue[idx] : tracks[idx];
      const variant = getTrackVariants(track)[variantIndex];
      if (!track || !variant?.url) return;

      state.variantSelections[trackKey(track)] = variant.url || `${variant.source}:${variant.id || ''}`;
      if (isQueue) {
        state.currentIndex = idx;
      } else {
        state.queue = [...tracks];
        state.currentIndex = idx;
      }
      persistSession();
      playTrack(track, { variantIndex });
    });
  });

  container.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const track = isQueue ? state.queue[idx] : tracks[idx];
      if (track) {
        state.queue.push({ ...track });
        syncQueueUI();
        toast(`+ Добавлено в очередь`);
      }
    });
  });

  container.querySelectorAll('.like-item-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const track = isQueue ? state.queue[idx] : tracks[idx];
      if (track) toggleTrackLike(track);
    });
  });
}

let versionStackRenderId = 0;

function buildVersionStacks(tracks) {
  const stacks = [];
  const bySong = new Map();

  tracks.forEach((track, flatIndex) => {
    // Missing songKey must never cause an accidental title-only merge.
    const key = track.songKey || `single:${trackIdentity(track)}:${flatIndex}`;
    let stack = bySong.get(key);
    if (!stack) {
      stack = { key, items: [] };
      bySong.set(key, stack);
      stacks.push(stack);
    }
    stack.items.push({ track, flatIndex });
  });

  return stacks;
}

function setVersionStackExpanded(stack, expanded) {
  if (!stack) return;
  const toggle = stack.querySelector('.version-stack-toggle');
  const children = stack.querySelector('.version-stack-children');
  if (!toggle || !children) return;

  stack.classList.toggle('expanded', expanded);
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', expanded ? toggle.dataset.closeLabel : toggle.dataset.openLabel);
  const label = toggle.querySelector('.version-stack-toggle-label');
  if (label) label.textContent = expanded ? 'Скрыть' : toggle.dataset.collapsedLabel;
  children.hidden = !expanded;
}

function renderCanonicalSearch(tracks, container) {
  // Build and bind the proven flat table first, then only rearrange its live nodes.
  // Moving nodes keeps every play/source/add/like listener and its original flat index.
  renderTrackTable(tracks, container, false);
  if (!container || !tracks?.length) return;

  container.classList.add('version-stack-list');
  const activeId = trackIdentity(state.currentTrack);
  const rows = new Map(
    [...container.querySelectorAll('.table-row')].map(row => [Number.parseInt(row.dataset.index, 10), row])
  );
  const fragment = document.createDocumentFragment();
  const renderId = ++versionStackRenderId;

  buildVersionStacks(tracks).forEach((stack, stackIndex) => {
    if (stack.items.length === 1) {
      const row = rows.get(stack.items[0].flatIndex);
      if (row) fragment.append(row);
      return;
    }

    const [primary, ...alternates] = stack.items;
    const primaryRow = rows.get(primary.flatIndex);
    if (!primaryRow) return;

    const section = document.createElement('section');
    const children = document.createElement('div');
    const toggle = document.createElement('button');
    const bodyId = `version-stack-${renderId}-${stackIndex}`;
    const count = alternates.length;
    const countWord = pluralize(count, 'версия', 'версии', 'версий');
    const collapsedLabel = `+${count} ${countWord}`;
    const openCountWord = pluralize(count, 'версию', 'версии', 'версий');
    const openLabel = `Показать ${count} ${openCountWord} трека «${primary.track.title}»`;
    const closeLabel = `Скрыть версии трека «${primary.track.title}»`;
    const expanded = stack.items.some(item => trackIdentity(item.track) === activeId);

    section.className = 'version-stack';
    section.dataset.songKey = stack.key;
    primaryRow.classList.add('version-stack-primary');

    toggle.type = 'button';
    toggle.className = 'version-stack-toggle';
    toggle.setAttribute('aria-controls', bodyId);
    toggle.dataset.collapsedLabel = collapsedLabel;
    toggle.dataset.openLabel = openLabel;
    toggle.dataset.closeLabel = closeLabel;
    toggle.innerHTML = `
      <span class="version-stack-toggle-label"></span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    `;
    primaryRow.querySelector('.row-main')?.append(toggle);

    children.className = 'version-stack-children';
    children.id = bodyId;
    children.setAttribute('role', 'group');
    children.setAttribute('aria-label', `Другие версии трека ${primary.track.title}`);
    alternates.forEach(item => {
      const row = rows.get(item.flatIndex);
      if (!row) return;
      row.classList.add('version-stack-child');
      children.append(row);
    });

    section.append(primaryRow, children);
    fragment.append(section);
    setVersionStackExpanded(section, expanded);

    toggle.addEventListener('click', event => {
      event.stopPropagation();
      setVersionStackExpanded(section, toggle.getAttribute('aria-expanded') !== 'true');
    });
  });

  container.replaceChildren(fragment);
}

function renderSidebarQueue() {
  if (!dom.queuePreviewList) return;
  const upcoming = state.queue.slice(state.currentIndex + 1, state.currentIndex + 7);
  if (!upcoming.length) {
    dom.queuePreviewList.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:8px 10px;">Очередь пуста</div>';
    return;
  }
  dom.queuePreviewList.innerHTML = upcoming.map((t, i) => `
    <div class="sq-item" data-offset="${i + 1}" data-track-url="${esc(t.url || '')}">
      <img src="${t.thumbnail || PLACEHOLDER_IMG}" alt="" onerror="this.src='${PLACEHOLDER_IMG}'">
      <div class="sq-meta">
        <div class="sq-title">${esc(t.title)}</div>
        <div class="sq-artist">${esc(t.artist)}</div>
      </div>
    </div>
  `).join('');

  dom.queuePreviewList.querySelectorAll('.sq-item').forEach(el => {
    el.addEventListener('click', () => {
      const offset = parseInt(el.dataset.offset);
      const targetIdx = state.currentIndex + offset;
      if (state.queue[targetIdx]) {
        state.currentIndex = targetIdx;
        playTrack(state.queue[targetIdx]);
      }
    });
  });
}

function renderFsQueue() {
  if (!dom.fsQueueList) return;
  const upcoming = state.queue.slice(state.currentIndex + 1);

  if (!upcoming.length) {
    dom.fsQueueList.innerHTML = '<div class="lyrics-placeholder">Очередь пуста</div>';
    if (dom.fsNextTitle) dom.fsNextTitle.textContent = 'Конец очереди';
    if (dom.fsNextArt) dom.fsNextArt.src = PLACEHOLDER_IMG;
    return;
  }

  const nextTrack = upcoming[0];
  if (nextTrack) {
    if (dom.fsNextTitle) dom.fsNextTitle.textContent = `${nextTrack.title} — ${nextTrack.artist}`;
    if (dom.fsNextArt) dom.fsNextArt.src = nextTrack.thumbnail || PLACEHOLDER_IMG;
  }

  dom.fsQueueList.innerHTML = upcoming.map((t, i) => `
    <div class="fsq-row" data-offset="${i + 1}" data-track-url="${esc(t.url || '')}">
      <img src="${t.thumbnail || PLACEHOLDER_IMG}" alt="" onerror="this.src='${PLACEHOLDER_IMG}'">
      <div class="fsq-info">
        <div class="fsq-name">${esc(t.title)}</div>
        <div class="fsq-sub">${esc(t.artist)}</div>
      </div>
      <div class="row-duration">${fmtTime(t.duration)}</div>
    </div>
  `).join('');

  dom.fsQueueList.querySelectorAll('.fsq-row').forEach(el => {
    el.addEventListener('click', () => {
      const offset = parseInt(el.dataset.offset);
      const targetIdx = state.currentIndex + offset;
      if (state.queue[targetIdx]) {
        state.currentIndex = targetIdx;
        playTrack(state.queue[targetIdx]);
      }
    });
  });
}

// Playback engine
let consecutivePlaybackFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

async function playTrack(track, options = {}) {
  if (!track) return;
  if (!options.isAutoNext) consecutivePlaybackFailures = 0;

  if (options.wave === true) state.waveActive = true;
  else if (state.currentView !== 'wave') state.waveActive = false;

  const canonical = track === state.currentTrack && state.currentCanonicalTrack
    ? state.currentCanonicalTrack
    : track;
  const variants = getTrackVariants(canonical);
  const variantIndex = Number.isInteger(options.variantIndex)
    ? options.variantIndex
    : getSelectedVariantIndex(canonical, variants);
  const token = ++playToken;

  playbackSession = {
    token,
    canonical,
    variants,
    variantIndex,
    resumeTime: Number.isFinite(options.resumeTime) ? Math.max(0, options.resumeTime) : 0,
    attempts: new Map(),
    currentAttemptId: 0,
    handledAttempts: new Set(),
    historyAdded: false,
    failed: false,
  };

  state.currentCanonicalTrack = canonical;
  state.needsSessionRestore = false;
  state.restoredTime = playbackSession.resumeTime;
  state.karaokeLoopIndex = state.karaokeLoop ? state.activeLrcIdx : -1;
  state.nextTrackPrefetched = false;
  initAudioContext();
  fetchLyrics(canonical);
  persistSession();
  await attemptPlayback(playbackSession, variantIndex);
}

async function attemptPlayback(session, variantIndex) {
  if (!session || session.token !== playToken || playbackSession !== session) return;
  session.failed = false;
  const variant = session.variants[variantIndex];
  if (!variant?.url || variant.available === false) {
    handlePlaybackFailure(session.token, session.currentAttemptId, new Error('Источник недоступен'));
    return;
  }

  session.variantIndex = variantIndex;
  const attempts = session.attempts.get(variant.url) || 0;
  session.attempts.set(variant.url, attempts + 1);
  const attemptId = ++session.currentAttemptId;
  const activeTrack = materializeTrack(session.canonical, variantIndex);
  state.currentTrack = activeTrack;
  state.variantSelections[trackKey(session.canonical)] = variant.url;
  updatePlayerUI();
  persistSession();

  const resumeAt = Math.max(0, session.resumeTime || 0);
  const applyResumeTime = () => {
    if (session.token !== playToken || session.currentAttemptId !== attemptId || !resumeAt) return;
    try {
      const maxTime = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.1) : resumeAt;
      audio.currentTime = Math.min(resumeAt, maxTime);
    } catch {}
  };

  audio.addEventListener('loadedmetadata', applyResumeTime, { once: true });

  try {
    audio.src = `/api/audio?url=${encodeURIComponent(variant.url)}`;
    audio.playbackRate = state.playbackSpeed || 1;
    audio.load();
    applyResumeTime();

    const playPromise = audio.play();
    if (playPromise !== undefined) await playPromise;
    if (session.token !== playToken || session.currentAttemptId !== attemptId) return;

    applyResumeTime();
    state.isPlaying = true;
    updatePlayBtn();
    if (audioCtx?.state === 'suspended') await audioCtx.resume();

    if (!session.historyAdded) {
      session.historyAdded = true;
      addToHistory(activeTrack);
    }
    updateMediaSession();
    startVisualizer();
    prefetchNextTrack();
  } catch (err) {
    if (err.name === 'AbortError') return;
    handlePlaybackFailure(session.token, attemptId, err);
  }
}

function handlePlaybackFailure(token, attemptId, err) {
  const session = playbackSession;
  if (!session || session.token !== token || token !== playToken) return;
  if (session.handledAttempts.has(attemptId)) return;
  session.handledAttempts.add(attemptId);

  if (Number.isFinite(audio.currentTime) && audio.currentTime > 0) {
    session.resumeTime = Math.max(session.resumeTime, audio.currentTime);
  }

  const current = session.variants[session.variantIndex];
  const currentAttempts = current?.url ? (session.attempts.get(current.url) || 0) : MAX_AUTO_RETRIES + 1;
  console.warn('Playback error:', err?.message || 'unknown error');

  if (current?.url && currentAttempts <= MAX_AUTO_RETRIES) {
    setTimeout(() => {
      if (session.token === playToken) attemptPlayback(session, session.variantIndex);
    }, 500);
    return;
  }

  const fallbackIndex = session.variants.findIndex((variant, index) =>
    index !== session.variantIndex && variant.available !== false && variant.url && !(session.attempts.get(variant.url) > MAX_AUTO_RETRIES)
  );

  if (fallbackIndex >= 0) {
    const fallback = session.variants[fallbackIndex];
    toast(`${sourceName(current?.source)} недоступен — переключаю на ${sourceName(fallback.source)}`);
    setTimeout(() => {
      if (session.token === playToken) attemptPlayback(session, fallbackIndex);
    }, 150);
    return;
  }

  state.isPlaying = false;
  session.failed = true;
  updatePlayBtn();

  consecutivePlaybackFailures++;
  if (consecutivePlaybackFailures >= MAX_CONSECUTIVE_FAILURES) {
    consecutivePlaybackFailures = 0;
    toast('Воспроизведение остановлено: несколько треков подряд недоступны. Проверьте сеть или авторизацию в настройках.');
    return;
  }

  toast(`Не удалось воспроизвести «${session.canonical.title}», переход...`);
  setTimeout(() => {
    if (session.token === playToken) playNext();
  }, 800);
}

audio.addEventListener('error', () => {
  const session = playbackSession;
  if (!session || !state.currentTrack) return;
  handlePlaybackFailure(session.token, session.currentAttemptId, audio.error || new Error('Ошибка аудио'));
});

function togglePlay() {
  if (!state.currentTrack) {
    if (state.queue.length) {
      state.currentIndex = 0;
      playTrack(state.queue[0]);
    }
    return;
  }
  if (state.needsSessionRestore) {
    const restoredTrack = state.currentCanonicalTrack || state.currentTrack;
    playTrack(restoredTrack, {
      resumeTime: state.restoredTime || 0,
      variantIndex: getSelectedVariantIndex(restoredTrack),
      wave: state.waveActive,
    });
    return;
  }
  if (playbackSession?.failed) {
    const retryTrack = state.currentCanonicalTrack || state.currentTrack;
    playTrack(retryTrack, {
      resumeTime: playbackSession.resumeTime || state.restoredTime || 0,
      variantIndex: getSelectedVariantIndex(retryTrack),
      wave: state.waveActive,
    });
    return;
  }
  if (audio.paused) {
    audio.play().then(() => {
      state.isPlaying = true;
      updatePlayBtn();
    }).catch(err => {
      if (playbackSession) handlePlaybackFailure(playbackSession.token, playbackSession.currentAttemptId, err);
    });
  } else {
    audio.pause();
    state.isPlaying = false;
    updatePlayBtn();
  }
}

function playNext() {
  if (!state.queue.length) return;

  if (state.waveActive) {
    const currentIndex = waveCurrentQueueIndex();
    const nextIndex = currentIndex + 1;
    if (nextIndex >= state.queue.length) {
      state.isPlaying = false;
      updatePlayBtn();
      setWaveStatus('Подбираю следующий трек…', 'loading');
      refillWaveQueue({ playWhenReady: true });
      return;
    }
    state.currentIndex = nextIndex;
    playTrack(state.queue[nextIndex], { wave: true });
    ensureWaveBuffer();
    return;
  }

  if (state.repeat === 'one') {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }

  let next;
  if (state.shuffle) {
    next = Math.floor(Math.random() * state.queue.length);
  } else {
    next = state.currentIndex + 1;
  }

  if (next >= state.queue.length) {
    if (state.repeat === 'all') next = 0;
    else {
      state.isPlaying = false;
      updatePlayBtn();
      return;
    }
  }

  state.currentIndex = next;
  playTrack(state.queue[next]);
}

function playPrev() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  if (state.currentIndex > 0) {
    state.currentIndex--;
    playTrack(state.queue[state.currentIndex]);
  }
}

// Lyrics engine
function karaokeOffsetKey(track = state.currentCanonicalTrack || state.currentTrack, sourceId = state.currentLyricsSourceId) {
  const trackId = trackIdentity(track);
  return trackId && sourceId ? JSON.stringify([trackId, sourceId]) : '';
}

function restoreScopedKaraokeOffset(track = state.currentCanonicalTrack || state.currentTrack, sourceId = state.currentLyricsSourceId) {
  const key = karaokeOffsetKey(track, sourceId);
  const stored = key ? Number(state.karaokeOffsets[key]) : 0;
  state.karaokeOffset = Number.isFinite(stored) ? Math.max(-10, Math.min(10, stored)) : 0;
  updateKaraokeControls();
}

async function fetchLyrics(track) {
  const requestToken = ++lyricsRequestToken;
  const requestedTrackId = trackIdentity(track);
  const isCurrentRequest = () => requestToken === lyricsRequestToken
    && trackIdentity(state.currentCanonicalTrack || state.currentTrack) === requestedTrackId;

  state.lyrics = null;
  state.lyricsSources = [];
  state.currentLyricsSourceId = null;
  state.activeLrcIdx = -1;
  state.karaokeOffset = 0;
  state.karaokeLoop = false;
  state.karaokeLoopIndex = -1;
  updateKaraokeControls();

  // Immediately ensure standard track info is shown while searching for lyrics
  if (dom.playerLeft) dom.playerLeft.classList.remove('prompter-mode');
  if (dom.dockLyricsPrompter) dom.dockLyricsPrompter.classList.add('hidden');

  if (dom.drawerLyricsTitle) dom.drawerLyricsTitle.textContent = `${track.title} — ${track.artist}`;
  if (dom.waveLyricsTitle) dom.waveLyricsTitle.textContent = `${track.title} — ${track.artist}`;
  renderLyricsSkeleton(dom.lyricsDrawerBody);
  renderLyricsSkeleton(dom.fsLyricsContainer);
  renderLyricsSkeleton(dom.waveLyricsBody);
  if (dom.drawerLyricsSources) dom.drawerLyricsSources.classList.add('hidden');
  if (dom.fsLyricsSources) dom.fsLyricsSources.innerHTML = '';
  if (dom.waveLyricsSources) dom.waveLyricsSources.innerHTML = '';

  try {
    const ymVariant = getTrackVariants(track).find(v => v.source === 'yandex');
    const ymId = track.ymId || ymVariant?.ymId || ymVariant?.id;
    const ymParam = ymId ? `&ymId=${encodeURIComponent(ymId)}` : '';
    const durParam = track.duration ? `&duration=${track.duration}` : '';
    const res = await fetch(`/api/lyrics?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}${ymParam}${durParam}`);
    const data = await responseJson(res, 'Ошибка загрузки текста');
    if (!isCurrentRequest()) return;

    state.lyricsSources = data.sources || [];

    if (state.lyricsSources.length > 0) {
      state.currentLyricsSourceId = data.defaultSource || state.lyricsSources[0].id;
      renderLyricsSources();
      selectLyricsSource(state.currentLyricsSourceId);
    } else {
      if (dom.lyricsDrawerBody) dom.lyricsDrawerBody.innerHTML = '<div class="lyrics-placeholder">Текст песни не найден</div>';
      if (dom.fsLyricsContainer) dom.fsLyricsContainer.innerHTML = '<div class="lyrics-placeholder">Текст песни не найден</div>';
      if (dom.waveLyricsBody) dom.waveLyricsBody.innerHTML = '<div class="lyrics-placeholder">Текст песни не найден</div>';
      if (dom.playerLeft) dom.playerLeft.classList.remove('prompter-mode');
      if (dom.dockLyricsPrompter) dom.dockLyricsPrompter.classList.add('hidden');
    }
  } catch (err) {
    if (!isCurrentRequest()) return;
    if (dom.lyricsDrawerBody) dom.lyricsDrawerBody.innerHTML = '<div class="lyrics-placeholder">Не удалось загрузить текст</div>';
    if (dom.fsLyricsContainer) dom.fsLyricsContainer.innerHTML = '<div class="lyrics-placeholder">Не удалось загрузить текст</div>';
    if (dom.waveLyricsBody) dom.waveLyricsBody.innerHTML = '<div class="lyrics-placeholder">Не удалось загрузить текст</div>';
    if (dom.playerLeft) dom.playerLeft.classList.remove('prompter-mode');
    if (dom.dockLyricsPrompter) dom.dockLyricsPrompter.classList.add('hidden');
  }
}

function renderLyricsSources() {
  if (!state.lyricsSources.length) return;

  const chipsHtml = state.lyricsSources.map(s => `
    <button class="lyrics-src-chip ${s.id === state.currentLyricsSourceId ? 'active' : ''}" data-source-id="${s.id}">
      ${s.synced ? 'Synced' : 'Text'} · ${esc(s.name)}
    </button>
  `).join('');

  const pillsHtml = state.lyricsSources.map(s => `
    <button class="cinema-src-pill ${s.id === state.currentLyricsSourceId ? 'active' : ''}" data-source-id="${s.id}">
      ${s.synced ? 'Synced' : 'Text'} · ${esc(s.name)}
    </button>
  `).join('');

  const waveHtml = state.lyricsSources.map(s => `
    <button class="wave-lyrics-chip ${s.id === state.currentLyricsSourceId ? 'active' : ''}" data-source-id="${s.id}">
      ${s.synced ? 'Synced' : 'Static'} · ${esc(s.name)}
    </button>
  `).join('');

  if (dom.drawerLyricsSources) {
    dom.drawerLyricsSources.innerHTML = chipsHtml;
    dom.drawerLyricsSources.classList.remove('hidden');
  }

  if (dom.fsLyricsSources) dom.fsLyricsSources.innerHTML = pillsHtml;
  if (dom.waveLyricsSources) dom.waveLyricsSources.innerHTML = waveHtml;

  const handleSourceClick = e => {
    const btn = e.target.closest('[data-source-id]');
    if (btn) {
      selectLyricsSource(btn.dataset.sourceId);
    }
  };

  if (dom.drawerLyricsSources) dom.drawerLyricsSources.onclick = handleSourceClick;
  if (dom.fsLyricsSources) dom.fsLyricsSources.onclick = handleSourceClick;
  if (dom.waveLyricsSources) dom.waveLyricsSources.onclick = handleSourceClick;
}

function selectLyricsSource(sourceId) {
  const srcObj = state.lyricsSources.find(s => s.id === sourceId) || state.lyricsSources[0];
  if (!srcObj) return;
  state.currentLyricsSourceId = srcObj.id;
  restoreScopedKaraokeOffset(state.currentCanonicalTrack || state.currentTrack, srcObj.id);

  // Highlight active buttons
  $$('.lyrics-src-chip').forEach(el => el.classList.toggle('active', el.dataset.sourceId === srcObj.id));
  $$('.cinema-src-pill').forEach(el => el.classList.toggle('active', el.dataset.sourceId === srcObj.id));
  $$('.wave-lyrics-chip').forEach(el => el.classList.toggle('active', el.dataset.sourceId === srcObj.id));

  const parsed = srcObj.syncedLyrics ? parseLrc(srcObj.syncedLyrics) : [];
  state.lyrics = {
    plainLyrics: srcObj.plainLyrics,
    syncedLyrics: srcObj.syncedLyrics,
    parsedLrc: parsed,
  };
  state.activeLrcIdx = -999;
  state.karaokeLoop = false;
  state.karaokeLoopIndex = -1;
  updateKaraokeControls();

  renderLyrics();
  updateLyricsHighlight(audio.currentTime, true);
}

function parseLrc(lrcText) {
  if (!lrcText) return [];
  const rawLines = lrcText.split('\n');
  const parsed = [];
  const regex = /\[(\d{2}):(\d{2}(?:\.\d+)?)\](.*)/;

  for (const line of rawLines) {
    const match = line.match(regex);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseFloat(match[2]);
      const time = min * 60 + sec;
      const text = match[3].trim();
      if (text) {
        parsed.push({ time, text });
      }
    }
  }
  parsed.sort((a, b) => a.time - b.time);

  // Insert instrumental solo breaks when gap between lines >= 7s
  const result = [];
  for (let i = 0; i < parsed.length; i++) {
    const curr = parsed[i];
    const prev = parsed[i - 1];
    if (prev && (curr.time - prev.time >= 7)) {
      result.push({
        isBreak: true,
        time: prev.time + 1,
        text: 'Проигрыш',
      });
    }
    result.push(curr);
  }
  return result;
}

function correctedLyricTime(line) {
  return Math.max(0, (line?.time || 0) + state.karaokeOffset);
}

function renderLyrics() {
  if (!state.lyrics) return;

  if (state.lyrics.parsedLrc && state.lyrics.parsedLrc.length > 0) {
    const lines = state.lyrics.parsedLrc;

    const htmlDrawer = lines.map((l, i) => {
      const correctedTime = correctedLyricTime(l);
      if (l.isBreak) {
        return `
          <div class="lrc-break-line" data-idx="${i}" data-time="${correctedTime}" data-original-time="${l.time}">
            <span class="lrc-break-dots"><span></span><span></span><span></span></span>
            <span>Проигрыш</span>
          </div>
        `;
      }
      return `
        <div class="lrc-row" data-idx="${i}" data-time="${correctedTime}" data-original-time="${l.time}">
          <div class="lrc-text">${esc(l.text)}</div>
        </div>
      `;
    }).join('');

    const htmlFs = lines.map((l, i) => {
      const correctedTime = correctedLyricTime(l);
      if (l.isBreak) {
        return `
          <div class="lrc-break-line" data-idx="${i}" data-time="${correctedTime}" data-original-time="${l.time}">
            <span class="lrc-break-dots"><span></span><span></span><span></span></span>
            <span>Инструментальное соло</span>
          </div>
        `;
      }
      return `
        <div class="fs-lrc-row" data-idx="${i}" data-time="${correctedTime}" data-original-time="${l.time}">
          <span class="fs-lrc-play-badge">▶ ${fmtTime(correctedTime)}</span>
          <div class="fs-lrc-text">${esc(l.text)}</div>
        </div>
      `;
    }).join('');

    if (dom.lyricsDrawerBody) dom.lyricsDrawerBody.innerHTML = htmlDrawer;
    if (dom.fsLyricsContainer) dom.fsLyricsContainer.innerHTML = htmlFs;
    if (dom.waveLyricsBody) dom.waveLyricsBody.innerHTML = htmlDrawer;

    const handleLineClick = e => {
      const el = e.target.closest('[data-time]');
      if (el) {
        const time = parseFloat(el.dataset.time);
        const lineIndex = parseInt(el.dataset.idx, 10);
        audio.currentTime = time;
        if (state.karaokeLoop && Number.isInteger(lineIndex)) state.karaokeLoopIndex = lineIndex;
        state.isUserScrollingDrawer = false;
        state.isUserScrollingFs = false;
        if (dom.drawerLrcResumeBtn) dom.drawerLrcResumeBtn.classList.add('hidden');
        if (dom.fsLrcResumeBtn) dom.fsLrcResumeBtn.classList.add('hidden');
        updateLyricsHighlight(time, true);
      }
    };
    if (dom.lyricsDrawerBody) dom.lyricsDrawerBody.onclick = handleLineClick;
    if (dom.fsLyricsContainer) dom.fsLyricsContainer.onclick = handleLineClick;
    if (dom.waveLyricsBody) dom.waveLyricsBody.onclick = handleLineClick;
  } else if (state.lyrics.plainLyrics) {
    if (dom.lyricsDrawerBody) dom.lyricsDrawerBody.innerHTML = `<div class="plain-lyrics-text">${esc(state.lyrics.plainLyrics)}</div>`;
    if (dom.fsLyricsContainer) dom.fsLyricsContainer.innerHTML = `<div class="fs-plain-lyrics">${esc(state.lyrics.plainLyrics)}</div>`;
    if (dom.waveLyricsBody) dom.waveLyricsBody.innerHTML = `<div class="plain-lyrics-text">${esc(state.lyrics.plainLyrics)}</div>`;
  }
}

function scrollActiveLyric(container, activeEl) {
  if (!container || !activeEl) return;
  const cRect = container.getBoundingClientRect();
  const eRect = activeEl.getBoundingClientRect();
  const currentOffset = eRect.top - cRect.top + container.scrollTop;
  const targetTop = currentOffset - (container.clientHeight / 2) + (activeEl.clientHeight / 2);
  container.scrollTo({
    top: Math.max(0, targetTop),
    behavior: 'smooth'
  });
}

function updateLyricsHighlight(currentTime, force = false) {
  const isLyricOn = state.settings?.lyricMode !== 'off';
  const hasSyncedLyrics = Boolean(state.lyrics && state.lyrics.parsedLrc && state.lyrics.parsedLrc.length > 0);

  if (!isLyricOn || !hasSyncedLyrics) {
    if (dom.playerLeft) dom.playerLeft.classList.remove('prompter-mode');
    if (dom.dockLyricsPrompter) dom.dockLyricsPrompter.classList.add('hidden');
    return;
  }

  const lines = state.lyrics.parsedLrc;

  let activeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const threshold = correctedLyricTime(l);
    if (currentTime >= threshold) {
      activeIdx = i;
    } else {
      break;
    }
  }

  if (activeIdx !== state.activeLrcIdx || force) {
    state.activeLrcIdx = activeIdx;

    let curText = '';
    let nextText = '';

    if (activeIdx === -1) {
      // Song intro before first singing line
      curText = state.currentTrack ? state.currentTrack.title : 'Вступление';
      const firstLine = lines.find(l => l.text && !l.isBreak);
      nextText = firstLine ? `1-я строка: ${firstLine.text}` : (state.currentTrack ? state.currentTrack.artist : '');
    } else {
      const curL = lines[activeIdx];
      curText = curL.isBreak ? 'Инструментальный проигрыш' : curL.text;

      // Find next upcoming singing line
      for (let j = activeIdx + 1; j < lines.length; j++) {
        if (lines[j].text && !lines[j].isBreak) {
          nextText = lines[j].text;
          break;
        }
      }
      if (!nextText && state.currentTrack) {
        nextText = `${state.currentTrack.title} — ${state.currentTrack.artist}`;
      }
    }

    // Complete replacement of title and artist with smooth rolling 2-line karaoke
    if (dom.playerLeft) dom.playerLeft.classList.add('prompter-mode');
    if (dom.dockLyricsPrompter) {
      dom.dockLyricsPrompter.classList.remove('hidden');
      if (dom.prompterCurText) dom.prompterCurText.textContent = curText;
      if (dom.prompterNextText) dom.prompterNextText.textContent = nextText;

      // Trigger selected animation mode
      const anim = state.settings?.lyricAnim || 'slide';
      if (dom.prompterRoller) {
        dom.prompterRoller.className = `prompter-roller anim-${anim}`;
        if (anim !== 'none') {
          void dom.prompterRoller.offsetWidth; // force reflow
          dom.prompterRoller.classList.add('rolling');
        }
      }
    }

    dom.lyricsDrawerBody?.querySelectorAll('.lrc-row, .lrc-break-line').forEach((el, idx) => {
      const isAct = idx === activeIdx;
      const isPast = idx < activeIdx;
      el.classList.toggle('active', isAct);
      el.classList.toggle('past', isPast);
    });
    dom.fsLyricsContainer?.querySelectorAll('.fs-lrc-row, .lrc-break-line').forEach((el, idx) => {
      const isAct = idx === activeIdx;
      const isPast = idx < activeIdx;
      el.classList.toggle('active', isAct);
      el.classList.toggle('past', isPast);
    });
    dom.waveLyricsBody?.querySelectorAll('.lrc-row, .lrc-break-line').forEach((el, idx) => {
      const isAct = idx === activeIdx;
      const isPast = idx < activeIdx;
      el.classList.toggle('active', isAct);
      el.classList.toggle('past', isPast);
    });

    if (activeIdx >= 0) {
      const drawerActive = dom.lyricsDrawerBody?.querySelector(`.lrc-row[data-idx="${activeIdx}"], .lrc-break-line[data-idx="${activeIdx}"]`);
      if (drawerActive && !state.isUserScrollingDrawer) scrollActiveLyric(dom.lyricsDrawerBody, drawerActive);

      const fsActive = dom.fsLyricsContainer?.querySelector(`.fs-lrc-row[data-idx="${activeIdx}"], .lrc-break-line[data-idx="${activeIdx}"]`);
      if (fsActive && state.isFullscreen && state.fsActiveTab === 'lyrics' && !state.isUserScrollingFs) scrollActiveLyric(dom.fsLyricsContainer, fsActive);

      const waveActive = dom.waveLyricsBody?.querySelector(`.lrc-row[data-idx="${activeIdx}"], .lrc-break-line[data-idx="${activeIdx}"]`);
      if (waveActive && state.currentView === 'wave' && state.waveLyricsOpen && !state.isUserScrollingWaveLyrics) {
        scrollActiveLyric(dom.waveLyricsBody, waveActive);
      }
    }
  }
}

function copyLyricsText() {
  if (!state.lyrics) return toast('Текст не найден');
  let text = '';
  if (state.lyrics.parsedLrc?.length) {
    text = state.lyrics.parsedLrc.filter(l => !l.isBreak).map(l => l.text).join('\n');
  } else if (state.lyrics.plainLyrics) {
    text = state.lyrics.plainLyrics;
  }
  if (!text) return toast('Текст пуст');
  navigator.clipboard.writeText(text).then(() => {
    toast('Текст песни скопирован');
  }).catch(() => {
    toast('Не удалось скопировать текст');
  });
}

function adjustLrcFontSize(delta) {
  state.lrcFontSize = Math.max(18, Math.min(38, (state.lrcFontSize || 26) + delta));
  document.documentElement.style.setProperty('--lrc-fs-size', `${state.lrcFontSize}px`);
  toast(`Размер текста: ${state.lrcFontSize}px`);
}

function updateKaraokeControls() {
  const label = `${state.karaokeOffset >= 0 ? '+' : '−'}${Math.abs(state.karaokeOffset).toFixed(2)}с`;
  [dom.karaokeOffsetValue, dom.fsKaraokeOffsetValue].forEach(el => {
    if (el) el.textContent = label;
  });
  [dom.karaokeLoopBtn, dom.fsKaraokeLoopBtn].forEach(btn => {
    if (!btn) return;
    btn.classList.toggle('active', state.karaokeLoop);
    btn.setAttribute('aria-pressed', String(state.karaokeLoop));
    btn.title = state.karaokeLoop ? 'Отключить повтор строки' : 'Повторять текущую строку';
  });
}

function adjustKaraokeOffset(delta) {
  const key = karaokeOffsetKey();
  if (!key || !state.lyrics?.parsedLrc?.length) return toast('Сначала выберите синхронный текст');
  state.karaokeOffset = Math.round(Math.max(-10, Math.min(10, state.karaokeOffset + delta)) * 100) / 100;
  state.karaokeOffsets[key] = state.karaokeOffset;
  saveJSON('lf_karaoke_offsets', state.karaokeOffsets);
  updateKaraokeControls();
  if (state.lyrics?.parsedLrc?.length) {
    renderLyrics();
    updateLyricsHighlight(audio.currentTime, true);
  }
}

function toggleKaraokeLoop() {
  if (!state.lyrics?.parsedLrc?.length) return toast('Для повтора нужен синхронный текст');
  state.karaokeLoop = !state.karaokeLoop;
  if (state.karaokeLoop) {
    let idx = state.activeLrcIdx;
    state.karaokeLoopIndex = idx >= 0 ? idx : state.lyrics.parsedLrc.findIndex(line => !line.isBreak);
    if (state.karaokeLoopIndex >= 0) audio.currentTime = correctedLyricTime(state.lyrics.parsedLrc[state.karaokeLoopIndex]);
  } else {
    state.karaokeLoopIndex = -1;
  }
  updateKaraokeControls();
}

function enforceKaraokeLoop(currentTime) {
  if (!state.karaokeLoop || !state.lyrics?.parsedLrc?.length || state.karaokeLoopIndex < 0) return false;
  const lines = state.lyrics.parsedLrc;
  const line = lines[state.karaokeLoopIndex];
  if (!line) return false;
  const start = correctedLyricTime(line);
  const nextLine = lines[state.karaokeLoopIndex + 1];
  const fallbackEnd = Number.isFinite(audio.duration) && audio.duration > start
    ? Math.min(audio.duration, start + 8)
    : start + 8;
  const end = Math.max(start + 0.5, nextLine ? correctedLyricTime(nextLine) : fallbackEnd);
  if (currentTime >= end - 0.03 || currentTime < start - 0.2) {
    audio.currentTime = start;
    updateLyricsHighlight(start, true);
    return true;
  }
  return false;
}

function formatLrcTimestamp(seconds) {
  const safe = Math.max(0, seconds || 0);
  const totalHundredths = Math.round(safe * 100);
  const minutes = Math.floor(totalHundredths / 6000);
  const secs = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function exportCorrectedLrc() {
  const lines = state.lyrics?.parsedLrc?.filter(line => !line.isBreak) || [];
  if (!lines.length) return toast('Синхронный LRC не найден');
  const lrc = lines.map(line => `[${formatLrcTimestamp(correctedLyricTime(line))}]${line.text}`).join('\n');
  const baseName = `${state.currentTrack?.artist || 'artist'} - ${state.currentTrack?.title || 'track'}`.replace(/[\\/:*?"<>|]/g, '_');
  downloadBlob(lrc, `${baseName} corrected.lrc`, 'text/plain;charset=utf-8');
  toast('Исправленный LRC сохранён');
}

function initLyricsControls() {
  // Copy buttons
  if (dom.drawerCopyLyricsBtn) dom.drawerCopyLyricsBtn.onclick = copyLyricsText;
  if (dom.fsLrcCopyBtn) dom.fsLrcCopyBtn.onclick = copyLyricsText;

  // Font adjustments
  if (dom.fsLrcFontDecBtn) dom.fsLrcFontDecBtn.onclick = () => adjustLrcFontSize(-3);
  if (dom.fsLrcFontIncBtn) dom.fsLrcFontIncBtn.onclick = () => adjustLrcFontSize(3);

  // Karaoke Lab controls are mirrored in the drawer and fullscreen player.
  [dom.karaokeOffsetDown, dom.fsKaraokeOffsetDown].forEach(btn => {
    if (btn) btn.onclick = () => adjustKaraokeOffset(-0.25);
  });
  [dom.karaokeOffsetUp, dom.fsKaraokeOffsetUp].forEach(btn => {
    if (btn) btn.onclick = () => adjustKaraokeOffset(0.25);
  });
  [dom.karaokeLoopBtn, dom.fsKaraokeLoopBtn].forEach(btn => {
    if (btn) btn.onclick = toggleKaraokeLoop;
  });
  [dom.karaokeExportBtn, dom.fsKaraokeExportBtn].forEach(btn => {
    if (btn) btn.onclick = exportCorrectedLrc;
  });
  updateKaraokeControls();

  // Resume buttons
  const resumeDrawer = () => {
    state.isUserScrollingDrawer = false;
    if (dom.drawerLrcResumeBtn) dom.drawerLrcResumeBtn.classList.add('hidden');
    if (state.activeLrcIdx >= 0) {
      const el = dom.lyricsDrawerBody.querySelector(`[data-idx="${state.activeLrcIdx}"]`);
      if (el) scrollActiveLyric(dom.lyricsDrawerBody, el);
    }
  };

  const resumeFs = () => {
    state.isUserScrollingFs = false;
    if (dom.fsLrcResumeBtn) dom.fsLrcResumeBtn.classList.add('hidden');
    if (state.activeLrcIdx >= 0) {
      const el = dom.fsLyricsContainer.querySelector(`[data-idx="${state.activeLrcIdx}"]`);
      if (el) scrollActiveLyric(dom.fsLyricsContainer, el);
    }
  };

  if (dom.drawerLrcResumeBtn) dom.drawerLrcResumeBtn.onclick = resumeDrawer;
  if (dom.fsLrcResumeBtn) dom.fsLrcResumeBtn.onclick = resumeFs;

  // Real user manual scroll detection (wheel / touchmove)
  let drawerTimer = null;
  const handleDrawerManualScroll = () => {
    if (!state.lyrics || !state.lyrics.parsedLrc?.length) return;
    state.isUserScrollingDrawer = true;
    if (dom.drawerLrcResumeBtn) dom.drawerLrcResumeBtn.classList.remove('hidden');
    clearTimeout(drawerTimer);
    drawerTimer = setTimeout(() => {
      state.isUserScrollingDrawer = false;
      if (dom.drawerLrcResumeBtn) dom.drawerLrcResumeBtn.classList.add('hidden');
    }, 4500);
  };
  dom.lyricsDrawerBody?.addEventListener('wheel', handleDrawerManualScroll, { passive: true });
  dom.lyricsDrawerBody?.addEventListener('touchmove', handleDrawerManualScroll, { passive: true });

  let fsTimer = null;
  const handleFsManualScroll = () => {
    if (!state.lyrics || !state.lyrics.parsedLrc?.length) return;
    state.isUserScrollingFs = true;
    if (dom.fsLrcResumeBtn) dom.fsLrcResumeBtn.classList.remove('hidden');
    clearTimeout(fsTimer);
    fsTimer = setTimeout(() => {
      state.isUserScrollingFs = false;
      if (dom.fsLrcResumeBtn) dom.fsLrcResumeBtn.classList.add('hidden');
    }, 4500);
  };
  dom.fsLyricsContainer?.addEventListener('wheel', handleFsManualScroll, { passive: true });
  dom.fsLyricsContainer?.addEventListener('touchmove', handleFsManualScroll, { passive: true });
}

function toggleLyricsDrawer() {
  state.drawerLyricsOpen = !state.drawerLyricsOpen;
  dom.lyricsDrawer.classList.toggle('hidden', !state.drawerLyricsOpen);
  dom.lyricsBtn.classList.toggle('active', state.drawerLyricsOpen);
  dom.waveLyricsBtn?.classList.toggle('active', state.drawerLyricsOpen);
  document.body.classList.toggle('inspector-open', state.drawerLyricsOpen);
  if (state.drawerLyricsOpen && state.activeLrcIdx >= 0) {
    const activeEl = dom.lyricsDrawerBody.querySelector(`[data-idx="${state.activeLrcIdx}"]`);
    if (activeEl) scrollActiveLyric(dom.lyricsDrawerBody, activeEl);
  }
}

function toggleWaveLyrics() {
  state.waveLyricsOpen = !state.waveLyricsOpen;
  dom.waveView?.classList.toggle('wave-lyrics-closed', !state.waveLyricsOpen);
  dom.waveLyricsPanel?.setAttribute('aria-hidden', String(!state.waveLyricsOpen));
  dom.waveLyricsBtn?.classList.toggle('active', state.waveLyricsOpen);
  dom.waveLyricsBtn?.setAttribute('aria-pressed', String(state.waveLyricsOpen));
  if (state.waveLyricsOpen && state.activeLrcIdx >= 0) {
    const activeEl = dom.waveLyricsBody?.querySelector(`[data-idx="${state.activeLrcIdx}"]`);
    if (activeEl) scrollActiveLyric(dom.waveLyricsBody, activeEl);
  }
}

function openWaveFullscreen(tab = 'stage') {
  setFsTab(tab);
  openFullscreen();
}

function preferredSourceForWave() {
  if (state.waveSource) return state.waveSource;
  if (state.searchSource === 'youtube') return 'youtube';
  if (state.searchSource === 'yandex') return 'yandex';
  return 'custom';
}

function setSearchSource(source, options = {}) {
  if (!['all', 'youtube', 'yandex'].includes(source)) source = 'all';
  state.searchSource = source;
  localStorage.setItem('lf_source_preference', source);
  $$('.source-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.source === source));
  if (options.search && dom.searchInput?.value.trim()) search(dom.searchInput.value);
}

function setWaveSource(source) {
  if (!['custom', 'youtube', 'yandex'].includes(source)) source = 'custom';
  state.waveSource = source;
  localStorage.setItem('lf_wave_source', source);
  dom.waveSourceTabs?.querySelectorAll('.wave-mode').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.waveSource === source);
    btn.setAttribute('aria-pressed', String(btn.dataset.waveSource === source));
  });
  syncWaveStationSelection();
}

function setWaveMood(mood, options = {}) {
  const buttons = [...(dom.waveMoodTabs?.querySelectorAll('[data-wave-mood]') || [])];
  const selected = buttons.find(btn => btn.dataset.waveMood === mood) || buttons[0];
  state.waveMood = selected?.dataset.waveMood || 'all';
  localStorage.setItem('lf_wave_mood', state.waveMood);
  buttons.forEach(btn => btn.classList.toggle('active', btn === selected));
  if (options.syncInput !== false && dom.waveSeedInput && selected) {
    dom.waveSeedInput.value = selected.dataset.waveSeed || '';
  }
}

function defaultWaveStations() {
  return [
    { id: 'custom:auto', stationId: 'auto', provider: 'custom', title: 'Твоя волна', subtitle: 'YouTube + Яндекс' },
    { id: 'youtube:rdmm', stationId: 'RDMM', provider: 'youtube', title: 'Мой микс', subtitle: 'YouTube Music · RDMM' },
    { id: 'youtube:liked', stationId: 'LM', provider: 'youtube', title: 'Понравившиеся', subtitle: 'YouTube Music · LM' },
    { id: 'yandex:user:onyourwave', stationId: 'user:onyourwave', provider: 'yandex', title: 'Моя волна', subtitle: 'Яндекс Музыка · Rotor' },
  ];
}

function normalizeWaveStation(raw, providerHint = '') {
  if (!raw || typeof raw !== 'object') return null;
  const provider = ['custom', 'youtube', 'yandex'].includes(raw.provider || raw.source)
    ? (raw.provider || raw.source)
    : providerHint;
  if (!['custom', 'youtube', 'yandex'].includes(provider)) return null;
  const providerId = String(raw.stationId || raw.providerId || raw.tag || raw.id || '').trim();
  if (!providerId) return null;
  const canonicalId = String(raw.id || '').startsWith(`${provider}:`)
    ? String(raw.id)
    : `${provider}:${providerId}`;
  return {
    id: canonicalId,
    stationId: providerId.replace(new RegExp(`^${provider}:`), ''),
    provider,
    title: String(raw.title || raw.name || 'Станция'),
    subtitle: String(raw.subtitle || raw.description || (provider === 'youtube' ? 'YouTube Music' : provider === 'yandex' ? 'Яндекс Музыка' : 'YouTube + Яндекс')),
    thumbnail: String(raw.thumbnail || raw.image || raw.icon || ''),
  };
}

function waveStationArt(station) {
  if (station.thumbnail && /^https?:\/\//i.test(station.thumbnail)) {
    return `<span class="wave-station-art station-art-image"><img src="${esc(station.thumbnail)}" alt="" loading="lazy"></span>`;
  }
  if (station.provider === 'youtube') {
    return `<span class="wave-station-art station-art-youtube"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8ZM9.5 15.6V8.4l6.3 3.6-6.3 3.6Z"/></svg></span>`;
  }
  if (station.provider === 'yandex') return '<span class="wave-station-art station-art-yandex">Я</span>';
  return '<span class="wave-station-art station-art-custom"><span>SF</span></span>';
}

function syncWaveStationSelection() {
  const buttons = [...(dom.waveStationList?.querySelectorAll('[data-wave-station-id]') || [])];
  let matched = false;
  let activeButton = null;
  buttons.forEach(btn => {
    const byId = state.waveStationId && btn.dataset.waveStationId === state.waveStationId;
    const bySource = !state.waveStationId && !matched && btn.dataset.waveStationSource === state.waveSource;
    const active = byId || bySource;
    if (active) {
      matched = true;
      activeButton = btn;
    }
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  if (activeButton && dom.waveStationList) requestAnimationFrame(() => {
    const targetLeft = activeButton.offsetLeft - (dom.waveStationList.clientWidth - activeButton.offsetWidth) / 2;
    dom.waveStationList.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  });
}

function selectWaveStation(station) {
  if (!station) return;
  state.waveStationId = station.id;
  state.waveStationProviderId = station.stationId;
  localStorage.setItem('lf_wave_station', station.id);
  setWaveSource(station.provider);
  syncWaveStationSelection();
  renderWaveStage();
}

function renderWaveStations() {
  if (!dom.waveStationList) return;
  const order = ['custom', 'youtube', 'yandex'];
  const stations = order.flatMap(provider => state.waveStations.filter(station => station.provider === provider));
  dom.waveStationList.innerHTML = stations.map(station => `
      <button class="wave-station-card" data-wave-station-source="${station.provider}" data-wave-station-id="${esc(station.id)}" aria-pressed="false">
        ${waveStationArt(station)}
        <span class="wave-station-copy"><strong>${esc(station.title)}</strong><small>${esc(station.subtitle)}</small></span>
        <span class="wave-station-eq" aria-hidden="true"><i></i><i></i><i></i></span>
      </button>
    `).join('');
  syncWaveStationSelection();
}

async function loadWaveStations() {
  const fallback = defaultWaveStations();
  try {
    const providers = ['youtube', 'yandex'];
    const settled = await Promise.allSettled(providers.map(async provider => {
      const res = await fetch(`/api/wave/stations?source=${provider}&limit=10`);
      const data = await responseJson(res, `Не удалось загрузить станции ${provider}`);
      return (data.stations || data.items || []).map(station => normalizeWaveStation(station, provider)).filter(Boolean);
    }));
    const remote = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    const custom = fallback.filter(station => station.provider === 'custom');
    const providerFallbacks = fallback.filter(station => station.provider !== 'custom' && !remote.some(item => item.provider === station.provider));
    const seen = new Set();
    state.waveStations = [...custom, ...remote, ...providerFallbacks].filter(station => {
      if (seen.has(station.id)) return false;
      seen.add(station.id);
      return true;
    });
  } catch {
    state.waveStations = fallback;
  }

  let selected = state.waveStations.find(station => station.id === state.waveStationId);
  if (!selected) selected = state.waveStations.find(station => station.provider === state.waveSource) || state.waveStations[0];
  if (selected) selectWaveStation(selected);
  renderWaveStations();
}

function waveContext(seedOverride = '') {
  return {
    seed: seedOverride || dom.waveSeedInput?.value.trim() || '',
    currentTrack: state.currentCanonicalTrack || state.currentTrack || null,
    queue: state.queue.slice(Math.max(0, state.currentIndex), state.currentIndex + 14),
    liked: state.liked.slice(0, 60),
    history: state.history.slice(0, 60),
    disliked: state.waveDislikes.slice(0, 100),
  };
}

function setWaveStatus(text, tone = 'idle') {
  if (!dom.waveStatus) return;
  dom.waveStatus.dataset.tone = tone;
  dom.waveStatus.innerHTML = `<span class="wave-status-dot"></span><span>${esc(text)}</span>`;
}

function renderRecommendationCards(tracks) {
  if (!dom.hubRecommendations) return;
  if (!tracks.length) {
    dom.hubRecommendations.innerHTML = `
      <button class="rec-pill" data-wave-source="custom">Моя волна</button>
      <button class="rec-pill" data-wave-source="youtube">YouTube Wave</button>
      <button class="rec-pill" data-wave-source="yandex">Яндекс Волна</button>
    `;
    bindRecommendationPills();
    return;
  }

  dom.hubRecommendations.innerHTML = tracks.slice(0, 8).map((track, index) => `
    <button class="rec-track-card" data-idx="${index}" title="${esc(`${track.title} — ${track.artist}`)}">
      <img src="${track.thumbnail || PLACEHOLDER_IMG}" alt="" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'">
      <span>
        <strong>${esc(track.title)}</strong>
        <em>${esc(track.artist)}</em>
      </span>
    </button>
  `).join('');

  dom.hubRecommendations.querySelectorAll('.rec-track-card').forEach(card => {
    card.onclick = () => {
      const idx = parseInt(card.dataset.idx, 10);
      if (!Number.isInteger(idx) || !tracks[idx]) return;
      state.queue = [...tracks];
      state.currentIndex = idx;
      playTrack(tracks[idx]);
    };
  });
}

function bindRecommendationPills() {
  dom.hubRecommendations?.querySelectorAll('[data-wave-source]').forEach(btn => {
    btn.onclick = () => {
      const source = btn.dataset.waveSource || preferredSourceForWave();
      const station = state.waveStations.find(item => item.provider === source);
      if (station) selectWaveStation(station);
      else setWaveSource(source);
      showView('wave');
      loadWave({ source, play: true });
    };
  });
}

async function loadHomeRecommendations() {
  if (!dom.hubRecommendations) return;
  if (homeRecommendationsLoading) return;
  homeRecommendationsLoading = true;
  dom.hubRecommendations.innerHTML = '<div class="rec-loading">Собираю рекомендации...</div>';
  try {
    const data = await requestWave({ source: preferredSourceForWave(), limit: 12 });
    state.homeRecommendations = data.tracks || [];
    renderRecommendationCards(state.homeRecommendations);
  } catch (err) {
    dom.hubRecommendations.innerHTML = '<div class="rec-loading">Рекомендации пока не собрались</div>';
  } finally {
    homeRecommendationsLoading = false;
  }
}

async function requestWave(options = {}) {
  const source = options.source || preferredSourceForWave();
  const selectedStation = state.waveStations.find(station => station.id === state.waveStationId);
  const inferredStationId = selectedStation?.provider === source ? selectedStation.stationId : undefined;
  const stationId = options.stationId || inferredStationId;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  try {
    const res = await fetch('/api/wave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        source,
        stationId: stationId || undefined,
        limit: options.limit || 14,
        context: waveContext(options.seed || ''),
      }),
    });
    return await responseJson(res, 'Не удалось собрать волну');
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Волна отвечает слишком долго');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function uniqueWaveTracks(tracks) {
  const disliked = new Set(state.waveDislikes.map(trackKey));
  const seen = new Set();
  return (tracks || []).filter(track => {
    const key = trackKey(track);
    if (!key || disliked.has(key) || seen.has(key)) return false;
    if (!getTrackVariants(track).some(variant => variant.available !== false && variant.url)) return false;
    seen.add(key);
    return true;
  });
}

function waveCurrentQueueIndex() {
  const currentKey = trackKey(state.currentCanonicalTrack || state.currentTrack);
  const found = currentKey ? state.queue.findIndex(track => trackKey(track) === currentKey) : -1;
  return found >= 0 ? found : state.currentIndex;
}

function waveNextTrack() {
  const start = waveCurrentQueueIndex();
  const disliked = new Set(state.waveDislikes.map(trackKey));
  for (let index = Math.max(-1, start) + 1; index < state.queue.length; index += 1) {
    if (!disliked.has(trackKey(state.queue[index]))) return state.queue[index];
  }
  return null;
}

function setWaveImage(img, url, fallback = PLACEHOLDER_IMG) {
  if (!img) return;
  img.src = upgradeThumb(url) || url || fallback;
  img.onerror = () => {
    img.onerror = null;
    img.src = fallback;
  };
}

function updateWavePlaybackUI() {
  if (!dom.wavePlayBtn) return;
  const playIcon = dom.wavePlayBtn.querySelector('.wave-icon-play');
  const pauseIcon = dom.wavePlayBtn.querySelector('.wave-icon-pause');
  playIcon?.classList.toggle('hidden', state.isPlaying);
  pauseIcon?.classList.toggle('hidden', !state.isPlaying);
  dom.waveRadioStage?.classList.toggle('is-playing', state.isPlaying);
  dom.waveStations?.classList.toggle('is-playing', state.waveActive && state.isPlaying);
}

function renderWaveStage() {
  const current = state.currentTrack;
  const next = state.waveActive ? waveNextTrack() : null;
  const hasCurrent = Boolean(current);
  const currentThumb = current ? (upgradeThumb(current.thumbnail) || current.thumbnail || '') : '';

  dom.waveRadioStage?.classList.toggle('is-empty', !hasCurrent);
  dom.waveRadioStage?.classList.toggle('is-loading', state.waveLoading);
  dom.waveView?.classList.toggle('wave-lyrics-closed', !state.waveLyricsOpen);
  if (dom.waveBackdrop) {
    dom.waveBackdrop.style.backgroundImage = '';
  }
  if (dom.waveRadioStage) {
    dom.waveRadioStage.style.backgroundImage = currentThumb
      ? `linear-gradient(90deg, rgba(7, 10, 14, 0.3), rgba(7, 10, 14, 0.91)), linear-gradient(0deg, rgba(7, 10, 14, 0.78), rgba(7, 10, 14, 0.34)), url(${JSON.stringify(currentThumb)})`
      : '';
  }

  if (hasCurrent) {
    setWaveImage(dom.waveNowCover, current.thumbnail);
    dom.waveNowCover?.classList.remove('hidden');
    dom.waveNowCoverEmpty?.classList.add('hidden');
    if (dom.waveNowTitle) dom.waveNowTitle.textContent = current.title || 'Без названия';
    if (dom.waveNowArtist) dom.waveNowArtist.textContent = current.artist || 'Неизвестный исполнитель';
    if (dom.waveNowSource) dom.waveNowSource.textContent = current.source === 'youtube' ? 'YouTube Music' : current.source === 'yandex' ? 'Яндекс Музыка' : sourceName(current.source);
    if (dom.waveLyricsTitle) dom.waveLyricsTitle.textContent = `${current.title || 'Без названия'} — ${current.artist || 'Неизвестный исполнитель'}`;
  } else {
    const selectedStation = state.waveStations.find(station => station.id === state.waveStationId);
    const idleStation = selectedStation
      ? [selectedStation.title, selectedStation.subtitle]
      : state.waveSource === 'youtube'
        ? ['Мой микс', 'YouTube Music подберёт продолжение']
        : state.waveSource === 'yandex'
          ? ['Моя волна', 'Нативная станция Яндекс Музыки']
          : ['Твоя волна', 'YouTube Music и Яндекс Музыка вместе'];
    dom.waveNowCover?.classList.add('hidden');
    dom.waveNowCoverEmpty?.classList.remove('hidden');
    if (dom.waveNowTitle) dom.waveNowTitle.textContent = state.waveLoading ? 'Собираю волну…' : idleStation[0];
    if (dom.waveNowArtist) dom.waveNowArtist.textContent = state.waveLoading ? 'Ищу подходящее продолжение' : idleStation[1];
    if (dom.waveNowSource) dom.waveNowSource.textContent = 'AUTO';
    if (dom.waveLyricsTitle) dom.waveLyricsTitle.textContent = 'Текущий трек';
  }

  if (next) {
    dom.waveNextCard?.classList.remove('is-empty');
    setWaveImage(dom.waveNextCover, next.thumbnail);
    if (dom.waveNextTitle) dom.waveNextTitle.textContent = next.title || 'Без названия';
    if (dom.waveNextArtist) dom.waveNextArtist.textContent = next.artist || 'Неизвестный исполнитель';
    if (dom.waveNextSource) dom.waveNextSource.textContent = next.source === 'youtube' ? 'YT MUSIC' : next.source === 'yandex' ? 'ЯНДЕКС' : sourceName(next.source);
  } else {
    dom.waveNextCard?.classList.add('is-empty');
    setWaveImage(dom.waveNextCover, null);
    if (dom.waveNextTitle) dom.waveNextTitle.textContent = state.waveLoading ? 'Подбираю следующий…' : 'Следующий ещё не выбран';
    if (dom.waveNextArtist) dom.waveNextArtist.textContent = state.waveActive ? 'Поток скоро пополнится' : 'Запусти волну';
    if (dom.waveNextSource) dom.waveNextSource.textContent = 'AUTO';
  }

  const liked = hasCurrent && state.liked.some(track => trackKey(track) === trackKey(current));
  const disliked = hasCurrent && state.waveDislikes.some(track => trackKey(track) === trackKey(current));
  dom.waveLikeBtn?.classList.toggle('active', liked);
  dom.waveLikeBtn?.classList.toggle('syncing', hasCurrent && likeSyncs.has(trackKey(current)));
  dom.waveDislikeBtn?.classList.toggle('active', disliked);
  dom.waveLyricsBtn?.classList.toggle('active', state.waveLyricsOpen);
  dom.waveLyricsBtn?.setAttribute('aria-pressed', String(state.waveLyricsOpen));
  if (dom.waveLikeBtn) dom.waveLikeBtn.disabled = !hasCurrent;
  if (dom.waveDislikeBtn) dom.waveDislikeBtn.disabled = !hasCurrent;
  if (dom.waveSkipBtn) dom.waveSkipBtn.disabled = !state.waveActive;
  if (dom.waveRejectNextBtn) dom.waveRejectNextBtn.disabled = !next;
  if (dom.wavePlayNextBtn) dom.wavePlayNextBtn.disabled = !next;

  const duration = Number.isFinite(audio.duration) ? audio.duration : Number(current?.duration) || 0;
  if (dom.waveCurrentTime) dom.waveCurrentTime.textContent = fmtTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
  if (dom.waveTotalTime) dom.waveTotalTime.textContent = fmtTime(duration);
  if (dom.waveProgressBar && duration > 0) dom.waveProgressBar.value = Math.min(1000, ((audio.currentTime || 0) / duration) * 1000);
  const runLabel = dom.waveRunBtn?.querySelector('span');
  if (runLabel) runLabel.textContent = state.waveActive ? 'Новая волна' : 'Запустить';
  updateWavePlaybackUI();
}

function renderWave(data) {
  const tracks = uniqueWaveTracks(data.tracks || []);
  state.waveData = { ...data, tracks };
  state.currentTracksList = tracks;
  if (dom.waveSubline) {
    const mode = data.native ? 'нативная станция' : data.fallback ? 'резервный микс' : 'умный микс';
    const sourceLabel = data.source === 'custom' ? 'YouTube Music + Яндекс' : data.source === 'youtube' ? 'YouTube Music' : 'Яндекс Музыка';
    dom.waveSubline.textContent = `${sourceLabel} · ${mode} · ${tracks.length} треков в запасе`;
  }
  if (dom.waveRefreshBtn) dom.waveRefreshBtn.disabled = false;
  if (dom.waveResults) dom.waveResults.textContent = tracks.length ? `Волна готова: ${tracks.length} треков` : 'Волна не нашла подходящих треков';
  return tracks;
}

async function loadWave(options = {}) {
  const source = options.source || preferredSourceForWave();
  const wasWaveActive = state.waveActive;
  const requestToken = ++waveLoadToken;
  waveRefillRun += 1;
  waveRefillPromise = null;
  wavePlayWhenBuffered = false;
  state.waveLoading = true;
  setWaveSource(source);
  showView('wave');
  setWaveStatus(source === 'yandex' ? 'Собираю Яндекс Волну…' : source === 'youtube' ? 'Собираю YouTube Music микс…' : 'Смешиваю YouTube Music и Яндекс…', 'loading');
  if (dom.waveRunBtn) dom.waveRunBtn.disabled = true;
  dom.waveRadioStage?.classList.add('is-loading');
  renderWaveStage();

  try {
    const data = await requestWave({ source, stationId: options.stationId, limit: 12, seed: options.seed });
    if (requestToken !== waveLoadToken) return;
    const tracks = renderWave(data);
    if (!tracks.length) throw new Error('Подходящих треков не нашлось');

    const current = state.currentCanonicalTrack || state.currentTrack;
    const continueCurrent = Boolean(current && wasWaveActive && !options.replaceCurrent);
    const merged = uniqueWaveTracks(continueCurrent ? [current, ...tracks] : tracks);
    state.waveActive = merged.length > 0;
    state.queue = merged;
    state.currentIndex = continueCurrent
      ? Math.max(0, merged.findIndex(track => trackKey(track) === trackKey(current)))
      : 0;
    syncQueueUI();

    setWaveStatus(
      data.native
        ? (data.station?.title ? `В эфире: ${data.station.title}` : data.source === 'youtube' ? 'YouTube Music радио запущено' : data.source === 'yandex' ? 'Нативная Яндекс Волна запущена' : 'YouTube Music и Яндекс смешаны')
        : 'Поток готов — скипай всё лишнее',
      'ok',
    );
    if (options.play) {
      if (continueCurrent) {
        if (state.needsSessionRestore || audio.paused) togglePlay();
      } else {
        playTrack(state.queue[0], { wave: true });
      }
    }
    renderWaveStage();
    ensureWaveBuffer();
    dom.waveTunePanel?.classList.add('hidden');
    dom.waveTuneBtn?.setAttribute('aria-expanded', 'false');
  } catch (err) {
    if (requestToken !== waveLoadToken) return;
    setWaveStatus(err.message || 'Волна не собралась', 'error');
    if (dom.waveResults) dom.waveResults.textContent = err.message || 'Волна не собралась';
  } finally {
    if (requestToken === waveLoadToken) {
      state.waveLoading = false;
      if (dom.waveRunBtn) dom.waveRunBtn.disabled = false;
      dom.waveRadioStage?.classList.remove('is-loading');
      renderWaveStage();
    }
  }
}

function refillWaveQueue(options = {}) {
  if (!state.waveActive) return Promise.resolve([]);
  if (options.playWhenReady) wavePlayWhenBuffered = true;
  if (waveRefillPromise) return waveRefillPromise;

  const refillId = ++waveRefillRun;
  const generation = waveLoadToken;
  const source = state.waveSource;
  const promise = requestWave({ source, limit: 12 })
    .then(data => {
      if (refillId !== waveRefillRun || generation !== waveLoadToken || source !== state.waveSource) return [];
      const existing = new Set(state.queue.map(trackKey));
      const additions = uniqueWaveTracks(data.tracks || []).filter(track => !existing.has(trackKey(track)));
      if (additions.length) {
        state.queue.push(...additions);
        state.waveData = { ...data, tracks: uniqueWaveTracks([...(state.waveData?.tracks || []), ...additions]) };
        syncQueueUI();
      }

      if (wavePlayWhenBuffered && additions.length) {
        wavePlayWhenBuffered = false;
        const nextIndex = Math.min(state.queue.length - 1, waveCurrentQueueIndex() + 1);
        state.currentIndex = nextIndex;
        playTrack(state.queue[nextIndex], { wave: true });
      } else if (wavePlayWhenBuffered && !additions.length) {
        wavePlayWhenBuffered = false;
        setWaveStatus('У станции закончились новые треки — запусти новую подборку', 'error');
      }

      renderWaveStage();
      return additions;
    })
    .catch(err => {
      if (refillId === waveRefillRun) {
        wavePlayWhenBuffered = false;
        setWaveStatus(err.message || 'Не удалось пополнить поток', 'error');
      }
      return [];
    })
    .finally(() => {
      if (refillId === waveRefillRun) {
        wavePlayWhenBuffered = false;
        waveRefillPromise = null;
      }
    });
  waveRefillPromise = promise;
  return promise;
}

function ensureWaveBuffer() {
  if (!state.waveActive) return;
  const remaining = state.queue.length - waveCurrentQueueIndex() - 1;
  if (remaining <= 4) refillWaveQueue();
}

function dislikeCurrentWaveTrack() {
  const current = state.currentCanonicalTrack || state.currentTrack;
  if (!current) return;
  state.waveDislikes = [current, ...state.waveDislikes.filter(track => trackKey(track) !== trackKey(current))].slice(0, 200);
  saveJSON('lf_wave_dislikes', state.waveDislikes);
  toast('Больше не буду предлагать этот трек');
  playNext();
}

function rejectNextWaveTrack() {
  const next = waveNextTrack();
  if (!next) return;
  const index = state.queue.findIndex((track, trackIndex) => trackIndex > waveCurrentQueueIndex() && trackKey(track) === trackKey(next));
  if (index >= 0) state.queue.splice(index, 1);
  renderWaveStage();
  ensureWaveBuffer();
}

function toggleWavePlayback() {
  if (!state.waveActive) {
    loadWave({ source: state.waveSource, play: true });
    return;
  }
  const atQueueEnd = waveCurrentQueueIndex() >= state.queue.length - 1;
  if ((audio.ended || playbackSession?.failed) && atQueueEnd) {
    setWaveStatus('Подбираю следующий трек…', 'loading');
    refillWaveQueue({ playWhenReady: true });
    return;
  }
  togglePlay();
}

function initWave() {
  setWaveSource(state.waveSource);
  setWaveMood(state.waveMood);
  dom.waveSourceTabs?.querySelectorAll('.wave-mode').forEach(btn => {
    btn.onclick = () => {
      const source = btn.dataset.waveSource;
      const station = state.waveStations.find(item => item.provider === source);
      const changed = station?.id !== state.waveStationId;
      if (station) {
        selectWaveStation(station);
        if (state.waveActive && changed) loadWave({ source, stationId: station.stationId, play: true, replaceCurrent: true });
      } else {
        setWaveSource(source);
      }
    };
  });
  if (dom.waveStationList) dom.waveStationList.onclick = event => {
    const button = event.target.closest('[data-wave-station-id]');
    if (!button) return;
    const station = state.waveStations.find(item => item.id === button.dataset.waveStationId)
      || normalizeWaveStation({
        id: button.dataset.waveStationId,
        stationId: button.dataset.waveStationId.split(':').slice(1).join(':'),
        provider: button.dataset.waveStationSource,
        title: button.querySelector('strong')?.textContent,
        subtitle: button.querySelector('small')?.textContent,
      });
    const changed = station?.id !== state.waveStationId;
    selectWaveStation(station);
    if (state.waveActive && changed) loadWave({ source: station.provider, stationId: station.stationId, play: true, replaceCurrent: true });
    else if (state.waveActive) setWaveStatus(`${station.title} играет`, 'ok');
    else {
      setWaveStatus(`${station.title} выбрана · нажми Play`, 'idle');
      renderWaveStage();
    }
  };
  if (dom.waveStationList) {
    dom.waveStationList.addEventListener('wheel', event => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      dom.waveStationList.scrollLeft += event.deltaY;
    }, { passive: false });
  }
  const scrollStations = direction => {
    if (!dom.waveStationList) return;
    dom.waveStationList.scrollBy({ left: direction * Math.max(320, dom.waveStationList.clientWidth * 0.72), behavior: 'smooth' });
  };
  if (dom.waveStationsPrev) dom.waveStationsPrev.onclick = () => scrollStations(-1);
  if (dom.waveStationsNext) dom.waveStationsNext.onclick = () => scrollStations(1);
  dom.waveMoodTabs?.querySelectorAll('[data-wave-mood]').forEach(btn => {
    btn.onclick = () => {
      setWaveMood(btn.dataset.waveMood);
      if (state.waveActive) loadWave({ source: state.waveSource, seed: btn.dataset.waveSeed || '', play: true });
    };
  });
  if (dom.waveRunBtn) dom.waveRunBtn.onclick = () => loadWave({ source: state.waveSource, play: true });
  if (dom.waveTuneBtn) {
    dom.waveTuneBtn.onclick = () => {
      const open = dom.waveTunePanel?.classList.toggle('hidden') === false;
      dom.waveTuneBtn.setAttribute('aria-expanded', String(open));
      if (open) setTimeout(() => dom.waveSeedInput?.focus(), 0);
    };
  }
  if (dom.waveRefreshBtn) dom.waveRefreshBtn.onclick = () => loadWave({ source: state.waveSource, play: false });
  if (dom.wavePlayBtn) dom.wavePlayBtn.onclick = toggleWavePlayback;
  if (dom.waveSkipBtn) dom.waveSkipBtn.onclick = playNext;
  if (dom.waveLikeBtn) dom.waveLikeBtn.onclick = () => likeTrackEverywhere(state.currentTrack);
  if (dom.waveDislikeBtn) dom.waveDislikeBtn.onclick = dislikeCurrentWaveTrack;
  if (dom.waveRejectNextBtn) dom.waveRejectNextBtn.onclick = rejectNextWaveTrack;
  if (dom.wavePlayNextBtn) dom.wavePlayNextBtn.onclick = playNext;
  if (dom.waveLyricsBtn) dom.waveLyricsBtn.onclick = toggleWaveLyrics;
  if (dom.waveLyricsCloseBtn) dom.waveLyricsCloseBtn.onclick = () => {
    if (state.waveLyricsOpen) toggleWaveLyrics();
  };
  if (dom.waveFullscreenBtn) dom.waveFullscreenBtn.onclick = () => openWaveFullscreen('stage');
  if (dom.waveLyricsFullscreenBtn) dom.waveLyricsFullscreenBtn.onclick = () => openWaveFullscreen('lyrics');
  if (dom.waveSeedInput) {
    dom.waveSeedInput.onkeydown = e => {
      if (e.key === 'Enter') loadWave({ source: state.waveSource, play: true });
    };
  }
  if (dom.waveLyricsBody) {
    let resumeTimer = null;
    const pauseAutoScroll = () => {
      state.isUserScrollingWaveLyrics = true;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { state.isUserScrollingWaveLyrics = false; }, 4200);
    };
    dom.waveLyricsBody.addEventListener('wheel', pauseAutoScroll, { passive: true });
    dom.waveLyricsBody.addEventListener('touchmove', pauseAutoScroll, { passive: true });
  }
  loadWaveStations();
  renderWaveStage();
}

function initDesktopShell() {
  const desktop = window.desktop || window.listenfoldDesktop;
  const isDesktop = Boolean(desktop?.isDesktop) || document.documentElement.classList.contains('is-desktop');
  if (!isDesktop) return;

  document.documentElement.classList.add('is-desktop');
  if (desktop?.platform) document.documentElement.dataset.platform = desktop.platform;

  const applyWindowState = stateUpdate => {
    const isMax = Boolean(stateUpdate?.maximized);
    document.documentElement.classList.toggle('desktop-window-maximized', isMax);
    document.documentElement.classList.toggle('desktop-mini-player', Boolean(stateUpdate?.miniPlayer));
    if (dom.desktopMaximizeBtn) {
      dom.desktopMaximizeBtn.title = isMax ? 'Восстановить' : 'Развернуть';
      dom.desktopMaximizeBtn.setAttribute('aria-label', isMax ? 'Восстановить окно' : 'Развернуть окно');
    }
  };

  const topbar = document.querySelector('.topbar');
  if (topbar && desktop?.window) {
    topbar.addEventListener('dblclick', e => {
      if (e.target.closest('button, input, a, [role="button"], .now-playing-art, .search-container, .brand')) return;
      desktop.window.toggleMaximize().then(applyWindowState).catch(() => {});
    });
  }

  const collapsed = getStorageItem('lf_sidebar_collapsed') === '1';
  document.body.classList.toggle('sidebar-collapsed', collapsed);

  if (dom.desktopSidebarToggle) {
    dom.desktopSidebarToggle.onclick = () => {
      const next = !document.body.classList.contains('sidebar-collapsed');
      document.body.classList.toggle('sidebar-collapsed', next);
      localStorage.setItem('lf_sidebar_collapsed', next ? '1' : '0');
      dom.desktopSidebarToggle.setAttribute('aria-pressed', String(next));
    };
    dom.desktopSidebarToggle.setAttribute('aria-pressed', String(collapsed));
  }

  if (desktop?.window) {
    dom.desktopMinimizeBtn?.addEventListener('click', () => desktop.window.minimize());
    dom.desktopMaximizeBtn?.addEventListener('click', () => desktop.window.toggleMaximize().then(applyWindowState).catch(() => {}));
    dom.desktopCloseBtn?.addEventListener('click', () => desktop.window.close());
    desktop.window.getState?.().then(applyWindowState).catch(() => {});
    desktop.window.onStateChange?.(applyWindowState);
  }

  if (desktop?.miniPlayer && dom.desktopMiniPlayerBtn) {
    dom.desktopMiniPlayerBtn.onclick = () => desktop.miniPlayer.toggle().then(enabled => {
      document.documentElement.classList.toggle('desktop-mini-player', Boolean(enabled));
    }).catch(() => {});
    desktop.miniPlayer.getState?.().then(enabled => {
      document.documentElement.classList.toggle('desktop-mini-player', Boolean(enabled));
    }).catch(() => {});
    desktop.miniPlayer.onChange?.(enabled => {
      document.documentElement.classList.toggle('desktop-mini-player', Boolean(enabled));
    });
  }

  desktop?.onMediaCommand?.(command => {
    if (command === 'play-pause') togglePlay();
    else if (command === 'next') playNext();
    else if (command === 'previous') playPrev();
  });
}

function setFsTab(tab) {
  state.fsActiveTab = tab;

  dom.fsTabStage.classList.toggle('active', tab === 'stage');
  dom.fsTabLyrics.classList.toggle('active', tab === 'lyrics');
  dom.fsTabQueue.classList.toggle('active', tab === 'queue');

  dom.fsPaneStage.classList.toggle('active', tab === 'stage');
  dom.fsPaneLyrics.classList.toggle('active', tab === 'lyrics');
  dom.fsPaneQueue.classList.toggle('active', tab === 'queue');

  if (tab === 'lyrics' && state.activeLrcIdx >= 0) {
    const activeEl = dom.fsLyricsContainer.querySelector(`[data-idx="${state.activeLrcIdx}"]`);
    if (activeEl) scrollActiveLyric(dom.fsLyricsContainer, activeEl);
  }
}

function resetPlayerProgress(resumeTime = 0) {
  const current = resumeTime > 0 ? resumeTime : 0;
  const knownDur = Number(state.currentTrack?.duration) || 0;
  const pct = (knownDur > 0 && current > 0) ? Math.min(100, (current / knownDur) * 100) : 0;
  const val = pct * 10;

  if (dom.progressBar) dom.progressBar.value = val;
  if (dom.progressFill) dom.progressFill.style.width = `${pct}%`;
  if (dom.currentTime) dom.currentTime.textContent = fmtTime(current);
  if (dom.totalTime) dom.totalTime.textContent = knownDur > 0 ? fmtTime(knownDur) : '--:--';

  if (dom.fsProgressBar) dom.fsProgressBar.value = val;
  if (dom.fsProgressFill) dom.fsProgressFill.style.width = `${pct}%`;
  if (dom.fsProgressDot) dom.fsProgressDot.style.left = `${pct}%`;
  if (dom.fsCurrentTime) dom.fsCurrentTime.textContent = fmtTime(current);
  if (dom.fsTotalTime) dom.fsTotalTime.textContent = knownDur > 0 ? fmtTime(knownDur) : '--:--';

  if (dom.waveProgressBar) dom.waveProgressBar.value = val;
  if (dom.waveCurrentTime) dom.waveCurrentTime.textContent = fmtTime(current);
  if (dom.waveTotalTime) dom.waveTotalTime.textContent = knownDur > 0 ? fmtTime(knownDur) : '--:--';
}

// UI state
function updatePlayerUI() {
  const t = state.currentTrack;
  if (!t) return;

  resetPlayerProgress(playbackSession?.resumeTime || 0);

  const displayThumb = upgradeThumb(t.thumbnail) || t.thumbnail;

  if (dom.playerTitle) dom.playerTitle.textContent = t.title;
  if (dom.playerArtist) dom.playerArtist.textContent = t.artist;

  const hasSyncedLyrics = Boolean(state.lyrics && state.lyrics.parsedLrc && state.lyrics.parsedLrc.length > 0);
  const isLyricOn = state.settings?.lyricMode !== 'off';

  if (isLyricOn && hasSyncedLyrics) {
    if (dom.playerLeft) dom.playerLeft.classList.add('prompter-mode');
    if (dom.dockLyricsPrompter) dom.dockLyricsPrompter.classList.remove('hidden');
  } else {
    if (dom.playerLeft) dom.playerLeft.classList.remove('prompter-mode');
    if (dom.dockLyricsPrompter) dom.dockLyricsPrompter.classList.add('hidden');
  }

  if (dom.playerSourceTag) {
    dom.playerSourceTag.classList.remove('hidden', 'ym', 'yt', 'local');
    dom.playerSourceTag.classList.add(sourceClass(t.source));
    dom.playerSourceTag.textContent = sourceName(t.source);
  }

  dom.playerArtwork.classList.remove('loaded');
  if (displayThumb) {
    const img = new Image();
    img.onload = () => {
      dom.playerArtwork.src = displayThumb;
      dom.playerArtwork.classList.add('loaded');
    };
    img.src = displayThumb;

    if (dom.ambientBackdrop) {
      dom.ambientBackdrop.style.backgroundImage = `url("${displayThumb}")`;
      dom.ambientBackdrop.classList.add('active');
    }
  }

  if (dom.fsTitle) dom.fsTitle.textContent = t.title;
  if (dom.fsArtist) dom.fsArtist.textContent = t.artist;
  if (dom.fsSourceBadge) {
    dom.fsSourceBadge.textContent = sourceName(t.source);
  }
  if (dom.fsQualityBadge) {
    dom.fsQualityBadge.textContent = qualityLabel(t);
  }

  if (dom.fsArtwork) {
    dom.fsArtwork.classList.remove('loaded');
    if (displayThumb) {
      const fsImg = new Image();
      fsImg.onload = () => {
        dom.fsArtwork.src = displayThumb;
        dom.fsArtwork.classList.add('loaded');
      };
      fsImg.src = displayThumb;
      if (dom.fsBackdrop) dom.fsBackdrop.style.backgroundImage = `url("${displayThumb}")`;
    }
  }

  updatePlayBtn();
  updateLikeBtn();
  renderSidebarQueue();
  renderFsQueue();
  renderDockQueue();
  highlightActiveRow();
  renderWaveStage();
  updateCounters();
  document.title = `${t.title} — ${t.artist}`;
}

function updatePlayBtn() {
  if (dom.iconPlay) dom.iconPlay.classList.toggle('hidden', state.isPlaying);
  if (dom.iconPause) dom.iconPause.classList.toggle('hidden', !state.isPlaying);
  if (dom.fsArtworkCard) dom.fsArtworkCard.classList.toggle('playing', state.isPlaying);

  if (dom.fsPlayBtn) {
    const fsPlayIcon = dom.fsPlayBtn.querySelector('.icon-play');
    const fsPauseIcon = dom.fsPlayBtn.querySelector('.icon-pause');
    if (fsPlayIcon && fsPauseIcon) {
      fsPlayIcon.classList.toggle('hidden', state.isPlaying);
      fsPauseIcon.classList.toggle('hidden', !state.isPlaying);
    }
  }
  highlightActiveRow();
  updateWavePlaybackUI();
}

function updateLikeBtn() {
  const liked = state.liked.some(t => trackKey(t) === trackKey(state.currentTrack));
  if (dom.likeBtn) dom.likeBtn.classList.toggle('active', liked);
  if (dom.fsLikeBtn) dom.fsLikeBtn.classList.toggle('active', liked);
  dom.waveLikeBtn?.classList.toggle('active', liked);
}

function trackKey(track) {
  return trackIdentity(track).replace(/\u0000/g, '|');
}

function highlightActiveRow() {
  const currentKey = trackKey(state.currentTrack);
  $$('.table-row').forEach(el => {
    const isThis = Boolean(currentKey) && el.dataset.trackId === currentKey;
    el.classList.toggle('active-row', isThis);
    el.classList.toggle('playing-row', isThis && state.isPlaying);
    el.setAttribute('aria-current', isThis ? 'true' : 'false');
    if (isThis) setVersionStackExpanded(el.closest('.version-stack'), true);
    if (isThis && Number.isInteger(state.currentTrack?.activeVariantIndex)) {
      el.querySelectorAll('.source-variant[data-variant-index]').forEach(btn => {
        const active = parseInt(btn.dataset.variantIndex, 10) === state.currentTrack.activeVariantIndex;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
    }
  });
}

function updateCounters() {
  if (dom.sidebarLikedCount) dom.sidebarLikedCount.textContent = state.liked.length;
}

function updateVolumeUI() {
  const v = audio.volume;
  const pct = v * 100;
  dom.volumeFill.style.width = `${pct}%`;
  dom.volumeBar.value = pct;

  if (dom.fsVolFill) dom.fsVolFill.style.width = `${pct}%`;
  if (dom.fsVolInput) dom.fsVolInput.value = pct;

  const volIcon = dom.volumeBtn.querySelector('svg');
  if (volIcon) {
    if (v === 0) {
      volIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`;
    } else if (v < 0.5) {
      volIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
    } else {
      volIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
    }
  }
}

function persistVolume() {
  localStorage.setItem('lf_volume', String(state.volume));
}

const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function syncPlaybackSpeedUI() {
  if (dom.dockSpeedBtn) dom.dockSpeedBtn.textContent = `${state.playbackSpeed}x`;
  if (dom.fsKaraokeSpeedBtn) dom.fsKaraokeSpeedBtn.textContent = `${state.playbackSpeed}×`;
}

function setPlaybackSpeed(speed, { persist = true, notify = true } = {}) {
  const next = Number(speed);
  if (!Number.isFinite(next) || next <= 0) return;
  state.playbackSpeed = next;
  audio.playbackRate = next;
  syncPlaybackSpeedUI();
  if (persist) persistSession();
  if (notify) toast(`Скорость воспроизведения: ${next}x`);
}

function cyclePlaybackSpeed() {
  let index = PLAYBACK_SPEEDS.indexOf(state.playbackSpeed || 1);
  if (index < 0) index = PLAYBACK_SPEEDS.indexOf(1);
  setPlaybackSpeed(PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length]);
}

function setLoading(v, text = 'Загрузка...') {
  state.isLoading = v;
  dom.loading.classList.toggle('hidden', !v);
  if (dom.loadingText) dom.loadingText.textContent = text;
}

// Fullscreen view
function openFullscreen() {
  state.isFullscreen = true;
  dom.fullscreenPlayer.classList.remove('hidden');
  renderFsQueue();
  updatePlayerUI();
}

function closeFullscreen() {
  state.isFullscreen = false;
  dom.fullscreenPlayer.classList.add('hidden');
}

function toggleFullscreen() {
  if (state.isFullscreen) closeFullscreen();
  else openFullscreen();
}

// Liked & history
function persistLikedState() {
  saveJSON('lf_liked', state.liked);
  updateLikeBtn();
  updateCounters();
  if (state.currentView === 'liked') renderTrackTable(state.liked, dom.trackList, false);
}

async function syncTrackLikeEverywhere(track) {
  const key = trackKey(track);
  if (!key) return null;
  if (likeSyncs.has(key)) return likeSyncs.get(key);

  const request = fetch('/api/library/like-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track }),
  })
    .then(res => responseJson(res, 'Не удалось синхронизировать лайк'))
    .then(data => {
      const labels = { yandex: 'Яндекс Музыка', youtube: 'YouTube Music' };
      const details = (data.results || []).map(result => {
        if (result.status === 'failed') return `${labels[result.provider] || result.provider}: ошибка`;
        if (result.status === 'already') return `${labels[result.provider] || result.provider}: уже есть`;
        return `${labels[result.provider] || result.provider}: добавлено`;
      });
      toast(details.length ? details.join(' · ') : 'Лайк синхронизирован');
      return data;
    })
    .catch(err => {
      toast(`Локально сохранено · сервисы: ${err.message}`);
      return null;
    })
    .finally(() => {
      likeSyncs.delete(key);
      renderWaveStage();
    });

  likeSyncs.set(key, request);
  renderWaveStage();
  return request;
}

function likeTrackEverywhere(track) {
  if (!track) return;
  const key = trackKey(track);
  const exists = state.liked.some(item => trackKey(item) === key);
  if (!exists) {
    state.liked.unshift({ ...track });
    state.waveDislikes = state.waveDislikes.filter(item => trackKey(item) !== key);
    saveJSON('lf_wave_dislikes', state.waveDislikes);
    persistLikedState();
    toast('Сохранено локально · синхронизирую сервисы');
  }
  syncTrackLikeEverywhere(track);
}

function toggleTrackLike(track) {
  const idx = state.liked.findIndex(t => trackKey(t) === trackKey(track));
  if (idx >= 0) {
    state.liked.splice(idx, 1);
    toast('Удалено из локального избранного');
  } else {
    state.liked.unshift({ ...track });
    toast('Сохранено локально · синхронизирую сервисы');
    syncTrackLikeEverywhere(track);
  }
  persistLikedState();
}

function toggleLike() {
  if (!state.currentTrack) return;
  toggleTrackLike(state.currentTrack);
}

function addToHistory(track) {
  state.history = state.history.filter(t => trackKey(t) !== trackKey(track));
  state.history.unshift({ ...track, playedAt: Date.now() });
  if (state.history.length > 200) state.history.length = 200;
  saveJSON('lf_history', state.history);
}

// Views & navigation
function showView(view) {
  state.currentView = view;
  document.body.classList.toggle('wave-view-active', view === 'wave');
  if (dom.searchResults) dom.searchResults.classList.add('hidden');
  if (dom.queueView) dom.queueView.classList.add('hidden');
  if (dom.rescueView) dom.rescueView.classList.add('hidden');
  if (dom.libraryMapView) dom.libraryMapView.classList.add('hidden');
  if (dom.waveView) dom.waveView.classList.add('hidden');
  if (dom.welcomeScreen) dom.welcomeScreen.classList.add('hidden');
  if (dom.collectionHeader) dom.collectionHeader.classList.add('hidden');
  if (dom.loading) dom.loading.classList.add('hidden');

  $$('.nav-button').forEach(el => el.classList.toggle('active', el.dataset.view === view));

  switch (view) {
    case 'search':
      if (state.searchResults.length) {
        dom.searchResults.classList.remove('hidden');
      } else {
        dom.welcomeScreen.classList.remove('hidden');
        updateHomeGreeting();
        renderHomeRecent();
        if (!state.homeRecommendations.length && (state.liked.length || state.history.length || state.currentTrack)) {
          setTimeout(loadHomeRecommendations, 250);
        }
      }
      break;

    case 'queue':
      if (dom.queueView) dom.queueView.classList.remove('hidden');
      if (state.queue.length) {
        if (dom.queueEmpty) dom.queueEmpty.classList.add('hidden');
        renderTrackTable(state.queue, dom.queueList, true);
      } else {
        if (dom.queueList) dom.queueList.innerHTML = '';
        if (dom.queueEmpty) dom.queueEmpty.classList.remove('hidden');
      }
      break;

    case 'rescue':
      if (dom.rescueView) dom.rescueView.classList.remove('hidden');
      break;

    case 'library-map':
      if (dom.libraryMapView) dom.libraryMapView.classList.remove('hidden');
      if (!state.libraryMapData) loadLibraryMap();
      break;

    case 'wave':
      if (dom.waveView) dom.waveView.classList.remove('hidden');
      if (!state.waveData) setWaveStatus('Готов собрать рекомендации', 'idle');
      renderWaveStage();
      break;

    case 'liked': {
      const dur = state.liked.reduce((a, t) => a + (t.duration || 0), 0);
      setupCollectionHeader({
        title: 'Избранное',
        artist: 'Моя личная коллекция',
        type: 'liked',
        source: 'local',
        coverUrl: state.liked[0]?.thumbnail || null,
        coverSvg: HEART_OFFICIAL_SVG,
        tracks: state.liked,
        duration: dur,
      });
      dom.searchResults.classList.remove('hidden');
      state.currentTracksList = state.liked;
      renderTrackTable(state.liked, dom.trackList, false);
      break;
    }

    case 'history': {
      const dur = state.history.reduce((a, t) => a + (t.duration || 0), 0);
      setupCollectionHeader({
        title: 'История',
        artist: 'Недавно прослушанные треки',
        type: 'history',
        source: 'local',
        coverUrl: state.history[0]?.thumbnail || null,
        coverSvg: HISTORY_OFFICIAL_SVG,
        tracks: state.history,
        duration: dur,
      });
      dom.searchResults.classList.remove('hidden');
      state.currentTracksList = state.history;
      renderTrackTable(state.history, dom.trackList, false);
      break;
    }

    case 'ym-library':
      loadLibrary('yandex', 'Яндекс.Музыка', 'Мне нравится');
      break;

    case 'yt-library':
      loadLibrary('youtube', 'YouTube Music', 'Понравившиеся');
      break;
  }
}

const YM_OFFICIAL_SVG = `<svg width="48" height="48" viewBox="0 0 144 144"><rect width="144" height="144" rx="41" fill="#110503"/><path fill="#FFEE00" d="m130.863 57.739-.468-2.327-19.788-3.457 11.498-15.557-1.337-1.462-16.913 8.11 2.139-21.54-1.738-.997-10.295 17.418L82.395 12H80.39l2.74 25.064-29.08-23.269-2.474.732 22.396 28.122-44.323-14.76-2.006 2.261L67.22 52.686l-54.618 4.521-.602 3.39 56.757 6.184-47.33 39.157 2.005 2.726 56.356-30.648-11.164 53.983h3.41l21.592-50.792 13.17 39.756 2.34-1.795-5.415-40.42 20.524 23.268 1.337-2.128-15.711-28.853 21.928 8.111.201-2.46-19.655-14.493 18.518-4.454Z"/></svg>`;
const YT_OFFICIAL_SVG = `<svg width="44" height="44" viewBox="0 0 24 24" fill="#ff0033"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`;
const HEART_OFFICIAL_SVG = `<svg width="40" height="40" viewBox="0 0 24 24" fill="#ef4444"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
const HISTORY_OFFICIAL_SVG = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

function setupCollectionHeader(options) {
  if (typeof options === 'string') {
    const [title, subtitle, tracks, coverSvg] = arguments;
    options = { title, subtitle, tracks, coverSvg };
  }

  const {
    title = 'Плейлист',
    artist = '',
    subtitle = '',
    type = 'playlist',
    source = 'yandex',
    coverUrl = null,
    coverSvg = null,
    tracks = [],
    duration = 0,
    url = null,
  } = options;

  if (dom.collectionHeader) dom.collectionHeader.classList.remove('hidden');
  if (dom.collectionTitle) dom.collectionTitle.textContent = title;

  // Cover & Ambient glow
  if (dom.collectionCover) {
    if (coverUrl) {
      const highRes = upgradeThumb(coverUrl) || coverUrl;
      dom.collectionCover.innerHTML = `<img src="${esc(highRes)}" alt="${esc(title)}" onerror="this.remove()">`;
    } else if (coverSvg) {
      dom.collectionCover.innerHTML = coverSvg;
    } else {
      dom.collectionCover.innerHTML = YM_OFFICIAL_SVG;
    }
  }

  // Source Badge & Type Tag
  if (dom.heroSrcBadge) {
    dom.heroSrcBadge.className = 'hero-src-badge';
    if (source === 'yandex') {
      dom.heroSrcBadge.classList.add('badge-ym');
      dom.heroSrcBadge.textContent = 'Яндекс.Музыка';
    } else if (source === 'youtube') {
      dom.heroSrcBadge.classList.add('badge-yt');
      dom.heroSrcBadge.textContent = 'YouTube Music';
    } else if (type === 'liked') {
      dom.heroSrcBadge.classList.add('badge-liked');
      dom.heroSrcBadge.textContent = 'Избранное';
    } else if (type === 'history') {
      dom.heroSrcBadge.textContent = 'История';
    } else {
      dom.heroSrcBadge.textContent = 'Коллекция';
    }
  }

  if (dom.collectionType) {
    const typeNames = {
      album: 'Альбом',
      playlist: 'Плейлист',
      library: 'Библиотека',
      liked: 'Избранные треки',
      history: 'История прослушиваний',
    };
    dom.collectionType.textContent = typeNames[type] || 'Сборник';
  }

  // Ambient Glow
  if (dom.heroAmbientGlow) {
    if (source === 'yandex') {
      dom.heroAmbientGlow.style.background = 'radial-gradient(circle, rgba(234, 179, 8, 0.22) 0%, transparent 70%)';
    } else if (source === 'youtube') {
      dom.heroAmbientGlow.style.background = 'radial-gradient(circle, rgba(239, 68, 68, 0.22) 0%, transparent 70%)';
    } else if (type === 'liked') {
      dom.heroAmbientGlow.style.background = 'radial-gradient(circle, rgba(244, 63, 94, 0.22) 0%, transparent 70%)';
    } else {
      dom.heroAmbientGlow.style.background = 'radial-gradient(circle, rgba(56, 189, 248, 0.2) 0%, transparent 70%)';
    }
  }

  // Meta strip: Artist / Owner
  if (dom.heroArtistWrap && dom.heroArtistName) {
    if (artist) {
      dom.heroArtistName.textContent = artist;
      dom.heroArtistWrap.classList.remove('hidden');
      if (dom.heroArtistDot) dom.heroArtistDot.classList.remove('hidden');
    } else {
      dom.heroArtistWrap.classList.add('hidden');
      if (dom.heroArtistDot) dom.heroArtistDot.classList.add('hidden');
    }
  }

  // Track count
  if (dom.collectionSubtitle) {
    const count = (tracks || []).length;
    dom.collectionSubtitle.textContent = `${count} ${pluralize(count, 'трек', 'трека', 'треков')}`;
  }

  // Total Duration
  const totalDur = duration || (tracks || []).reduce((acc, t) => acc + (t.duration || 0), 0);
  if (dom.heroDuration && dom.heroDurationVal) {
    if (totalDur > 0) {
      dom.heroDurationVal.textContent = fmtDurationLong(totalDur);
      dom.heroDuration.classList.remove('hidden');
      if (dom.heroDurDot) dom.heroDurDot.classList.remove('hidden');
    } else {
      dom.heroDuration.classList.add('hidden');
      if (dom.heroDurDot) dom.heroDurDot.classList.add('hidden');
    }
  }

  // Play All
  const handlePlayAll = () => {
    if (!tracks || !tracks.length) return;
    state.queue = [...tracks];
    state.currentIndex = 0;
    playTrack(tracks[0]);
  };
  if (dom.heroPlayAllBtn) dom.heroPlayAllBtn.onclick = handlePlayAll;
  if (dom.heroCoverPlayBtn) dom.heroCoverPlayBtn.onclick = handlePlayAll;

  // Shuffle All
  if (dom.heroShuffleBtn) {
    dom.heroShuffleBtn.onclick = () => {
      if (!tracks || !tracks.length) return;
      state.queue = [...tracks].sort(() => Math.random() - 0.5);
      state.currentIndex = 0;
      state.shuffle = true;
      if (dom.shuffleBtn) dom.shuffleBtn.classList.add('active');
      playTrack(state.queue[0]);
    };
  }

  // Queue All
  if (dom.heroQueueAllBtn) {
    dom.heroQueueAllBtn.onclick = () => {
      if (!tracks || !tracks.length) return;
      state.queue.push(...tracks);
      syncQueueUI();
      toast(`Добавлено в очередь (+${tracks.length})`);
    };
  }

  // Open Link in original
  if (dom.heroOpenLinkBtn) {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      dom.heroOpenLinkBtn.href = url;
      dom.heroOpenLinkBtn.classList.remove('hidden');
    } else {
      dom.heroOpenLinkBtn.classList.add('hidden');
    }
  }

  // Quick Filter
  if (dom.heroFilterInput) {
    dom.heroFilterInput.value = '';
    dom.heroFilterInput.oninput = e => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = (tracks || []).filter(t =>
        t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
      );
      renderTrackTable(filtered, dom.trackList, false);
    };
  }
}

async function loadLibrary(source, title, subtitle) {
  dom.searchResults.classList.remove('hidden');
  dom.welcomeScreen.classList.add('hidden');
  renderTableSkeleton(dom.trackList, 10);
  setLoading(true, `Синхронизация ${title}...`);

  try {
    const res = await fetch(`/api/library/${source}`);
    const data = await responseJson(res, `Ошибка синхронизации ${title}`);

    const tracks = data.tracks || [];

    if (data.unauthenticated) {
      dom.trackList.innerHTML = `
        <div class="loader-view" style="padding: 40px 20px; text-align: center; max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 10px;">
          <div style="font-size: 15px; font-weight: 550; color: #fff;">Требуется вход в ${source === 'yandex' ? 'Яндекс Музыку' : 'YouTube Music'}</div>
          <div style="font-size: 12.5px; color: var(--text-muted); line-height: 1.45;">Для просмотра и синхронизации понравившихся треков выполните вход в аккаунт через настройки плеера.</div>
          <button class="sp-action-btn" id="libraryOpenAuthBtn" style="margin-top: 6px; padding: 7px 16px; font-size: 12px; background: rgba(255,255,255,0.08); color: #fff;">Настройки авторизации</button>
        </div>
      `;
      const authBtn = $('#libraryOpenAuthBtn');
      if (authBtn) {
        authBtn.onclick = () => {
          if (dom.settingsBtn) dom.settingsBtn.click();
        };
      }
      return [];
    }

    const username = data.username || '';
    const fullTitle = username ? `${title} (${username})` : title;
    const isYm = source === 'yandex';

    setupCollectionHeader({
      title: fullTitle,
      artist: subtitle,
      type: 'library',
      source,
      coverUrl: tracks[0]?.thumbnail || null,
      coverSvg: isYm ? YM_OFFICIAL_SVG : YT_OFFICIAL_SVG,
      tracks,
      duration: data.duration || tracks.reduce((a, t) => a + (t.duration || 0), 0),
      url: isYm ? 'https://music.yandex.ru' : 'https://music.youtube.com',
    });

    state.currentTracksList = tracks;
    renderTrackTable(tracks, dom.trackList, false);
    return tracks;
  } catch (err) {
    console.error(`Library load error [${source}]:`, err);
    dom.trackList.innerHTML = `
      <div class="loader-view">
        <span>Не удалось загрузить библиотеку: ${esc(err.message)}</span>
      </div>
    `;
  } finally {
    setLoading(false);
  }
  return [];
}

// Playlist rescue
function normalizedConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number <= 1 ? Math.round(number * 100) : Math.round(number);
}

function rescueTrackForItem(item, index) {
  if (!item) return null;
  const canonical = state.rescueData?.tracks?.[index];
  if (canonical) return canonical;
  if (item.match) return item.match;
  if (item.track) return item.track;
  const originalKey = trackIdentity(item.original);
  return state.rescueData?.tracks?.find(track =>
    trackIdentity(track) === originalKey || trackIdentity(track) === String(item.canonicalId || '')
  ) || (item.status === 'matched' ? state.rescueData?.tracks?.[index] : null);
}

function matchedRescueEntries(data = state.rescueData) {
  const items = data?.items || [];
  const tracks = data?.tracks || [];
  return items.map((item, index) => {
    if (item?.status !== 'matched') return null;
    const track = tracks[index] || item.match || item.track || null;
    if (!track || !getTrackVariants(track).some(variant => variant.url && variant.available !== false)) return null;
    return { item, track, index };
  }).filter(Boolean);
}

function renderRescue() {
  if (!state.rescueData) return;
  const { playlist = {}, summary = {}, items = [] } = state.rescueData;
  const matchedEntries = matchedRescueEntries();
  const matchedTracks = matchedEntries.map(entry => entry.track);
  const values = {
    total: summary.total ?? items.length,
    matched: summary.matched ?? items.filter(item => item.status === 'matched').length,
    ambiguous: summary.ambiguous ?? items.filter(item => item.status === 'ambiguous').length,
    missing: summary.missing ?? items.filter(item => item.status === 'missing').length,
  };

  if (dom.rescueSummary) {
    dom.rescueSummary.classList.remove('hidden');
    dom.rescueSummary.innerHTML = `
      <div class="rescue-summary-title" title="${esc(playlist.title || '')}">${esc(playlist.title || 'Результат спасения')}</div>
      <div class="rescue-summary-stats">
        <span><strong>${values.total}</strong>Всего</span>
        <span><strong>${values.matched}</strong>Найдено</span>
        <span><strong>${values.ambiguous}</strong>Проверить</span>
        <span><strong>${values.missing}</strong>Потеряно</span>
      </div>
      <button type="button" class="feature-primary-btn rescue-play-all" data-action="play-rescued" ${matchedTracks.length ? '' : 'disabled'}>▶ Слушать найденное</button>
    `;
    dom.rescueSummary.querySelector('[data-action="play-rescued"]')?.addEventListener('click', playRescuedQueue);
  }

  if (dom.rescueResults) {
    dom.rescueResults.innerHTML = items.length ? items.map((item, index) => {
      const original = item.original || {};
      const playableTrack = item.status === 'matched' ? rescueTrackForItem(item, index) : null;
      const match = item.match || null;
      const confidence = normalizedConfidence(item.confidence);
      const confidenceClass = confidence == null ? 'low' : confidence >= 85 ? 'high' : confidence >= 60 ? 'medium' : 'low';
      const originalTitle = typeof original === 'string' ? original : (original.title || original.name || 'Неизвестный трек');
      const originalArtist = typeof original === 'string' ? '' : (original.artist || original.artists || '');
      const statusText = item.status === 'matched' ? 'Найден' : item.status === 'ambiguous' ? 'Нужно проверить' : 'Не найден';
      const candidates = Array.isArray(item.candidates) ? item.candidates : [];
      const selectedVariantIndex = playableTrack ? getSelectedVariantIndex(playableTrack) : -1;
      const playableVariants = getTrackVariants(playableTrack)
        .map((variant, variantIndex) => ({ variant, variantIndex }))
        .filter(({ variant }) => variant.url && variant.available !== false);
      return `
        <div class="rescue-result-row status-${esc(item.status || 'missing')}" data-rescue-index="${index}">
          <div class="rescue-result-main">
            <div><strong>${esc(originalTitle)}</strong>${originalArtist ? `<span> — ${esc(String(originalArtist))}</span>` : ''}</div>
            ${match ? `<div class="rescue-match">→ ${esc(match.title)} — ${esc(match.artist)}</div>` : ''}
          </div>
          <div class="rescue-result-meta">
            <span class="confidence-chip ${confidenceClass}">${statusText}${confidence == null ? '' : ` · ${confidence}%`}</span>
            ${playableVariants.length ? `<div class="source-stack">${playableVariants.map(({ variant, variantIndex }) => `
              <button type="button" class="source-variant ${sourceClass(variant.source)} ${variantIndex === selectedVariantIndex ? 'active' : ''}" data-rescue-play="${index}" data-rescue-variant="${variantIndex}" aria-pressed="${variantIndex === selectedVariantIndex}">
                ▶ ${esc(sourceName(variant.source))}
              </button>
            `).join('')}</div>` : ''}
          </div>
          ${candidates.length ? `<div class="source-stack rescue-candidates">${candidates.map((candidate, candidateIndex) => `
            <button type="button" class="source-variant ${sourceClass(candidate.source)}" data-rescue-candidate="${index}:${candidateIndex}" aria-pressed="false">
              ${esc(sourceName(candidate.source))}: ${esc(candidate.title || 'вариант')}
            </button>
          `).join('')}</div>` : ''}
        </div>
      `;
    }).join('') : '<div class="loader-view"><span>Результатов нет</span></div>';

    dom.rescueResults.querySelectorAll('[data-rescue-play]').forEach(btn => {
      btn.onclick = () => {
        const index = parseInt(btn.dataset.rescuePlay, 10);
        const variantIndex = parseInt(btn.dataset.rescueVariant, 10);
        const track = rescueTrackForItem(items[index], index);
        if (!track || items[index]?.status !== 'matched') return;
        btn.closest('.source-stack')?.querySelectorAll('.source-variant').forEach(sourceBtn => {
          const active = sourceBtn === btn;
          sourceBtn.classList.toggle('active', active);
          sourceBtn.setAttribute('aria-pressed', String(active));
        });
        playStandaloneFromList(track, matchedTracks, Number.isInteger(variantIndex) ? { variantIndex } : {});
      };
    });
    dom.rescueResults.querySelectorAll('[data-rescue-candidate]').forEach(btn => {
      btn.onclick = () => {
        const [itemIndex, candidateIndex] = btn.dataset.rescueCandidate.split(':').map(Number);
        const candidate = items[itemIndex]?.candidates?.[candidateIndex];
        if (candidate) playStandaloneFromList(candidate, [candidate]);
      };
    });
  }

  if (dom.rescueExportJsonBtn) dom.rescueExportJsonBtn.disabled = false;
  if (dom.rescueExportM3uBtn) dom.rescueExportM3uBtn.disabled = !matchedEntries.length;
}

function playStandaloneFromList(track, list, playbackOptions = {}) {
  const playable = (list || []).filter(item => getTrackVariants(item).some(variant => variant.url));
  const key = trackKey(track);
  let index = playable.findIndex(item => trackKey(item) === key);
  if (index < 0) {
    playable.unshift(track);
    index = 0;
  }
  state.currentTracksList = playable;
  state.queue = playable;
  state.currentIndex = index;
  playTrack(playable[index], playbackOptions);
}

function playRescuedQueue() {
  const tracks = matchedRescueEntries().map(entry => entry.track);
  if (!tracks.length) return toast('В спасённом плейлисте нет доступных треков');
  state.queue = tracks;
  state.currentIndex = 0;
  playTrack(tracks[0]);
}

async function runRescue() {
  const url = dom.rescueUrlInput?.value.trim();
  if (!url) return toast('Вставьте ссылку на плейлист');
  if (state.rescueLoading) return;
  state.rescueLoading = true;
  state.rescueData = null;
  if (dom.rescueView) dom.rescueView.setAttribute('aria-busy', 'true');
  if (dom.rescueSummary) {
    dom.rescueSummary.classList.add('hidden');
    dom.rescueSummary.innerHTML = '';
  }
  [dom.rescueExportJsonBtn, dom.rescueExportM3uBtn].forEach(btn => {
    if (btn) btn.disabled = true;
  });
  if (dom.rescueRunBtn) {
    dom.rescueRunBtn.disabled = true;
    dom.rescueRunBtn.classList.add('is-loading');
    const label = dom.rescueRunBtn.querySelector('span');
    if (label) label.textContent = 'Проверяю...';
  }
  if (dom.rescueResults) dom.rescueResults.innerHTML = '<div class="loader-view"><span>Ищу замены в обоих источниках...</span></div>';

  try {
    const res = await fetch('/api/rescue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, limit: 40 }),
    });
    state.rescueData = await responseJson(res, 'Не удалось спасти плейлист');
    renderRescue();
    toast(`Спасение завершено: ${state.rescueData.summary?.matched || 0} найдено`);
  } catch (err) {
    state.rescueData = null;
    if (dom.rescueSummary) {
      dom.rescueSummary.classList.add('hidden');
      dom.rescueSummary.innerHTML = '';
    }
    if (dom.rescueResults) dom.rescueResults.innerHTML = `<div class="loader-view"><span>${esc(err.message)}</span></div>`;
    toast(err.message);
  } finally {
    state.rescueLoading = false;
    if (dom.rescueView) dom.rescueView.setAttribute('aria-busy', 'false');
    if (dom.rescueRunBtn) {
      dom.rescueRunBtn.disabled = false;
      dom.rescueRunBtn.classList.remove('is-loading');
      const label = dom.rescueRunBtn.querySelector('span');
      if (label) label.textContent = 'Проверить';
    }
  }
}

function exportRescueJson() {
  if (!state.rescueData) return toast('Сначала проверьте плейлист');
  const name = String(state.rescueData.playlist?.title || 'playlist-rescue').replace(/[\\/:*?"<>|]/g, '_');
  downloadBlob(JSON.stringify(state.rescueData, null, 2), `${name}.rescue.json`, 'application/json;charset=utf-8');
}

function exportRescueM3u() {
  const tracks = matchedRescueEntries().map(entry => entry.track);
  if (!tracks.length) return toast('Нет найденных треков для экспорта');
  const lines = ['#EXTM3U'];
  tracks.forEach(track => {
    const variants = getTrackVariants(track);
    const variant = variants[getSelectedVariantIndex(track, variants)] || variants.find(item => item.url);
    if (!variant?.url) return;
    lines.push(`#EXTINF:${Math.round(track.duration || variant.duration || -1)},${track.artist || variant.artist || ''} - ${track.title || variant.title || ''}`);
    lines.push(variant.url);
  });
  const name = String(state.rescueData.playlist?.title || 'playlist-rescue').replace(/[\\/:*?"<>|]/g, '_');
  downloadBlob(lines.join('\n'), `${name}.m3u8`, 'audio/x-mpegurl;charset=utf-8');
}

function initRescue() {
  if (dom.rescueRunBtn) dom.rescueRunBtn.onclick = runRescue;
  if (dom.rescueUrlInput) {
    dom.rescueUrlInput.onkeydown = event => {
      if (event.key === 'Enter') runRescue();
    };
  }
  if (dom.rescueExportJsonBtn) dom.rescueExportJsonBtn.onclick = exportRescueJson;
  if (dom.rescueExportM3uBtn) dom.rescueExportM3uBtn.onclick = exportRescueM3u;
}

// Library map
function coerceMapTrack(entry, index) {
  if (!entry) return null;
  if (entry.track) return entry.track;
  if (entry.variants || entry.url || entry.canonicalId) return entry;
  const providerTracks = [entry.yandex, entry.youtube].filter(Boolean);
  if (!providerTracks.length) return null;
  const first = providerTracks[0];
  return {
    ...first,
    canonicalId: entry.canonicalId || `map-${index}-${first.id || first.url || first.title}`,
    variants: providerTracks,
    sources: providerTracks.map(track => track.source),
  };
}

function mapTracksForTab(tab = state.libraryMapTab) {
  const raw = state.libraryMapData?.[tab] || [];
  return raw.map(coerceMapTrack).filter(Boolean);
}

function renderLibraryMap() {
  const data = state.libraryMapData;
  if (!data) return;
  const summary = data.summary || {};
  const availability = data.availability || {};
  const yandexAvailable = availability.yandex !== false;
  const youtubeAvailable = availability.youtube !== false;
  const mapComplete = yandexAvailable && youtubeAvailable;
  const availableTab = yandexAvailable ? 'yandexOnly' : 'youtubeOnly';
  if (!mapComplete && (state.libraryMapTab === 'overlap'
    || (state.libraryMapTab === 'yandexOnly' && !yandexAvailable)
    || (state.libraryMapTab === 'youtubeOnly' && !youtubeAvailable))) {
    state.libraryMapTab = availableTab;
  }

  if (dom.libraryMapView) dom.libraryMapView.dataset.availability = mapComplete ? 'complete' : 'partial';

  if (dom.libraryMapSummary) {
    const unavailableNames = [
      !yandexAvailable ? 'Яндекс.Музыка' : '',
      !youtubeAvailable ? 'YouTube Music' : '',
    ].filter(Boolean).join(' и ');
    dom.libraryMapSummary.classList.remove('hidden');
    dom.libraryMapSummary.innerHTML = `
      <span>Загружено <strong>${summary.total || 0}</strong></span>
      <span>В обоих <strong>${mapComplete ? (summary.overlap || 0) : '—'}</strong></span>
      <span>Яндекс <strong>${yandexAvailable ? (summary.yandexTotal ?? summary.yandexOnly ?? 0) : '—'}</strong></span>
      <span>YouTube <strong>${youtubeAvailable ? (summary.youtubeTotal ?? summary.youtubeOnly ?? 0) : '—'}</strong></span>
      ${mapComplete ? '' : `<span class="map-availability-warning" role="status">Карта частичная: ${esc(unavailableNames)} недоступна. Совпадения и уникальность не проверены.</span>`}
    `;
  }

  if (dom.libraryMapTabs) {
    if (!dom.libraryMapTabs.querySelector('[data-map-tab]')) {
      dom.libraryMapTabs.innerHTML = `
        <button type="button" data-map-tab="overlap">В обоих</button>
        <button type="button" data-map-tab="yandexOnly">Только Яндекс</button>
        <button type="button" data-map-tab="youtubeOnly">Только YouTube</button>
      `;
    }
    dom.libraryMapTabs.querySelectorAll('[data-map-tab]').forEach(btn => {
      const tab = btn.dataset.mapTab;
      const disabled = !mapComplete && (tab === 'overlap'
        || (tab === 'yandexOnly' && !yandexAvailable)
        || (tab === 'youtubeOnly' && !youtubeAvailable));
      if (tab === 'overlap') btn.textContent = 'В обоих';
      if (tab === 'yandexOnly') btn.textContent = mapComplete ? 'Только Яндекс' : (yandexAvailable ? 'Яндекс (без сверки)' : 'Яндекс недоступен');
      if (tab === 'youtubeOnly') btn.textContent = mapComplete ? 'Только YouTube' : (youtubeAvailable ? 'YouTube (без сверки)' : 'YouTube недоступен');
      btn.disabled = disabled;
      const active = btn.dataset.mapTab === state.libraryMapTab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.onclick = () => {
        if (btn.disabled) return;
        state.libraryMapTab = btn.dataset.mapTab;
        renderLibraryMap();
      };
    });
  }

  const tracks = mapTracksForTab();
  if (!dom.libraryMapList) return;
  if (!tracks.length) {
    dom.libraryMapList.innerHTML = '<div class="loader-view"><span>Здесь пока пусто</span></div>';
    return;
  }

  dom.libraryMapList.innerHTML = tracks.map((track, index) => {
    const variants = getTrackVariants(track);
    const selectedVariantIndex = getSelectedVariantIndex(track, variants);
    const present = new Set(variants.filter(variant => variant.url).map(variant => variant.source));
    const chips = ['yandex', 'youtube'].map(provider => {
      const variantIndex = variants.findIndex(variant => variant.source === provider && variant.url);
      if (variantIndex < 0) return `<button type="button" class="map-source-chip missing" disabled>${esc(sourceName(provider))} — нет</button>`;
      const active = variantIndex === selectedVariantIndex;
      return `<button type="button" class="map-source-chip ${sourceClass(provider)} ${active ? 'active' : ''}" data-map-index="${index}" data-map-variant="${variantIndex}" aria-pressed="${active}">▶ ${esc(sourceName(provider))}</button>`;
    }).join('');
    return `
      <div class="map-track-row" data-map-row="${index}">
        <img src="${track.thumbnail || PLACEHOLDER_IMG}" alt="" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'">
        <div class="map-track-main">
          <strong>${esc(track.title)}</strong>
          <span>${esc(track.artist)}</span>
        </div>
        <div class="map-track-sources" data-present="${[...present].join(',')}">${chips}</div>
      </div>
    `;
  }).join('');

  dom.libraryMapList.querySelectorAll('[data-map-row]').forEach(row => {
    row.onclick = event => {
      if (event.target.closest('[data-map-variant]')) return;
      const index = parseInt(row.dataset.mapRow, 10);
      const track = tracks[index];
      if (track) playStandaloneFromList(track, tracks);
    };
  });
  dom.libraryMapList.querySelectorAll('[data-map-variant]').forEach(btn => {
    btn.onclick = event => {
      event.stopPropagation();
      const index = parseInt(btn.dataset.mapIndex, 10);
      const variantIndex = parseInt(btn.dataset.mapVariant, 10);
      const track = tracks[index];
      if (!track) return;
      state.queue = tracks;
      state.currentIndex = index;
      const variant = getTrackVariants(track)[variantIndex];
      if (variant?.url) state.variantSelections[trackKey(track)] = variant.url;
      btn.closest('.map-track-sources')?.querySelectorAll('[data-map-variant]').forEach(sourceBtn => {
        const active = sourceBtn === btn;
        sourceBtn.classList.toggle('active', active);
        sourceBtn.setAttribute('aria-pressed', String(active));
      });
      playTrack(track, { variantIndex });
    };
  });
}

async function loadLibraryMap() {
  if (!dom.libraryMapList && !dom.libraryMapView) return;
  if (dom.libraryMapView) dom.libraryMapView.setAttribute('aria-busy', 'true');
  if (dom.libraryMapLoadBtn) {
    dom.libraryMapLoadBtn.disabled = true;
    dom.libraryMapLoadBtn.classList.add('is-loading');
    const label = dom.libraryMapLoadBtn.querySelector('span');
    if (label) label.textContent = 'Сверяю...';
  }
  if (dom.libraryMapList) dom.libraryMapList.innerHTML = '<div class="loader-view"><span>Сверяю библиотеки...</span></div>';
  try {
    const res = await fetch('/api/library/map');
    state.libraryMapData = await responseJson(res, 'Не удалось построить карту библиотек');
    renderLibraryMap();
  } catch (err) {
    state.libraryMapData = null;
    if (dom.libraryMapView) delete dom.libraryMapView.dataset.availability;
    if (dom.libraryMapSummary) {
      dom.libraryMapSummary.classList.add('hidden');
      dom.libraryMapSummary.innerHTML = '';
    }
    if (dom.libraryMapList) dom.libraryMapList.innerHTML = `<div class="loader-view"><span>${esc(err.message)}</span></div>`;
    toast(err.message);
  } finally {
    if (dom.libraryMapView) dom.libraryMapView.setAttribute('aria-busy', 'false');
    if (dom.libraryMapLoadBtn) {
      dom.libraryMapLoadBtn.disabled = false;
      dom.libraryMapLoadBtn.classList.remove('is-loading');
      const label = dom.libraryMapLoadBtn.querySelector('span');
      if (label) label.textContent = 'Обновить карту';
    }
  }
}

function initLibraryMap() {
  if (dom.libraryMapLoadBtn) dom.libraryMapLoadBtn.onclick = loadLibraryMap;
}

// Visualizer
function startVisualizer() {
  if (animFrame) cancelAnimationFrame(animFrame);
  drawVisualizer();
}

function drawVisualizer() {
  animFrame = requestAnimationFrame(drawVisualizer);

  const canvas = dom.visualizer;
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!analyser || !state.isPlaying) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      for (let i = 0; i < 12; i++) ctx.fillRect(i * 7, H - 3, 3, 3);
    } else {
      analyser.getByteFrequencyData(dataArray);
      const bars = 12;
      const barW = 3;
      const gap = (W - bars * barW) / (bars - 1);
      const step = Math.max(1, Math.floor(dataArray.length / bars));

      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < bars; i++) {
        const val = dataArray[i * step] || 0;
        const barH = Math.max(2, (val / 255) * H);
        const x = i * (barW + gap);
        const y = H - barH;
        ctx.fillRect(x, y, barW, barH);
      }
    }
  }

  const eqScrim = $('#eqModalScrim');
  if (eqScrim && !eqScrim.classList.contains('hidden') && typeof drawEqCanvas === 'function') {
    drawEqCanvas();
  }
}

// Media Session
function updateMediaSession() {
  const desktop = window.desktop || window.listenfoldDesktop;
  if (state.currentTrack && desktop?.setPlaybackState) {
    desktop.setPlaybackState({
      playing: !audio.paused,
      title: state.currentTrack.title,
      artist: state.currentTrack.artist,
    }).catch(() => {});
  }

  if (!('mediaSession' in navigator) || !state.currentTrack) return;
  const t = state.currentTrack;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    artwork: t.thumbnail ? [{ src: t.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : [],
  });

  try {
    navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  } catch {}

  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('nexttrack', playNext);
  navigator.mediaSession.setActionHandler('previoustrack', playPrev);
  navigator.mediaSession.setActionHandler('seekto', d => {
    if (d.seekTime != null) audio.currentTime = d.seekTime;
  });
}

// Utilities
function fmtTime(s) {
  if (!s || isNaN(s) || !isFinite(s)) return '0:00';
  s = Math.round(s);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function fmtDurationLong(sec) {
  if (!sec || isNaN(sec)) return '0 мин';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h} ч ${m} мин`;
  }
  return `${m} мин ${s} сек`;
}

function pluralize(n, one, two, five) {
  let num = Math.abs(n) % 100;
  if (num >= 5 && num <= 20) return five;
  num = num % 10;
  if (num === 1) return one;
  if (num >= 2 && num <= 4) return two;
  return five;
}

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getStorageItem(key, fallback = null) {
  try {
    const val = localStorage.getItem(key);
    if (val !== null) return val;
    if (typeof key === 'string' && key.startsWith('lf_')) {
      const legacyKey = 'sf_' + key.slice(3);
      const legacyVal = localStorage.getItem(legacyKey);
      if (legacyVal !== null) {
        localStorage.setItem(key, legacyVal);
        return legacyVal;
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function loadJSON(key, fallback) {
  try {
    let raw = localStorage.getItem(key);
    if (raw == null && typeof key === 'string' && key.startsWith('lf_')) {
      const legacyKey = 'sf_' + key.slice(3);
      raw = localStorage.getItem(legacyKey);
      if (raw != null) {
        localStorage.setItem(key, raw);
      }
    }
    return raw ? (JSON.parse(raw) || fallback) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function toast(msg) {
  if (!dom.toastContainer) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  dom.toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function applyStatusChip(element, status, fallbackLabel) {
  if (!element) return;
  const label = typeof status === 'string' ? status : (status?.label || fallbackLabel);
  const ok = typeof status === 'object' ? status?.ok : null;
  element.classList.remove('success', 'warning', 'danger', 'loading');
  element.classList.add(ok === true ? 'success' : ok === false ? 'danger' : 'warning');
  element.textContent = label || fallbackLabel;
}

async function loadRuntimeStatus() {
  [dom.statusYandex, dom.statusYoutube, dom.statusEngine].forEach(element => {
    if (!element) return;
    element.classList.remove('success', 'warning', 'danger');
    element.classList.add('loading');
  });
  try {
    const res = await fetch('/api/status');
    const data = await responseJson(res, 'Статус сервисов недоступен');
    const yandexStatus = data.yandex && typeof data.yandex === 'object'
      ? { ...data.yandex, label: data.yandex.label || (data.yandex.ok ? 'Готов' : 'Нет сессии') }
      : data.yandex;
    const youtubeStatus = data.youtube && typeof data.youtube === 'object'
      ? { ...data.youtube, label: data.youtube.label || (data.youtube.ok ? 'Готов' : 'Недоступен') }
      : data.youtube;
    const rawEngine = data.engine || data.ytdlp;
    const engineStatus = rawEngine && typeof rawEngine === 'object'
      ? {
          ...rawEngine,
          ok: rawEngine.ok == null ? true : rawEngine.ok,
          label: rawEngine.label || [rawEngine.engine, rawEngine.version].filter(Boolean).join(' ') || 'Аудиодвижок',
        }
      : rawEngine;
    applyStatusChip(dom.statusYandex, yandexStatus, 'Яндекс');
    applyStatusChip(dom.statusYoutube, youtubeStatus, 'YouTube');
    applyStatusChip(dom.statusEngine, engineStatus, 'Аудиодвижок');
    if (dom.refreshCookiesBtn && data.cookies) {
      dom.refreshCookiesBtn.title = data.cookies.ok === false
        ? 'Cookies требуют обновления'
        : (data.cookies.label || 'Обновить авторизацию');
    }
  } catch (err) {
    applyStatusChip(dom.statusYandex, { ok: false, label: 'Яндекс недоступен' });
    applyStatusChip(dom.statusYoutube, { ok: false, label: 'YouTube недоступен' });
    applyStatusChip(dom.statusEngine, { ok: false, label: 'Статус недоступен' });
  }
}

async function refreshAuthCookies() {
  const res = await fetch('/api/refresh-cookies', { method: 'POST' });
  const data = await responseJson(res, 'Не удалось обновить авторизацию');
  if (data.ok === false) throw new Error(data.error || 'Не удалось обновить авторизацию');
  loadRuntimeStatus();
  return data;
}

// Event listeners

// Search input
dom.searchInput.addEventListener('input', e => debouncedSearch(e.target.value));
dom.searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimer);
    search(e.target.value);
  }
});

// Source Switcher
$$('.source-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    setSearchSource(btn.dataset.source, { search: true });
  });
});
setSearchSource(state.searchSource);

// Navigation
$$('.nav-button').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.view));
});

// Clear Queue
if (dom.clearQueueBtn) {
  dom.clearQueueBtn.addEventListener('click', () => {
    state.queue = state.currentCanonicalTrack || state.currentTrack ? [state.currentCanonicalTrack || state.currentTrack] : [];
    state.currentIndex = state.currentTrack ? 0 : -1;
    syncQueueUI();
    toast('Очередь очищена');
  });
}

// Fullscreen Openers & Closers
if (dom.expandPlayerBtn) dom.expandPlayerBtn.onclick = toggleFullscreen;
if (dom.artworkWrap) dom.artworkWrap.onclick = openFullscreen;
if (dom.playerInfoWrap) dom.playerInfoWrap.onclick = openFullscreen;
if (dom.fsCloseBtn) dom.fsCloseBtn.onclick = closeFullscreen;

// Fullscreen Cinema Mode Tabs
if (dom.fsTabStage) dom.fsTabStage.onclick = () => setFsTab('stage');
if (dom.fsTabLyrics) dom.fsTabLyrics.onclick = () => setFsTab('lyrics');
if (dom.fsTabQueue) dom.fsTabQueue.onclick = () => setFsTab('queue');

// Lyrics Drawer (Desktop View)
if (dom.lyricsBtn) dom.lyricsBtn.onclick = toggleLyricsDrawer;
if (dom.closeLyricsDrawerBtn) dom.closeLyricsDrawerBtn.onclick = toggleLyricsDrawer;

// Player Controls (Dock + Cinema)
dom.playBtn.addEventListener('click', togglePlay);
if (dom.fsPlayBtn) dom.fsPlayBtn.addEventListener('click', togglePlay);

dom.nextBtn.addEventListener('click', playNext);
if (dom.fsNextBtn) dom.fsNextBtn.addEventListener('click', playNext);

dom.prevBtn.addEventListener('click', playPrev);
if (dom.fsPrevBtn) dom.fsPrevBtn.addEventListener('click', playPrev);

dom.likeBtn.addEventListener('click', toggleLike);
if (dom.fsLikeBtn) dom.fsLikeBtn.addEventListener('click', toggleLike);

dom.shuffleBtn.addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  dom.shuffleBtn.classList.toggle('active', state.shuffle);
  if (dom.fsShuffleBtn) dom.fsShuffleBtn.classList.toggle('active', state.shuffle);
  persistSession();
});

if (dom.fsShuffleBtn) {
  dom.fsShuffleBtn.addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    dom.shuffleBtn.classList.toggle('active', state.shuffle);
    dom.fsShuffleBtn.classList.toggle('active', state.shuffle);
    persistSession();
  });
}

function updateRepeatUI(options = {}) {
  const modes = {
    none: { label: 'Повтор выключен', badge: '', message: 'Повтор выключен' },
    all: { label: 'Повтор всей очереди', badge: 'ALL', message: 'Повтор всей очереди включён' },
    one: { label: 'Повтор одного трека', badge: '1', message: 'Повтор одного трека включён' },
  };
  const mode = modes[state.repeat] || modes.none;
  for (const btn of [dom.repeatBtn, dom.fsRepeatBtn]) {
    if (!btn) continue;
    btn.dataset.repeatMode = state.repeat;
    btn.classList.toggle('active', state.repeat !== 'none');
    btn.title = `${mode.label} (R)`;
    btn.setAttribute('aria-label', mode.label);
    btn.setAttribute('aria-pressed', String(state.repeat !== 'none'));
    const badge = btn.querySelector('.repeat-mode-badge');
    if (badge) badge.textContent = mode.badge;
  }
  if (options.notify) toast(mode.message);
}

function cycleRepeatMode() {
  const modes = ['none', 'all', 'one'];
  state.repeat = modes[(modes.indexOf(state.repeat) + 1) % 3];
  updateRepeatUI({ notify: true });
  persistSession();
}

dom.repeatBtn.addEventListener('click', cycleRepeatMode);

if (dom.fsRepeatBtn) {
  dom.fsRepeatBtn.addEventListener('click', cycleRepeatMode);
}

updateRepeatUI();

// Scrubber
let isSeeking = false;

function handleSeekInput(val) {
  if (audio.duration && isFinite(audio.duration)) {
    const pct = val / 1000;
    dom.progressFill.style.width = `${pct * 100}%`;
    if (dom.fsProgressFill) dom.fsProgressFill.style.width = `${pct * 100}%`;
    if (dom.fsProgressDot) dom.fsProgressDot.style.left = `${pct * 100}%`;
    dom.currentTime.textContent = fmtTime(pct * audio.duration);
    if (dom.fsCurrentTime) dom.fsCurrentTime.textContent = fmtTime(pct * audio.duration);
    if (dom.waveProgressBar) dom.waveProgressBar.value = val;
    if (dom.waveCurrentTime) dom.waveCurrentTime.textContent = fmtTime(pct * audio.duration);
  }
}

function handleSeekChange(val) {
  if (audio.duration && isFinite(audio.duration)) {
    audio.currentTime = (val / 1000) * audio.duration;
    if (playbackSession) playbackSession.resumeTime = audio.currentTime;
    state.restoredTime = audio.currentTime;
    persistSession(true);
  }
  isSeeking = false;
}

dom.progressBar.addEventListener('mousedown', () => (isSeeking = true));
dom.progressBar.addEventListener('input', () => handleSeekInput(dom.progressBar.value));
dom.progressBar.addEventListener('change', () => handleSeekChange(dom.progressBar.value));

if (dom.fsProgressBar) {
  dom.fsProgressBar.addEventListener('mousedown', () => (isSeeking = true));
  dom.fsProgressBar.addEventListener('input', () => handleSeekInput(dom.fsProgressBar.value));
  dom.fsProgressBar.addEventListener('change', () => handleSeekChange(dom.fsProgressBar.value));
}

if (dom.waveProgressBar) {
  dom.waveProgressBar.addEventListener('pointerdown', () => (isSeeking = true));
  dom.waveProgressBar.addEventListener('input', () => handleSeekInput(dom.waveProgressBar.value));
  dom.waveProgressBar.addEventListener('change', () => handleSeekChange(dom.waveProgressBar.value));
}

dom.progressWrapper.addEventListener('mousemove', e => {
  if (!audio.duration || !isFinite(audio.duration)) return;
  const rect = dom.progressWrapper.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  dom.scrubTooltip.textContent = fmtTime(ratio * audio.duration);
  dom.scrubTooltip.style.left = `${ratio * 100}%`;
});

// Volume (Dock + Cinema)
dom.volumeBar.value = state.volume * 100;
updateVolumeUI();

dom.volumeBar.addEventListener('input', () => {
  state.volume = dom.volumeBar.value / 100;
  audio.volume = state.volume;
  persistVolume();
  updateVolumeUI();
});

if (dom.fsVolInput) {
  dom.fsVolInput.addEventListener('input', () => {
    state.volume = dom.fsVolInput.value / 100;
    audio.volume = state.volume;
    persistVolume();
    updateVolumeUI();
  });
}

dom.volumeBtn.addEventListener('click', () => {
  if (audio.volume > 0) {
    state._prevVol = audio.volume;
    audio.volume = 0;
  } else {
    audio.volume = state._prevVol || 0.8;
  }
  state.volume = audio.volume;
  dom.volumeBar.value = audio.volume * 100;
  persistVolume();
  updateVolumeUI();
});

// Smart Background Prefetch Engine (Queue + SoundCloud-style hover)
const prefetchedUrls = new Set();
let hoverPrefetchTimer = null;

function prefetchNextTrack() {
  if (state.currentIndex >= 0 && state.currentIndex + 1 < state.queue.length) {
    const next = state.queue[state.currentIndex + 1];
    const url = next?.url || next?.uri;
    if (url && !prefetchedUrls.has(url)) {
      prefetchedUrls.add(url);
      fetch(`/api/audio/prefetch?url=${encodeURIComponent(url)}`).catch(() => {});
    }
  }
}

document.addEventListener('mouseover', (e) => {
  const target = e.target.closest('[data-track-url]');
  if (!target) {
    if (hoverPrefetchTimer) { clearTimeout(hoverPrefetchTimer); hoverPrefetchTimer = null; }
    return;
  }
  const url = target.dataset?.trackUrl;
  if (!url || prefetchedUrls.has(url)) return;

  if (hoverPrefetchTimer) clearTimeout(hoverPrefetchTimer);
  hoverPrefetchTimer = setTimeout(() => {
    prefetchedUrls.add(url);
    fetch(`/api/audio/prefetch?url=${encodeURIComponent(url)}`).catch(() => {});
  }, 200);
}, { passive: true });

// Audio Events
audio.addEventListener('timeupdate', () => {
  if (playbackSession && Number.isFinite(audio.currentTime)) playbackSession.resumeTime = audio.currentTime;
  state.restoredTime = Number.isFinite(audio.currentTime) ? audio.currentTime : state.restoredTime;
  if (Date.now() - lastTimedSessionSave >= 5000) {
    lastTimedSessionSave = Date.now();
    persistSession(true);
  }
  if (enforceKaraokeLoop(audio.currentTime)) return;
  if (!audio.duration || !isFinite(audio.duration) || isSeeking) return;

  // Auto-prefetch next track when 25s remain
  if (audio.currentTime > 0 && (audio.duration - audio.currentTime <= 25) && !state.nextTrackPrefetched) {
    state.nextTrackPrefetched = true;
    prefetchNextTrack();
  }
  const pct = audio.currentTime / audio.duration;
  const val = pct * 1000;

  dom.progressBar.value = val;
  dom.progressFill.style.width = `${pct * 100}%`;

  if (dom.fsProgressBar) dom.fsProgressBar.value = val;
  if (dom.fsProgressFill) dom.fsProgressFill.style.width = `${pct * 100}%`;
  if (dom.fsProgressDot) dom.fsProgressDot.style.left = `${pct * 100}%`;
  if (dom.waveProgressBar) dom.waveProgressBar.value = val;

  dom.currentTime.textContent = fmtTime(audio.currentTime);

  if (state.showRemainingTime) {
    const rem = Math.max(0, audio.duration - audio.currentTime);
    dom.totalTime.textContent = `-${fmtTime(rem)}`;
  } else {
    dom.totalTime.textContent = fmtTime(audio.duration);
  }

  if (dom.fsCurrentTime) dom.fsCurrentTime.textContent = fmtTime(audio.currentTime);
  if (dom.fsTotalTime) dom.fsTotalTime.textContent = fmtTime(audio.duration);
  if (dom.waveCurrentTime) dom.waveCurrentTime.textContent = fmtTime(audio.currentTime);
  if (dom.waveTotalTime) dom.waveTotalTime.textContent = fmtTime(audio.duration);

  updateLyricsHighlight(audio.currentTime);
});

audio.addEventListener('progress', () => {
  if (!audio.duration || !audio.buffered.length) return;
  const end = audio.buffered.end(audio.buffered.length - 1);
  const bufferedPct = (end / audio.duration) * 100;
  dom.progressBuffered.style.width = `${bufferedPct}%`;
  if (dom.fsProgressBuffered) dom.fsProgressBuffered.style.width = `${bufferedPct}%`;
});

audio.addEventListener('ended', () => {
  if (state.karaokeLoop && state.karaokeLoopIndex >= 0) {
    const line = state.lyrics?.parsedLrc?.[state.karaokeLoopIndex];
    if (line) {
      audio.currentTime = correctedLyricTime(line);
      audio.play().catch(() => {});
      return;
    }
  }
  playNext();
});

audio.addEventListener('play', () => {
  consecutivePlaybackFailures = 0;
  state.isPlaying = true;
  updatePlayBtn();
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  startVisualizer();
  updateMediaSession();
});

audio.addEventListener('pause', () => {
  state.isPlaying = false;
  updatePlayBtn();
  persistSession(true);
  updateMediaSession();
});

// Shortcuts modal
if (dom.shortcutsBtn) dom.shortcutsBtn.onclick = () => dom.shortcutsModal.classList.remove('hidden');
if (dom.closeShortcutsBtn) dom.closeShortcutsBtn.onclick = () => dom.shortcutsModal.classList.add('hidden');
dom.shortcutsModal.onclick = e => {
  if (e.target === dom.shortcutsModal) dom.shortcutsModal.classList.add('hidden');
};

// Refresh cookies
if (dom.refreshCookiesBtn) {
  dom.refreshCookiesBtn.onclick = async () => {
    toast('Обновление авторизации из Chrome...');
    try {
      await refreshAuthCookies();
      toast('Авторизация успешно обновлена');
    } catch (err) {
      toast(err.message || 'Не удалось обновить авторизацию');
    }
  };
}

// Global Key Shortcuts
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      togglePlay();
      break;
    case 'KeyF':
      e.preventDefault();
      toggleFullscreen();
      break;
    case 'KeyT':
      e.preventDefault();
      if (state.isFullscreen) {
        setFsTab(state.fsActiveTab === 'lyrics' ? 'stage' : 'lyrics');
      } else {
        toggleLyricsDrawer();
      }
      break;
    case 'KeyQ':
      e.preventDefault();
      if (state.isFullscreen) {
        setFsTab(state.fsActiveTab === 'queue' ? 'stage' : 'queue');
      }
      break;
    case 'Escape':
      if (state.isFullscreen) closeFullscreen();
      if (state.drawerLyricsOpen) toggleLyricsDrawer();
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (e.shiftKey) playNext();
      else if (audio.duration) audio.currentTime = Math.min(audio.currentTime + 5, audio.duration);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (e.shiftKey) playPrev();
      else audio.currentTime = Math.max(audio.currentTime - 5, 0);
      break;
    case 'ArrowUp':
      e.preventDefault();
      state.volume = Math.min(1, state.volume + 0.05);
      audio.volume = state.volume;
      dom.volumeBar.value = state.volume * 100;
      persistVolume();
      updateVolumeUI();
      break;
    case 'ArrowDown':
      e.preventDefault();
      state.volume = Math.max(0, state.volume - 0.05);
      audio.volume = state.volume;
      dom.volumeBar.value = state.volume * 100;
      persistVolume();
      updateVolumeUI();
      break;
    case 'KeyM':
      dom.volumeBtn.click();
      break;
    case 'KeyL':
      toggleLike();
      break;
    case 'KeyS':
      dom.shuffleBtn.click();
      break;
    case 'KeyR':
      dom.repeatBtn.click();
      break;
    case 'Slash':
      e.preventDefault();
      dom.searchInput.focus();
      dom.searchInput.select();
      break;
  }
});

// Home hub
function updateHomeGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  if (dom.hubGreeting) dom.hubGreeting.textContent = greeting;
}

function renderHomeRecent() {
  if (!dom.hubRecentSection || !dom.hubRecentGrid) return;
  const recent = state.history.slice(0, 8);
  if (!recent.length) {
    dom.hubRecentSection.classList.add('hidden');
    return;
  }
  dom.hubRecentSection.classList.remove('hidden');
  dom.hubRecentGrid.innerHTML = recent.map((t, i) => `
    <div class="hub-track-card" data-idx="${i}" data-track-url="${esc(t.url || '')}">
      <div class="hub-track-art-wrap">
        <img class="hub-track-art" src="${t.thumbnail || PLACEHOLDER_IMG}" alt="" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'">
        <button class="hub-track-play" title="Слушать">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
        </button>
      </div>
      <div class="hub-track-title">${esc(t.title)}</div>
      <div class="hub-track-artist">${esc(t.artist)}</div>
    </div>
  `).join('');

  dom.hubRecentGrid.querySelectorAll('.hub-track-card').forEach((card, i) => {
    card.addEventListener('click', () => {
      state.queue = [...recent];
      state.currentIndex = i;
      playTrack(recent[i]);
    });
  });
}

function initHomeHub() {
  updateHomeGreeting();
  renderHomeRecent();
  bindRecommendationPills();

  if (dom.hubLaunchWave) {
    dom.hubLaunchWave.onclick = () => showView('wave');
  }
  if (dom.hubWavePlayBtn) {
    dom.hubWavePlayBtn.onclick = event => {
      event.stopPropagation();
      loadWave({ source: preferredSourceForWave(), play: true });
    };
  }
  if (dom.hubRefreshRecs) dom.hubRefreshRecs.onclick = loadHomeRecommendations;

  // Yandex Launchers
  if (dom.hubLaunchYm) {
    dom.hubLaunchYm.onclick = () => {
      loadLibrary('yandex', 'Яндекс.Музыка', 'Мне нравится');
    };
  }
  if (dom.hubYmPlayBtn) {
    dom.hubYmPlayBtn.onclick = async event => {
      event.stopPropagation();
      const tracks = await loadLibrary('yandex', 'Яндекс.Музыка', 'Мне нравится');
      if (!tracks.length) return;
      state.queue = tracks;
      state.currentIndex = 0;
      playTrack(tracks[0]);
    };
  }

  // YouTube Launchers
  if (dom.hubLaunchYt) {
    dom.hubLaunchYt.onclick = () => {
      loadLibrary('youtube', 'YouTube Music', 'Liked Music');
    };
  }
  if (dom.hubYtPlayBtn) {
    dom.hubYtPlayBtn.onclick = async event => {
      event.stopPropagation();
      const tracks = await loadLibrary('youtube', 'YouTube Music', 'Liked Music');
      if (!tracks.length) return;
      state.queue = tracks;
      state.currentIndex = 0;
      playTrack(tracks[0]);
    };
  }

  // Link input bar
  if (dom.hubLinkBtn && dom.hubLinkInput) {
    const handleHubLink = () => {
      const val = dom.hubLinkInput.value.trim();
      if (val) {
        dom.searchInput.value = val;
        search(val);
        dom.hubLinkInput.value = '';
      }
    };
    dom.hubLinkBtn.onclick = handleHubLink;
    dom.hubLinkInput.onkeydown = e => {
      if (e.key === 'Enter') handleHubLink();
    };
  }

  // Genre tags
  $$('.hub-tag').forEach(tagBtn => {
    tagBtn.onclick = () => {
      const tag = tagBtn.dataset.tag;
      if (tag) {
        dom.searchInput.value = tag;
        search(tag);
      }
    };
  });

  // View all history button
  if (dom.hubViewAllHistory) {
    dom.hubViewAllHistory.onclick = () => showView('history');
  }
}

// Dock controls & popovers
function initDockBarControls() {
  // In-dock lyric click
  if (dom.dockLiveLyric) {
    dom.dockLiveLyric.onclick = () => {
      toggleLyricsDrawer();
    };
  }

  // Jump +/- 10s
  if (dom.dockJumpBackBtn) {
    dom.dockJumpBackBtn.onclick = () => {
      audio.currentTime = Math.max(0, audio.currentTime - 10);
      toast('−10 сек ⏪');
    };
  }
  if (dom.dockJumpFwdBtn) {
    dom.dockJumpFwdBtn.onclick = () => {
      if (audio.duration && isFinite(audio.duration)) {
        audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
        toast('+10 сек ⏩');
      }
    };
  }

  // Playback speed
  if (dom.dockSpeedBtn) {
    dom.dockSpeedBtn.onclick = cyclePlaybackSpeed;
  }
  if (dom.fsKaraokeSpeedBtn) dom.fsKaraokeSpeedBtn.onclick = cyclePlaybackSpeed;
  setPlaybackSpeed(state.playbackSpeed || 1, { persist: false, notify: false });

  // Time remaining
  if (dom.totalTime) {
    dom.totalTime.onclick = () => {
      state.showRemainingTime = !state.showRemainingTime;
      if (audio.duration && isFinite(audio.duration)) {
        if (state.showRemainingTime) {
          const rem = Math.max(0, audio.duration - audio.currentTime);
          dom.totalTime.textContent = `-${fmtTime(rem)}`;
        } else {
          dom.totalTime.textContent = fmtTime(audio.duration);
        }
      }
    };
  }

  // Track options menu
  if (dom.dockTrackMoreBtn && dom.dockTrackMenu) {
    dom.dockTrackMoreBtn.onclick = e => {
      e.stopPropagation();
      dom.dockTrackMenu.classList.toggle('hidden');
      if (dom.dockQueuePopover) dom.dockQueuePopover.classList.add('hidden');
      if (dom.dockEqPopover) dom.dockEqPopover.classList.add('hidden');
    };

    if (dom.dfCopyLink) {
      dom.dfCopyLink.onclick = () => {
        if (state.currentTrack?.url) {
          navigator.clipboard.writeText(state.currentTrack.url);
          toast('Ссылка на трек скопирована');
          dom.dockTrackMenu.classList.add('hidden');
        }
      };
    }

    if (dom.dfFindSimilar) {
      dom.dfFindSimilar.onclick = () => {
        if (state.currentTrack) {
          dom.searchInput.value = state.currentTrack.artist;
          search(state.currentTrack.artist);
          dom.dockTrackMenu.classList.add('hidden');
        }
      };
    }

    if (dom.dfDownload) {
      dom.dfDownload.onclick = () => {
        if (state.currentTrack?.url) {
          window.open(`/api/audio?url=${encodeURIComponent(state.currentTrack.url)}`, '_blank');
          toast('Началась загрузка аудио');
          dom.dockTrackMenu.classList.add('hidden');
        }
      };
    }
  }

  // Queue popover
  if (dom.dockQueueBtn && dom.dockQueuePopover) {
    dom.dockQueueBtn.onclick = e => {
      e.stopPropagation();
      const isHidden = dom.dockQueuePopover.classList.toggle('hidden');
      if (dom.dockTrackMenu) dom.dockTrackMenu.classList.add('hidden');
      if (dom.dockEqPopover) dom.dockEqPopover.classList.add('hidden');

      if (!isHidden) {
        renderDockQueue();
      }
    };

    if (dom.closeDockQueueBtn) {
      dom.closeDockQueueBtn.onclick = () => dom.dockQueuePopover.classList.add('hidden');
    }
  }

  // Parametric Equalizer Module (Screenshot Accurate)
  const MIN_FREQ = 20;
  const MAX_FREQ = 20000;
  const MIN_DB = -21;
  const MAX_DB = 21;
  const FREQ_POINTS = 256;
  const sampleFreqs = new Float32Array(FREQ_POINTS);
  for (let i = 0; i < FREQ_POINTS; i++) {
    sampleFreqs[i] = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / (FREQ_POINTS - 1));
  }

  function hexToRgba(hex, alpha = 1) {
    const c = String(hex || '#60a5fa').replace('#', '');
    const r = parseInt(c.substring(0, 2), 16) || 0;
    const g = parseInt(c.substring(2, 4), 16) || 0;
    const b = parseInt(c.substring(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function freqToX(freq, width) {
    const f = Math.max(MIN_FREQ, Math.min(MAX_FREQ, freq));
    return (Math.log10(f / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * width;
  }

  function xToFreq(x, width) {
    const pct = Math.max(0, Math.min(1, x / width));
    return MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, pct);
  }

  function dbToY(db, height) {
    const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db));
    return ((MAX_DB - clamped) / (MAX_DB - MIN_DB)) * height;
  }

  function yToDb(y, height) {
    const pct = Math.max(0, Math.min(1, y / height));
    return MAX_DB - pct * (MAX_DB - MIN_DB);
  }

  function formatHz(freq) {
    if (freq >= 1000) {
      const k = freq / 1000;
      return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}kHz`;
    }
    return `${Math.round(freq)}Hz`;
  }

  function drawEqCanvas() {
    const canvas = $('#eqCanvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Dark canvas background
    ctx.fillStyle = '#0c0e13';
    ctx.fillRect(0, 0, w, h);

    // 1. Horizontal dB grid lines
    for (let db = MIN_DB; db <= MAX_DB; db += 3) {
      const y = dbToY(db, h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      if (db === 0) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 1.2;
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
      }
      ctx.stroke();
    }

    // 2. Vertical frequency grid lines
    const gridFreqs = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    for (const f of gridFreqs) {
      const x = freqToX(f, w);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 3. Real-time background audio spectrum
    if (analyser && state.isPlaying && dataArray) {
      analyser.getByteFrequencyData(dataArray);
      const nyquist = (audioCtx?.sampleRate || 44100) / 2;
      const binCount = analyser.frequencyBinCount;

      ctx.beginPath();
      ctx.moveTo(0, h);

      let first = true;
      for (let i = 0; i < FREQ_POINTS; i++) {
        const f = sampleFreqs[i];
        if (f > nyquist) break;
        const bin = Math.min(binCount - 1, Math.floor((f / nyquist) * binCount));
        const val = (dataArray[bin] || 0) / 255;
        const x = freqToX(f, w);
        const specY = h - (val * h * 0.65);

        if (first) {
          ctx.lineTo(x, specY);
          first = false;
        } else {
          ctx.lineTo(x, specY);
        }
      }

      ctx.lineTo(w, h);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, h * 0.35, 0, h);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.01)');
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = 'rgba(125, 211, 252, 0.32)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // 4. Combined EQ response curve
    const totalDb = new Float32Array(FREQ_POINTS);
    if (eqFilterNodes.length > 0 && audioCtx) {
      const mag = new Float32Array(FREQ_POINTS);
      const phase = new Float32Array(FREQ_POINTS);
      for (const node of eqFilterNodes) {
        node.getFrequencyResponse(sampleFreqs, mag, phase);
        for (let i = 0; i < FREQ_POINTS; i++) {
          totalDb[i] += 20 * Math.log10(Math.max(1e-6, mag[i]));
        }
      }
    }

    ctx.beginPath();
    for (let i = 0; i < FREQ_POINTS; i++) {
      const x = (i / (FREQ_POINTS - 1)) * w;
      const clampedDb = Math.max(MIN_DB, Math.min(MAX_DB, totalDb[i]));
      const y = dbToY(clampedDb, h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.shadowColor = '#60a5fa';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#7aa2f7';
    ctx.lineWidth = 2.8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 5. Band Control Points
    state.eqBands.forEach((band, idx) => {
      const nx = freqToX(band.freq, w);
      const ny = dbToY(band.gain, h);
      const isSelected = idx === state.selectedEqBand;

      if (isSelected) {
        // Vertical dashed drop line to 0 dB
        const yZero = dbToY(0, h);
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx, yZero);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        // Outer glow halo
        ctx.beginPath();
        ctx.arc(nx, ny, 16, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(band.color || '#60a5fa', 0.28);
        ctx.fill();
      }

      // Center Node
      ctx.beginPath();
      ctx.arc(nx, ny, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = band.color || '#60a5fa';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    ctx.restore();
  }

  function updateEqBottomPanel() {
    const controls = $('#eqBandControls');
    const hint = $('#eqHintText');
    const nameEl = $('#eqBandName');
    const statEl = $('#eqBandStat');
    const qSlider = $('#eqQSlider');
    const qReadout = $('#eqQReadout');
    const typeBtns = $$('#eqTypeGroup .eq-type-btn');

    if (state.selectedEqBand >= 0 && state.eqBands[state.selectedEqBand]) {
      const b = state.eqBands[state.selectedEqBand];
      if (controls) controls.classList.remove('hidden');
      if (hint) hint.classList.add('hidden');

      if (nameEl) {
        nameEl.textContent = `BAND ${state.selectedEqBand + 1}`;
        nameEl.style.color = b.color || '#fff';
      }
      if (statEl) {
        const sign = b.gain > 0 ? '+' : '';
        statEl.textContent = `${formatHz(b.freq)} / ${sign}${b.gain.toFixed(1)}dB`;
      }
      if (qSlider) qSlider.value = b.q || 1.0;
      if (qReadout) qReadout.textContent = (b.q || 1.0).toFixed(2);

      typeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === b.type);
      });
    } else {
      if (controls) controls.classList.add('hidden');
      if (hint) hint.classList.remove('hidden');
    }
  }

  function updateEqPresetUI() {
    const label = $('#eqPresetLabel');
    if (label) {
      const p = state.eqPreset || 'custom';
      const names = {
        flat: 'Flat',
        bass: 'Bass Boost',
        vocal: 'Vocal',
        rock: 'Rock',
        treble: 'Treble Boost',
        electronic: 'Electronic',
        acoustic: 'Acoustic',
        custom: 'Custom',
      };
      label.textContent = names[p] || (p.charAt(0).toUpperCase() + p.slice(1));
    }

    $$('.eq-preset-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === state.eqPreset);
    });
  }

  function addEqBand(freq = 1000, gain = 0) {
    if (state.eqBands.length >= 12) {
      toast('Максимальное количество полос: 12');
      return;
    }
    const color = BAND_COLORS[state.eqBands.length % BAND_COLORS.length];
    state.eqBands.push({
      id: Date.now(),
      freq: Math.max(20, Math.min(20000, freq)),
      gain: Math.max(-21, Math.min(21, gain)),
      q: 1.0,
      type: 'peaking',
      color,
    });
    state.selectedEqBand = state.eqBands.length - 1;
    state.eqPreset = 'custom';
    initAudioContext();
    rebuildEqAudioGraph();
    updateEqPresetUI();
    updateEqBottomPanel();
    drawEqCanvas();
    localStorage.setItem('lf_eq_bands', JSON.stringify(state.eqBands));
    localStorage.setItem('lf_eq_preset', state.eqPreset);
  }

  function removeEqBand(index) {
    if (state.eqBands.length <= 1) {
      toast('Нельзя удалить последнюю полосу');
      return;
    }
    state.eqBands.splice(index, 1);
    state.selectedEqBand = -1;
    state.eqPreset = 'custom';
    initAudioContext();
    rebuildEqAudioGraph();
    updateEqPresetUI();
    updateEqBottomPanel();
    drawEqCanvas();
    localStorage.setItem('lf_eq_bands', JSON.stringify(state.eqBands));
    localStorage.setItem('lf_eq_preset', state.eqPreset);
  }

  function openEqModal() {
    initAudioContext();
    const scrim = $('#eqModalScrim');
    if (!scrim) return;
    scrim.classList.remove('hidden');
    updateEqPresetUI();
    updateEqBottomPanel();
    requestAnimationFrame(drawEqCanvas);
  }

  function closeEqModal() {
    const scrim = $('#eqModalScrim');
    if (scrim) scrim.classList.add('hidden');
    const dropdown = $('#eqPresetDropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }

  // Setup Equalizer event handlers
  if (dom.dockEqBtn) {
    dom.dockEqBtn.onclick = (e) => {
      e.stopPropagation();
      openEqModal();
    };
  }

  const closeEqModalBtn = $('#closeEqModalBtn');
  if (closeEqModalBtn) closeEqModalBtn.onclick = closeEqModal;

  const eqModalScrim = $('#eqModalScrim');
  if (eqModalScrim) {
    eqModalScrim.onclick = (e) => {
      if (e.target === eqModalScrim) closeEqModal();
    };
  }

  const eqPresetBtn = $('#eqPresetBtn');
  const eqPresetDropdown = $('#eqPresetDropdown');
  if (eqPresetBtn && eqPresetDropdown) {
    eqPresetBtn.onclick = (e) => {
      e.stopPropagation();
      eqPresetDropdown.classList.toggle('hidden');
    };
    document.addEventListener('pointerdown', e => {
      if (!eqPresetDropdown.contains(e.target) && e.target !== eqPresetBtn) {
        eqPresetDropdown.classList.add('hidden');
      }
    });
  }

  $$('.eq-preset-item').forEach(btn => {
    btn.onclick = () => {
      const p = btn.dataset.preset;
      setEqPreset(p);
      if (eqPresetDropdown) eqPresetDropdown.classList.add('hidden');
    };
  });

  const eqAddBandTopBtn = $('#eqAddBandTopBtn');
  if (eqAddBandTopBtn) eqAddBandTopBtn.onclick = () => addEqBand(1000, 0);

  const eqAddBandBtn = $('#eqAddBandBtn');
  if (eqAddBandBtn) eqAddBandBtn.onclick = () => addEqBand(1000, 0);

  const eqResetBtn = $('#eqResetBtn');
  if (eqResetBtn) eqResetBtn.onclick = () => setEqPreset('flat');

  const eqQSlider = $('#eqQSlider');
  if (eqQSlider) {
    eqQSlider.oninput = () => {
      if (state.selectedEqBand >= 0 && state.eqBands[state.selectedEqBand]) {
        const b = state.eqBands[state.selectedEqBand];
        b.q = parseFloat(eqQSlider.value) || 1.0;
        state.eqPreset = 'custom';
        updateEqPresetUI();
        updateFilterNode(state.selectedEqBand);
        const qReadout = $('#eqQReadout');
        if (qReadout) qReadout.textContent = b.q.toFixed(2);
        drawEqCanvas();
        localStorage.setItem('lf_eq_bands', JSON.stringify(state.eqBands));
        localStorage.setItem('lf_eq_preset', state.eqPreset);
      }
    };
  }

  $$('#eqTypeGroup .eq-type-btn').forEach(btn => {
    btn.onclick = () => {
      if (state.selectedEqBand >= 0 && state.eqBands[state.selectedEqBand]) {
        const b = state.eqBands[state.selectedEqBand];
        b.type = btn.dataset.type;
        state.eqPreset = 'custom';
        updateEqPresetUI();
        updateFilterNode(state.selectedEqBand);
        updateEqBottomPanel();
        drawEqCanvas();
        localStorage.setItem('lf_eq_bands', JSON.stringify(state.eqBands));
        localStorage.setItem('lf_eq_preset', state.eqPreset);
      }
    };
  });

  const eqBandRemoveBtn = $('#eqBandRemoveBtn');
  if (eqBandRemoveBtn) {
    eqBandRemoveBtn.onclick = () => {
      if (state.selectedEqBand >= 0) removeEqBand(state.selectedEqBand);
    };
  }

  // Setup canvas dragging & mouse wheel
  const canvas = $('#eqCanvas');
  if (canvas) {
    let isDragging = false;
    let draggedIdx = -1;

    const getCoords = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
        w: rect.width,
        h: rect.height,
      };
    };

    canvas.addEventListener('pointerdown', e => {
      const { x, y, w, h } = getCoords(e);
      let hit = -1;
      for (let i = 0; i < state.eqBands.length; i++) {
        const b = state.eqBands[i];
        const nx = freqToX(b.freq, w);
        const ny = dbToY(b.gain, h);
        if (Math.hypot(x - nx, y - ny) <= 20) {
          hit = i;
          break;
        }
      }

      if (hit >= 0) {
        state.selectedEqBand = hit;
        isDragging = true;
        draggedIdx = hit;
        canvas.setPointerCapture(e.pointerId);
        updateEqBottomPanel();
        drawEqCanvas();
      } else {
        state.selectedEqBand = -1;
        updateEqBottomPanel();
        drawEqCanvas();
      }
    });

    canvas.addEventListener('pointermove', e => {
      const { x, y, w, h } = getCoords(e);
      if (isDragging && draggedIdx >= 0) {
        const b = state.eqBands[draggedIdx];
        b.freq = Math.round(xToFreq(x, w));
        b.gain = Math.round(yToDb(y, h) * 10) / 10;
        state.eqPreset = 'custom';
        updateEqPresetUI();
        updateFilterNode(draggedIdx);
        updateEqBottomPanel();
        drawEqCanvas();
        return;
      }

      let hover = false;
      for (const b of state.eqBands) {
        const nx = freqToX(b.freq, w);
        const ny = dbToY(b.gain, h);
        if (Math.hypot(x - nx, y - ny) <= 16) {
          hover = true;
          break;
        }
      }
      canvas.style.cursor = hover ? 'crosshair' : 'default';
    });

    canvas.addEventListener('pointerup', e => {
      if (isDragging) {
        isDragging = false;
        draggedIdx = -1;
        try { canvas.releasePointerCapture(e.pointerId); } catch {}
        localStorage.setItem('lf_eq_bands', JSON.stringify(state.eqBands));
        localStorage.setItem('lf_eq_preset', state.eqPreset);
      }
    });

    canvas.addEventListener('dblclick', e => {
      const { x, y, w, h } = getCoords(e);
      const freq = Math.round(xToFreq(x, w));
      const gain = Math.round(yToDb(y, h) * 10) / 10;
      addEqBand(freq, gain);
    });

    canvas.addEventListener('wheel', e => {
      const { x, y, w, h } = getCoords(e);
      let target = state.selectedEqBand;
      for (let i = 0; i < state.eqBands.length; i++) {
        const b = state.eqBands[i];
        const nx = freqToX(b.freq, w);
        const ny = dbToY(b.gain, h);
        if (Math.hypot(x - nx, y - ny) <= 22) {
          target = i;
          state.selectedEqBand = i;
          break;
        }
      }

      if (target >= 0 && state.eqBands[target]) {
        e.preventDefault();
        const b = state.eqBands[target];
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        b.q = Math.round(Math.max(0.1, Math.min(10.0, (b.q || 1.0) + delta)) * 100) / 100;
        state.eqPreset = 'custom';
        updateEqPresetUI();
        updateFilterNode(target);
        updateEqBottomPanel();
        drawEqCanvas();
        localStorage.setItem('lf_eq_bands', JSON.stringify(state.eqBands));
        localStorage.setItem('lf_eq_preset', state.eqPreset);
      }
    }, { passive: false });
  }

  // Volume mouse wheel
  if (dom.volumeWidget) {
    dom.volumeWidget.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.04 : -0.04;
      state.volume = Math.max(0, Math.min(1, state.volume + delta));
      audio.volume = state.volume;
      localStorage.setItem('lf_volume', state.volume);
      updateVolumeUI();
    }, { passive: false });
  }

  // Global click outside to close popovers
  document.addEventListener('click', e => {
    if (dom.dockTrackMenu && !dom.dockTrackMenu.contains(e.target) && e.target !== dom.dockTrackMoreBtn) {
      dom.dockTrackMenu.classList.add('hidden');
    }
    if (dom.dockQueuePopover && !dom.dockQueuePopover.contains(e.target) && e.target !== dom.dockQueueBtn) {
      dom.dockQueuePopover.classList.add('hidden');
    }
    if (dom.dockEqPopover && !dom.dockEqPopover.contains(e.target) && e.target !== dom.dockEqBtn) {
      dom.dockEqPopover.classList.add('hidden');
    }
  });
}

function renderDockQueue() {
  if (!dom.dockQueueList) return;
  const upcoming = state.queue.slice(state.currentIndex + 1, state.currentIndex + 12);
  if (!upcoming.length) {
    dom.dockQueueList.innerHTML = '<div style="color:var(--text-muted);font-size:11.5px;padding:14px;text-align:center;">Очередь пуста</div>';
    return;
  }
  dom.dockQueueList.innerHTML = upcoming.map((t, i) => `
    <div class="dock-flyout-item" data-offset="${i + 1}">
      <img src="${t.thumbnail || PLACEHOLDER_IMG}" style="width:28px;height:28px;border-radius:4px;object-fit:cover;" alt="" onerror="this.src='${PLACEHOLDER_IMG}'">
      <div style="min-width:0;flex:1;">
        <div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(t.title)}</div>
        <div style="font-size:10.5px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(t.artist)}</div>
      </div>
    </div>
  `).join('');

  dom.dockQueueList.querySelectorAll('.dock-flyout-item').forEach(el => {
    el.onclick = () => {
      const offset = parseInt(el.dataset.offset);
      const targetIdx = state.currentIndex + offset;
      if (state.queue[targetIdx]) {
        state.currentIndex = targetIdx;
        playTrack(state.queue[targetIdx]);
        renderDockQueue();
      }
    };
  });
}

// Settings
function initSettings() {
  state.settings = loadJSON('lf_settings', {
    lyricMode: 'replace',
    lyricAnim: 'slide',
    hqCovers: true,
    ambientBlur: true,
    defaultEq: 'flat',
    defaultSpeed: 1.0,
  });
  state.eqPreset = state.settings.defaultEq || 'flat';

  const applySettings = () => {
    saveJSON('lf_settings', state.settings);

    // Apply button active states
    $$('#settingLyricMode .sp-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.settings.lyricMode));
    $$('#settingLyricAnim .sp-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.anim === state.settings.lyricAnim));
    $$('#settingDefaultEq .sp-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === state.settings.defaultEq));
    $$('#settingDefaultSpeed .sp-seg-btn').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.speed) === state.settings.defaultSpeed));

    const isLyricOn = state.settings.lyricMode !== 'off';
    const animRow = $('#animSettingRow');
    if (animRow) {
      animRow.style.opacity = isLyricOn ? '1' : '0.35';
      animRow.style.pointerEvents = isLyricOn ? 'auto' : 'none';
      animRow.style.transition = 'opacity 0.2s ease';
    }

    const isBlur = state.settings.ambientBlur !== false;
    if (dom.tileAmbientBlur) dom.tileAmbientBlur.setAttribute('aria-checked', String(isBlur));
    if (dom.statusAmbientBlur) {
      dom.statusAmbientBlur.classList.toggle('active', isBlur);
      dom.statusAmbientBlur.textContent = isBlur ? 'Вкл' : 'Выкл';
    }
    if (dom.ambientBackdrop) dom.ambientBackdrop.style.display = isBlur ? 'block' : 'none';

    const isHq = state.settings.hqCovers !== false;
    if (dom.tileHqCovers) dom.tileHqCovers.setAttribute('aria-checked', String(isHq));
    if (dom.statusHqCovers) {
      dom.statusHqCovers.classList.toggle('active', isHq);
      dom.statusHqCovers.textContent = isHq ? '1000px' : 'Стандарт';
    }

    if (state.currentTrack) updatePlayerUI();
  };

  const updateAuthStatusUI = async () => {
    try {
      const res = await fetch('/api/cookies/status');
      const data = await res.json();
      if (!data) return;

      const spYmDot = $('#spYmDot');
      const spYmState = $('#spYmState');
      const spYtDot = $('#spYtDot');
      const spYtState = $('#spYtState');

      if (spYmDot && spYmState) {
        if (data.yandexSession && data.yandexHasPlus) {
          spYmDot.className = 'status-dot active';
          spYmState.textContent = data.yandexUsername ? `Вход: ${data.yandexUsername} (Плюс)` : 'Вход выполнен (Плюс)';
          spYmState.style.color = '#34d399';
        } else if (data.yandexSession && !data.yandexHasPlus) {
          spYmDot.className = 'status-dot warning';
          spYmState.textContent = data.yandexUsername ? `Вход: ${data.yandexUsername} (нет Плюса, 30с)` : 'Вход без подписки (превью 30с)';
          spYmState.style.color = '#fbbf24';
        } else {
          spYmDot.className = 'status-dot';
          spYmState.textContent = 'Не авторизован (превью 30с)';
          spYmState.style.color = 'var(--text-muted)';
        }
      }

      if (spYtDot && spYtState) {
        if (data.youtubeSession) {
          spYtDot.className = 'status-dot active';
          spYtState.textContent = 'Вход выполнен';
          spYtState.style.color = '#34d399';
        } else {
          spYtDot.className = 'status-dot';
          spYtState.textContent = 'Не авторизован (гость)';
          spYtState.style.color = 'var(--text-muted)';
        }
      }
    } catch {}
  };

  // Toggle Settings Popover
  const toggleSettings = (e) => {
    if (e) e.stopPropagation();
    if (!dom.settingsPopover) return;
    const isHidden = dom.settingsPopover.classList.contains('hidden');
    if (isHidden) {
      dom.settingsPopover.classList.remove('hidden');
      updateAuthStatusUI();
    } else {
      dom.settingsPopover.classList.add('hidden');
    }
  };

  if (dom.settingsBtn) dom.settingsBtn.onclick = toggleSettings;
  if (dom.settingsCloseBtn) dom.settingsCloseBtn.onclick = closeSettings;

  const bindSwitchKeyboard = element => {
    if (!element) return;
    element.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      element.click();
    });
  };

  // Close when clicking outside
  document.addEventListener('pointerdown', e => {
    if (dom.settingsPopover && !dom.settingsPopover.classList.contains('hidden')) {
      if (!dom.settingsPopover.contains(e.target) && !dom.settingsBtn.contains(e.target)) {
        dom.settingsPopover.classList.add('hidden');
      }
    }
  });

  $$('#settingLyricMode .sp-seg-btn').forEach(b => {
    b.onclick = () => {
      const mode = b.dataset.mode;
      state.settings.lyricMode = mode;
      applySettings();
      if (mode === 'off') {
        if (dom.playerLeft) dom.playerLeft.classList.remove('prompter-mode');
        if (dom.dockLyricsPrompter) dom.dockLyricsPrompter.classList.add('hidden');
        toast('Текст в строке отключен');
      } else {
        if (state.lyrics && state.lyrics.parsedLrc && state.lyrics.parsedLrc.length > 0) {
          updateLyricsHighlight(audio.currentTime);
        }
        toast('Текст в строке включен');
      }
    };
  });

  $$('#settingLyricAnim .sp-seg-btn').forEach(b => {
    b.onclick = () => {
      const anim = b.dataset.anim;
      state.settings.lyricAnim = anim;
      applySettings();
      if (dom.prompterRoller) {
        dom.prompterRoller.className = `prompter-roller anim-${anim}`;
        if (anim !== 'none') {
          void dom.prompterRoller.offsetWidth;
          dom.prompterRoller.classList.add('rolling');
        }
      }
      toast(`Анимация: ${b.textContent}`);
    };
  });

  if (dom.tileAmbientBlur) {
    dom.tileAmbientBlur.onclick = () => {
      state.settings.ambientBlur = !state.settings.ambientBlur;
      applySettings();
      toast(state.settings.ambientBlur ? 'Размытый фон включен' : 'Размытый фон выключен');
    };
    bindSwitchKeyboard(dom.tileAmbientBlur);
  }

  if (dom.tileHqCovers) {
    dom.tileHqCovers.onclick = () => {
      state.settings.hqCovers = !state.settings.hqCovers;
      applySettings();
      toast(state.settings.hqCovers ? 'Ultra-HD качество (1000px)' : 'Стандартное качество');
    };
    bindSwitchKeyboard(dom.tileHqCovers);
  }

  $$('#settingDefaultEq .sp-seg-btn').forEach(b => {
    b.onclick = () => {
      state.settings.defaultEq = b.dataset.preset;
      setEqPreset(b.dataset.preset);
      applySettings();
    };
  });

  $$('#settingDefaultSpeed .sp-seg-btn').forEach(b => {
    b.onclick = () => {
      state.settings.defaultSpeed = parseFloat(b.dataset.speed);
      setPlaybackSpeed(state.settings.defaultSpeed, { notify: false });
      applySettings();
      toast(`Скорость: ${state.playbackSpeed}x`);
    };
  });

  const spLoginYmBtn = $('#spLoginYmBtn');
  const spLoginYtBtn = $('#spLoginYtBtn');
  const setRefreshBtn = $('#setRefreshCookiesBtn');
  const setPasteCookiesBtn = $('#setPasteCookiesBtn');

  const cookieModalScrim = $('#cookieModalScrim');
  const closeCookieModalBtn = $('#closeCookieModalBtn');
  const cancelCookieModalBtn = $('#cancelCookieModalBtn');
  const saveCookieModalBtn = $('#saveCookieModalBtn');
  const cookieTextarea = $('#cookieTextarea');

  if (spLoginYmBtn) {
    spLoginYmBtn.onclick = async () => {
      if (window.desktop?.auth?.login) {
        toast('Открываю окно входа Яндекс...');
        try {
          const res = await window.desktop.auth.login('yandex');
          if (res?.ok) {
            toast('Вход в Яндекс Музыку выполнен!');
            await updateAuthStatusUI();
            loadRuntimeStatus();
          }
        } catch (err) {
          toast(err.message || 'Ошибка авторизации');
        }
      }
    };
  }

  if (spLoginYtBtn) {
    spLoginYtBtn.onclick = async () => {
      if (window.desktop?.auth?.login) {
        toast('Открываю окно входа Google / YouTube...');
        try {
          const res = await window.desktop.auth.login('youtube');
          if (res?.ok) {
            toast('Вход в YouTube Music выполнен!');
            await updateAuthStatusUI();
            loadRuntimeStatus();
          }
        } catch (err) {
          toast(err.message || 'Ошибка авторизации');
        }
      }
    };
  }

  if (setRefreshBtn) {
    setRefreshBtn.onclick = async () => {
      toast('Поиск cookies в браузерах (Zen, Chrome, Edge, Firefox, Brave, Opera)...');
      try {
        const data = await refreshAuthCookies();
        toast(`Cookies импортированы (${data.browser || 'браузер'}: ${data.count || 0} шт.)`);
        await updateAuthStatusUI();
      } catch (err) {
        toast(err.message || 'Ошибка импорта cookies');
      }
    };
  }

  if (setPasteCookiesBtn && cookieModalScrim) {
    setPasteCookiesBtn.onclick = () => {
      cookieModalScrim.classList.remove('hidden');
      if (cookieTextarea) {
        cookieTextarea.value = '';
        cookieTextarea.focus();
      }
    };
  }

  const hideCookieModal = () => {
    if (cookieModalScrim) cookieModalScrim.classList.add('hidden');
  };

  if (closeCookieModalBtn) closeCookieModalBtn.onclick = hideCookieModal;
  if (cancelCookieModalBtn) cancelCookieModalBtn.onclick = hideCookieModal;
  if (cookieModalScrim) {
    cookieModalScrim.onclick = e => {
      if (e.target === cookieModalScrim) hideCookieModal();
    };
  }

  if (saveCookieModalBtn && cookieTextarea) {
    saveCookieModalBtn.onclick = async () => {
      const text = cookieTextarea.value.trim();
      if (!text) {
        toast('Вставьте текст cookies');
        return;
      }
      try {
        const res = await fetch('/api/cookies/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Ошибка импорта');
        hideCookieModal();
        toast(`Успешно сохранено ${data.count} cookies!`);
        await updateAuthStatusUI();
        loadRuntimeStatus();
      } catch (err) {
        toast(err.message || 'Не удалось сохранить cookies');
      }
    };
  }

  const setShortcutsBtn = $('#setShortcutsBtn');
  if (setShortcutsBtn) {
    setShortcutsBtn.onclick = () => {
      if (dom.settingsPopover) dom.settingsPopover.classList.add('hidden');
      if (dom.shortcutsModal) dom.shortcutsModal.classList.remove('hidden');
    };
  }

  if (dom.closeShortcutsBtn) {
    dom.closeShortcutsBtn.onclick = () => {
      if (dom.shortcutsModal) dom.shortcutsModal.classList.add('hidden');
    };
  }
  if (dom.shortcutsModal) {
    dom.shortcutsModal.onclick = e => {
      if (e.target === dom.shortcutsModal) dom.shortcutsModal.classList.add('hidden');
    };
  }

  const setClearHist = $('#setClearHistoryBtn');
  if (setClearHist) {
    setClearHist.onclick = () => {
      localStorage.removeItem('lf_history');
      localStorage.removeItem('sf_history');
      state.history = [];
      renderHomeRecent();
      if (state.currentView === 'history') showView('history');
      toast('История очищена');
    };
  }

  applySettings();
}

function openSettings() {
  if (dom.settingsPopover) dom.settingsPopover.classList.toggle('hidden');
}

function closeSettings() {
  if (dom.settingsPopover) dom.settingsPopover.classList.add('hidden');
}

function initCustomContextMenu() {
  const menu = dom.customContextMenu;
  if (!menu) return;

  const closeCtx = () => {
    menu.classList.add('hidden');
  };

  document.addEventListener('click', closeCtx);
  window.addEventListener('resize', closeCtx);
  window.addEventListener('scroll', closeCtx, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCtx();
    if (e.key === ',' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      openSettings();
    }
  });

  window.addEventListener('contextmenu', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    e.preventDefault();

    const trackRow = e.target.closest('[data-track-id], .table-row, .hub-track-card, .sq-item, .fsq-row, .player-left');
    const lyricRow = e.target.closest('.lrc-row, .fs-lrc-row, .lyrics-drawer-body, .cinema-lyrics-scroll');

    let itemsHtml = '';
    let targetTrack = null;

    if (trackRow) {
      const trackId = trackRow.dataset.trackId;
      if (trackId) {
        targetTrack = (state.currentTracksList || []).find(t => trackIdentity(t) === trackId) ||
                      (state.queue || []).find(t => trackIdentity(t) === trackId) ||
                      (state.liked || []).find(t => trackIdentity(t) === trackId);
      } else if (trackRow.classList.contains('player-left')) {
        targetTrack = state.currentTrack;
      }

      if (targetTrack) {
        const isLiked = state.liked.some(t => trackKey(t) === trackKey(targetTrack));
        if (dom.ctxHeader) {
          dom.ctxHeader.classList.remove('hidden');
          dom.ctxArt.src = targetTrack.thumbnail || PLACEHOLDER_IMG;
          dom.ctxTitle.textContent = targetTrack.title;
          dom.ctxArtist.textContent = targetTrack.artist;
        }

        itemsHtml = `
          <button class="ctx-item" data-action="play">
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
            <span>Воспроизвести</span>
            <span class="ctx-kbd">↵</span>
          </button>
          <button class="ctx-item" data-action="play-next">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="4" x2="19" y2="20"/></svg>
            <span>Воспроизвести следующим</span>
          </button>
          <button class="ctx-item" data-action="add-queue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>В конец очереди</span>
          </button>
          <div class="ctx-divider"></div>
          <button class="ctx-item" data-action="like">
            <svg viewBox="0 0 24 24" fill="${isLiked ? '#ef4444' : 'none'}" stroke="${isLiked ? '#ef4444' : 'currentColor'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span>${isLiked ? 'Удалить из Избранного' : 'Добавить в Избранное'}</span>
            <span class="ctx-kbd">L</span>
          </button>
          <button class="ctx-item" data-action="lyrics">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>Текст песни</span>
            <span class="ctx-kbd">T</span>
          </button>
          <button class="ctx-item" data-action="similar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span>Радио по артисту</span>
          </button>
          <div class="ctx-divider"></div>
          <button class="ctx-item" data-action="copy-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Скопировать ссылку</span>
          </button>
          <button class="ctx-item" data-action="download">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Скачать трек</span>
          </button>
        `;
      }
    }

    if (!targetTrack && lyricRow) {
      if (dom.ctxHeader) dom.ctxHeader.classList.add('hidden');
      const time = lyricRow.dataset.time;
      const text = lyricRow.innerText;

      itemsHtml = `
        ${time ? `
        <button class="ctx-item" data-action="play-lyric-time" data-time="${time}">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
          <span>Воспроизвести отсюда</span>
        </button>
        <button class="ctx-item" data-action="copy-lyric-line" data-text="${esc(text)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Скопировать эту строку</span>
        </button>
        <div class="ctx-divider"></div>
        ` : ''}
        <button class="ctx-item" data-action="copy-all-lyrics">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span>Скопировать весь текст</span>
        </button>
        <button class="ctx-item" data-action="open-settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>Настройки караоке</span>
        </button>
      `;
    }

    if (!itemsHtml) {
      if (dom.ctxHeader) dom.ctxHeader.classList.add('hidden');
      itemsHtml = `
        <button class="ctx-item" data-action="play-pause">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
          <span>${state.isPlaying ? 'Пауза' : 'Воспроизвести'}</span>
          <span class="ctx-kbd">Space</span>
        </button>
        <button class="ctx-item" data-action="next">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" stroke-width="2.5"/></svg>
          <span>Следующий трек</span>
          <span class="ctx-kbd">Shift+→</span>
        </button>
        <button class="ctx-item" data-action="fullscreen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          <span>Полноэкранный режим</span>
          <span class="ctx-kbd">F</span>
        </button>
        <div class="ctx-divider"></div>
        <button class="ctx-item" data-action="go-home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
          <span>Главная страница</span>
        </button>
        <button class="ctx-item" data-action="focus-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span>Поиск</span>
          <span class="ctx-kbd">/</span>
        </button>
        <button class="ctx-item" data-action="open-settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>Настройки плеера</span>
        </button>
      `;
    }

    dom.ctxItemsList.innerHTML = itemsHtml;
    menu.classList.remove('hidden');

    // Handle clicks inside context menu
    dom.ctxItemsList.querySelectorAll('.ctx-item').forEach(btn => {
      btn.onclick = () => {
        const action = btn.dataset.action;
        if (action === 'play' && targetTrack) {
          const targetId = trackIdentity(targetTrack);
          const currentListHasTrack = (state.currentTracksList || []).some(track => trackIdentity(track) === targetId);
          const queueHasTrack = (state.queue || []).some(track => trackIdentity(track) === targetId);
          const sourceList = currentListHasTrack ? state.currentTracksList : (queueHasTrack ? state.queue : [targetTrack]);
          playStandaloneFromList(targetTrack, sourceList);
        }
        else if (action === 'play-next' && targetTrack) {
          state.queue.splice(state.currentIndex + 1, 0, targetTrack);
          syncQueueUI();
          toast(`Будет воспроизведен следующим: ${targetTrack.title}`);
        }
        else if (action === 'add-queue' && targetTrack) {
          state.queue.push(targetTrack);
          syncQueueUI();
          toast(`Добавлено в очередь: ${targetTrack.title}`);
        }
        else if (action === 'like' && targetTrack) toggleTrackLike(targetTrack);
        else if (action === 'lyrics') toggleLyricsDrawer();
        else if (action === 'similar' && targetTrack) {
          dom.searchInput.value = targetTrack.artist;
          search(targetTrack.artist);
        }
        else if (action === 'copy-link' && targetTrack?.url) {
          navigator.clipboard.writeText(targetTrack.url);
          toast('Ссылка скопирована');
        }
        else if (action === 'download' && targetTrack?.url) {
          window.open(`/api/audio?url=${encodeURIComponent(targetTrack.url)}`, '_blank');
          toast('Загрузка трека...');
        }
        else if (action === 'play-lyric-time') {
          audio.currentTime = parseFloat(btn.dataset.time);
        }
        else if (action === 'copy-lyric-line') {
          navigator.clipboard.writeText(btn.dataset.text);
          toast('Строка скопирована');
        }
        else if (action === 'copy-all-lyrics') copyLyricsText();
        else if (action === 'play-pause') togglePlay();
        else if (action === 'next') playNext();
        else if (action === 'fullscreen') toggleFullscreen();
        else if (action === 'go-home') showView('search');
        else if (action === 'focus-search') dom.searchInput.focus();
        else if (action === 'open-settings') openSettings();

        closeCtx();
      };
    });

    // Safe positioning
    const menuWidth = 240;
    const menuHeight = menu.offsetHeight || 300;
    let posX = e.clientX;
    let posY = e.clientY;

    if (posX + menuWidth > window.innerWidth - 10) posX = window.innerWidth - menuWidth - 10;
    if (posY + menuHeight > window.innerHeight - 10) posY = window.innerHeight - menuHeight - 10;

    menu.style.left = `${Math.max(10, posX)}px`;
    menu.style.top = `${Math.max(10, posY)}px`;
  });
}

function restorePersistedSession() {
  let canonical = persistedSession.currentTrack || null;
  const queued = state.currentIndex >= 0 ? state.queue[state.currentIndex] : null;
  if (queued && (!canonical || trackKey(queued) === trackKey(canonical))) canonical = queued;
  if (!canonical) return;

  state.currentCanonicalTrack = canonical;
  const variantIndex = getSelectedVariantIndex(canonical);
  state.currentTrack = materializeTrack(canonical, variantIndex);
  state.needsSessionRestore = true;
  state.isPlaying = false;
  setPlaybackSpeed(state.playbackSpeed || 1, { persist: false, notify: false });
  if (dom.shuffleBtn) dom.shuffleBtn.classList.toggle('active', state.shuffle);
  if (dom.fsShuffleBtn) dom.fsShuffleBtn.classList.toggle('active', state.shuffle);
  updateRepeatUI();
  updatePlayerUI();
  if (state.restoredTime > 0) {
    const duration = Number(canonical.duration) || 0;
    if (dom.currentTime) dom.currentTime.textContent = fmtTime(state.restoredTime);
    if (dom.fsCurrentTime) dom.fsCurrentTime.textContent = fmtTime(state.restoredTime);
    if (duration > 0) {
      const pct = Math.max(0, Math.min(1, state.restoredTime / duration));
      if (dom.progressBar) dom.progressBar.value = pct * 1000;
      if (dom.progressFill) dom.progressFill.style.width = `${pct * 100}%`;
      if (dom.fsProgressBar) dom.fsProgressBar.value = pct * 1000;
      if (dom.fsProgressFill) dom.fsProgressFill.style.width = `${pct * 100}%`;
      if (dom.totalTime) dom.totalTime.textContent = fmtTime(duration);
      if (dom.fsTotalTime) dom.fsTotalTime.textContent = fmtTime(duration);
    }
  }
  fetchLyrics(canonical);
}

// Startup
renderSidebarQueue();
updateCounters();
startVisualizer();
initHomeHub();
initLyricsControls();
initDockBarControls();
initSettings();
initCustomContextMenu();
initRescue();
initLibraryMap();
initWave();
initDesktopShell();
restorePersistedSession();
loadRuntimeStatus();

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.desktop && !window.listenfoldDesktop) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

window.addEventListener('beforeunload', () => persistSession(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) persistSession(true);
});
