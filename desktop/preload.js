'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function listen(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('A callback function is required');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const desktop = Object.freeze({
  isDesktop: true,
  platform: process.platform,
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
  window: Object.freeze({
    minimize: () => invoke('desktop:window-minimize'),
    toggleMaximize: () => invoke('desktop:window-toggle-maximize'),
    close: () => invoke('desktop:window-close'),
    getState: () => invoke('desktop:window-get-state'),
    onStateChange: callback => listen('desktop:window-state', callback),
  }),
  miniPlayer: Object.freeze({
    toggle: () => invoke('desktop:mini-player-toggle'),
    getState: () => invoke('desktop:mini-player-get-state'),
    onChange: callback => listen('desktop:mini-player-changed', callback),
  }),
  setPlaybackState: state => invoke('desktop:set-playback-state', state),
  openExternal: url => invoke('desktop:open-external', url),
  getVersion: () => invoke('desktop:app-version'),
  onMediaCommand: callback => listen('desktop:media-command', callback),
  auth: Object.freeze({
    login: service => invoke('desktop:auth-login', service),
  }),
});

contextBridge.exposeInMainWorld('desktop', desktop);
contextBridge.exposeInMainWorld('listenfoldDesktop', desktop);

function applyShellClasses() {
  document.documentElement.classList.add('is-desktop', 'desktop-shell', `desktop-${process.platform}`);
  document.documentElement.dataset.platform = process.platform;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyShellClasses, { once: true });
} else {
  applyShellClasses();
}

ipcRenderer.on('desktop:mini-player-changed', (_event, enabled) => {
  document.documentElement.classList.toggle('desktop-mini-player', Boolean(enabled));
});
