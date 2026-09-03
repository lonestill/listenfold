'use strict';

const { Menu } = require('electron');

function playbackItems(sendMediaCommand) {
  return [
    {
      label: 'Воспроизведение / пауза',
      click: () => sendMediaCommand('play-pause'),
    },
    {
      label: 'Следующий трек',
      click: () => sendMediaCommand('next'),
    },
    {
      label: 'Предыдущий трек',
      click: () => sendMediaCommand('previous'),
    },
  ];
}

function installApplicationMenu(options) {
  const {
    appName,
    isMiniPlayer,
    quit,
    sendMediaCommand,
    showWindow,
    toggleMiniPlayer,
  } = options;

  const template = [];

  if (process.platform === 'darwin') {
    template.push({
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: `Выйти из ${appName}`, accelerator: 'Command+Q', click: quit },
      ],
    });
  } else {
    template.push({
      label: 'Файл',
      submenu: [
        {
          label: 'Показать / Скрыть',
          accelerator: 'CommandOrControl+0',
          click: toggleWindow,
        },
        {
          label: 'Компактный плеер',
          type: 'checkbox',
          checked: isMiniPlayer(),
          accelerator: 'CommandOrControl+Shift+M',
          click: toggleMiniPlayer,
        },
        { type: 'separator' },
        { label: `Выйти из ${appName}`, accelerator: 'Alt+F4', click: quit },
      ],
    });
  }

  template.push(
    {
      label: 'Правка',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Воспроизведение',
      submenu: playbackItems(sendMediaCommand),
    },
    {
      label: 'Окно',
      submenu: [
        { label: 'Показать Listenfold', accelerator: 'CommandOrControl+0', click: showWindow },
        {
          label: 'Компактный плеер поверх окон',
          type: 'checkbox',
          checked: isMiniPlayer(),
          accelerator: 'CommandOrControl+Shift+M',
          click: toggleMiniPlayer,
        },
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [{ type: 'separator' }, { role: 'front' }] : []),
      ],
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'Проверить обновления...',
          click: () => {
            showWindow();
            sendMediaCommand('check-updates');
          },
        },
        { type: 'separator' },
        {
          label: 'Релизы на GitHub',
          click: () => {
            const { shell } = require('electron');
            shell.openExternal('https://github.com/lonestill/listenfold/releases');
          },
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTrayMenu(options) {
  const {
    isMiniPlayer,
    isWindowVisible,
    quit,
    sendMediaCommand,
    showWindow,
    toggleMiniPlayer,
    toggleWindow,
  } = options;

  return Menu.buildFromTemplate([
    {
      label: isWindowVisible() ? 'Скрыть Listenfold' : 'Показать Listenfold',
      click: toggleWindow,
    },
    { type: 'separator' },
    ...playbackItems(sendMediaCommand),
    { type: 'separator' },
    {
      label: 'Компактный плеер поверх окон',
      type: 'checkbox',
      checked: isMiniPlayer(),
      click: toggleMiniPlayer,
    },
    { label: 'Открыть полное окно', click: showWindow },
    { type: 'separator' },
    { label: 'Выйти', click: quit },
  ]);
}

module.exports = {
  createTrayMenu,
  installApplicationMenu,
};
