# Listenfold

Desktop player that combines YouTube Music and Yandex Music in one application.

## Features

- Unified search across YouTube Music and Yandex Music
- Deduplication of matching tracks across services
- Radio mode (Wave) based on provider recommendations and moods
- Synchronized lyrics (LRCLIB and Yandex Music)
- Playlist rescue / matching between services
- Queue management, history, equalizer, mini-player mode, tray controls, and media keys

## Development

Requirements:
- Node.js 22+
- npm
- `yt-dlp` in `PATH` (for YouTube playback during development)

```bash
npm ci
npm run dev:web
```

Server runs on `http://127.0.0.1:3000`. To start with the Electron shell:

```bash
npm run dev
```

## Checks

```bash
npm run verify
```

Runs syntax checks (`node --check`) and server smoke tests.

## Packaging

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Release builds download and bundle the pinned official `yt-dlp` standalone binary into `dist/`.

See [CROSSPLATFORM.md](CROSSPLATFORM.md) for target details and release notes.

## Storage

Session state, playback cache, cookies, and local database are stored in the platform application data directory.

