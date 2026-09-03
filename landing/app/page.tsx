import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { Features } from './components/Features';
import { OfflineDeepDive } from './components/OfflineDeepDive';
import { Comparison } from './components/Comparison';
import { DownloadSection } from './components/DownloadSection';
import { FAQ } from './components/FAQ';
import { Footer } from './components/Footer';

export const revalidate = 60; // ISR 60 seconds

async function getStats() {
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
    let latestReleaseWithAssets: any = null;

    if (releasesRes.status === 'fulfilled' && releasesRes.value.ok) {
      const releases = await releasesRes.value.json();
      if (Array.isArray(releases)) {
        for (const rel of releases) {
          if (rel.assets && Array.isArray(rel.assets)) {
            for (const asset of rel.assets) {
              totalDownloads += asset.download_count || 0;
            }
          }
        }
        latestReleaseWithAssets = releases.find((r: any) => r.assets && r.assets.length > 0) || releases[0] || null;
        if (releases[0]?.tag_name) {
          latestVersion = releases[0].tag_name;
        }
      }
    }

    let stars = 0;
    if (repoRes.status === 'fulfilled' && repoRes.value.ok) {
      const repo = await repoRes.value.json();
      stars = repo.stargazers_count || 0;
    }

    const assets = latestReleaseWithAssets?.assets || [];
    const findAssetUrl = (predicate: (name: string) => boolean, fallback: string) => {
      const a = assets.find((item: any) => predicate(item.name.toLowerCase()));
      return a ? a.browser_download_url : fallback;
    };

    const targetVersion = latestReleaseWithAssets?.tag_name || latestVersion;
    const baseRepoUrl = `https://github.com/lonestill/listenfold/releases/download/${targetVersion}`;

    const downloads = {
      version: targetVersion,
      macArmDmg: findAssetUrl((n: string) => n.includes('mac-arm64') && n.endsWith('.dmg'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-mac-arm64.dmg`),
      macIntelDmg: findAssetUrl((n: string) => n.includes('mac-x64') && n.endsWith('.dmg'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-mac-x64.dmg`),
      macArmZip: findAssetUrl((n: string) => n.includes('mac-arm64') && n.endsWith('.zip'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-mac-arm64.zip`),
      macIntelZip: findAssetUrl((n: string) => n.includes('mac-x64') && n.endsWith('.zip'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-mac-x64.zip`),
      winExe: findAssetUrl((n: string) => n.includes('win') && n.endsWith('.exe'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-win-x64.exe`),
      linuxAppImage: findAssetUrl((n: string) => n.endsWith('.appimage'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-linux-x86_64.AppImage`),
      linuxDeb: findAssetUrl((n: string) => n.endsWith('.deb'), `${baseRepoUrl}/Listenfold-${targetVersion.replace(/^v/, '')}-linux-amd64.deb`),
    };

    return {
      totalDownloads,
      stars,
      latestVersion,
      downloads,
    };
  } catch {
    return {
      totalDownloads: 0,
      stars: 0,
      latestVersion: 'v0.1.11',
      downloads: {
        version: 'v0.1.11',
        macArmDmg: 'https://github.com/lonestill/listenfold/releases/latest',
        macIntelDmg: 'https://github.com/lonestill/listenfold/releases/latest',
        macArmZip: 'https://github.com/lonestill/listenfold/releases/latest',
        macIntelZip: 'https://github.com/lonestill/listenfold/releases/latest',
        winExe: 'https://github.com/lonestill/listenfold/releases/latest',
        linuxAppImage: 'https://github.com/lonestill/listenfold/releases/latest',
        linuxDeb: 'https://github.com/lonestill/listenfold/releases/latest',
      },
    };
  }
}

export default async function Home() {
  const stats = await getStats();

  return (
    <main className="relative flex-1 flex flex-col bg-[#090a0f]">
      <Navbar stars={stats.stars} latestVersion={stats.latestVersion} />
      <Hero
        totalDownloads={stats.totalDownloads}
        stars={stats.stars}
        latestVersion={stats.latestVersion}
        downloads={stats.downloads}
      />
      <Features />
      <OfflineDeepDive />
      <Comparison />
      <DownloadSection latestVersion={stats.latestVersion} downloads={stats.downloads} />
      <FAQ />
      <Footer />
    </main>
  );
}
