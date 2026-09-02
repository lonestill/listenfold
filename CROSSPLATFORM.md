# Listenfold release guide

## Supported desktop targets

- **macOS 10.15+**: Apple Silicon and Intel, DMG and ZIP.
- **Windows 10/11 x64**: NSIS installer and portable EXE.
- **Linux x64**: AppImage and DEB.
- **Web/PWA**: intended for localhost or a trusted private network. The desktop app remains the primary distribution target.

The application starts its backend on an isolated loopback port. User cookies, playback cache, and imported provider state stay inside the platform application-data directory.

## Local verification

```bash
npm ci
npm run verify
```

`npm run verify` performs syntax checks and starts a disposable server with cookie import disabled. It verifies that the application shell and PWA manifest are served correctly, then removes its temporary data.

## Release builds

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Each command:

1. Downloads the pinned official `yt-dlp` standalone binary for the target platform.
2. Verifies the binary against `SHA2-256SUMS` from the same official release.
3. Runs the full verification suite.
4. Creates installers in `dist/`.

The packaged backend receives the bundled engine path through `YTDLP_PATH`; end users do not need Python, Homebrew, or a system `yt-dlp` installation.

## GitHub Releases

The workflow in `.github/workflows/release.yml` builds all supported targets. A manual run keeps installers as workflow artifacts. Pushing a version tag also creates a GitHub Release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Signing status

Current CI artifacts are unsigned. They are suitable for private testing, but macOS Gatekeeper and Windows SmartScreen may warn on first launch. Public distribution requires Apple Developer ID signing and notarization for macOS plus an Authenticode certificate for Windows.

## Browser authentication

Listenfold imports only supported YouTube and Yandex cookies from a local browser profile and stores the filtered cookie jar with private file permissions. The import order is Chrome, Edge, Brave, Chromium, then Firefox. Existing SonicFlow application data is copied once into the Listenfold data directory during the first desktop launch.

