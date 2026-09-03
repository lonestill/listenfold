import { NextResponse } from 'next/server';

export const revalidate = 60; // Cache for 60 seconds

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  download_count: number;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  assets: GitHubAsset[];
}

export async function GET() {
  try {
    const [releasesRes, repoRes] = await Promise.allSettled([
      fetch('https://api.github.com/repos/lonestill/listenfold/releases?per_page=100', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Listenfold-Landing',
        },
        next: { revalidate: 60 },
      }),
      fetch('https://api.github.com/repos/lonestill/listenfold', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Listenfold-Landing',
        },
        next: { revalidate: 60 },
      }),
    ]);

    let totalDownloads = 0;
    let latestVersion = 'v0.1.11';
    let latestReleaseWithAssets: GitHubRelease | null = null;

    if (releasesRes.status === 'fulfilled' && releasesRes.value.ok) {
      const releases: GitHubRelease[] = await releasesRes.value.json();

      for (const rel of releases) {
        if (rel.assets && Array.isArray(rel.assets)) {
          for (const asset of rel.assets) {
            totalDownloads += asset.download_count || 0;
          }
        }
      }

      // Find newest release with assets
      latestReleaseWithAssets = releases.find(r => r.assets && r.assets.length > 0) || releases[0] || null;
      if (releases[0]?.tag_name) {
        latestVersion = releases[0].tag_name;
      }
    }

    let stars = 0;
    let forks = 0;
    if (repoRes.status === 'fulfilled' && repoRes.value.ok) {
      const repo = await repoRes.value.json();
      stars = repo.stargazers_count || 0;
      forks = repo.forks_count || 0;
    }

    const assets = latestReleaseWithAssets?.assets || [];
    const findAssetUrl = (predicate: (name: string) => boolean, fallback: string) => {
      const a = assets.find(item => predicate(item.name.toLowerCase()));
      return a ? a.browser_download_url : fallback;
    };

    const targetVersion = latestReleaseWithAssets?.tag_name || latestVersion;
    const baseRepoUrl = `https://github.com/lonestill/listenfold/releases/download/${targetVersion}`;

    const downloads = {
      version: targetVersion,
      macArmDmg: findAssetUrl(n => n.includes('mac-arm64') && n.endsWith('.dmg'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-mac-arm64.dmg`),
      macIntelDmg: findAssetUrl(n => n.includes('mac-x64') && n.endsWith('.dmg'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-mac-x64.dmg`),
      macArmZip: findAssetUrl(n => n.includes('mac-arm64') && n.endsWith('.zip'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-mac-arm64.zip`),
      macIntelZip: findAssetUrl(n => n.includes('mac-x64') && n.endsWith('.zip'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-mac-x64.zip`),
      winExe: findAssetUrl(n => n.includes('win') && n.endsWith('.exe'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-win-x64.exe`),
      linuxAppImage: findAssetUrl(n => n.endsWith('.appimage'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-linux-x86_64.AppImage`),
      linuxDeb: findAssetUrl(n => n.endsWith('.deb'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-linux-amd64.deb`),
    };

    return NextResponse.json({
      ok: true,
      totalDownloads,
      stars,
      forks,
      latestVersion,
      downloads,
    });
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: error.message,
      totalDownloads: 0,
      stars: 0,
      latestVersion: 'v0.1.11',
      downloads: {
        version: 'v0.1.11',
        macArmDmg: 'https://github.com/lonestill/listenfold/releases/latest',
        macIntelDmg: 'https://github.com/lonestill/listenfold/releases/latest',
        winExe: 'https://github.com/lonestill/listenfold/releases/latest',
        linuxAppImage: 'https://github.com/lonestill/listenfold/releases/latest',
        linuxDeb: 'https://github.com/lonestill/listenfold/releases/latest',
      },
    }, { status: 200 });
  }
}
