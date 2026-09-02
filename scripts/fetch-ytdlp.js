'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const YTDLP_VERSION = process.env.YTDLP_VERSION || '2026.08.19';
const targetPlatform = process.argv[2] || process.platform;
const targetArch = process.argv[3] || process.arch;
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'build', 'bin');

function releaseAsset(platform, arch) {
  if (platform === 'darwin') return { asset: 'yt-dlp_macos', output: 'yt-dlp' };
  if (platform === 'win32' && arch === 'x64') return { asset: 'yt-dlp.exe', output: 'yt-dlp.exe' };
  if (platform === 'linux' && arch === 'x64') return { asset: 'yt-dlp_linux', output: 'yt-dlp' };
  if (platform === 'linux' && arch === 'arm64') return { asset: 'yt-dlp_linux_aarch64', output: 'yt-dlp' };
  throw new Error(`Unsupported yt-dlp target: ${platform}/${arch}`);
}

async function download(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
    headers: { 'User-Agent': 'Listenfold release builder' },
  });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const { asset, output } = releaseAsset(targetPlatform, targetArch);
  const releaseBase = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}`;
  const outputPath = path.join(outputDir, output);
  const metadataPath = path.join(outputDir, '.yt-dlp-version');
  const expectedMetadata = `${YTDLP_VERSION} ${asset}\n`;

  fs.mkdirSync(outputDir, { recursive: true });
  if (
    fs.existsSync(outputPath)
    && fs.existsSync(metadataPath)
    && fs.readFileSync(metadataPath, 'utf8') === expectedMetadata
    && fs.statSync(outputPath).size > 1_000_000
  ) {
    console.log(`yt-dlp ${YTDLP_VERSION} already prepared for ${targetPlatform}/${targetArch}`);
    return;
  }

  const sums = (await download(`${releaseBase}/SHA2-256SUMS`)).toString('utf8');
  const checksumLine = sums.split(/\r?\n/).find(line => {
    const filename = line.trim().split(/\s+/).at(-1)?.replace(/^\*/, '');
    return filename === asset;
  });
  if (!checksumLine) throw new Error(`Checksum for ${asset} not found`);
  const expectedHash = checksumLine.trim().split(/\s+/)[0].toLowerCase();

  const binary = await download(`${releaseBase}/${asset}`);
  const actualHash = crypto.createHash('sha256').update(binary).digest('hex');
  if (actualHash !== expectedHash) throw new Error(`Checksum mismatch for ${asset}`);

  const tempPath = `${outputPath}.download-${process.pid}`;
  fs.writeFileSync(tempPath, binary, { mode: 0o755 });
  if (targetPlatform !== 'win32') fs.chmodSync(tempPath, 0o755);

  for (const staleName of ['yt-dlp', 'yt-dlp.exe']) {
    const stalePath = path.join(outputDir, staleName);
    if (stalePath !== outputPath) fs.rmSync(stalePath, { force: true });
  }
  fs.renameSync(tempPath, outputPath);
  fs.writeFileSync(metadataPath, expectedMetadata, { mode: 0o600 });
  console.log(`Prepared verified ${asset} for ${targetPlatform}/${targetArch}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

