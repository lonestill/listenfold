'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Apple, Monitor, Terminal, Download, ChevronDown, Check, Star, HardDrive, ListMusic, Radio, Mic2 } from 'lucide-react';
import { AnimatedCounter } from './AnimatedCounter';
import { SoundVisualizer } from './SoundVisualizer';

interface HeroProps {
  totalDownloads: number;
  stars: number;
  latestVersion: string;
  downloads: {
    version: string;
    macArmDmg: string;
    macIntelDmg: string;
    macArmZip: string;
    macIntelZip: string;
    winExe: string;
    linuxAppImage: string;
    linuxDeb: string;
  };
}

export const Hero: React.FC<HeroProps> = ({ totalDownloads, stars, latestVersion, downloads }) => {
  const [os, setOs] = useState<'mac' | 'windows' | 'linux'>('mac');
  const [isArm, setIsArm] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeScreen, setActiveScreen] = useState<'playlist' | 'wave' | 'offline' | 'karaoke'>('playlist');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ua = window.navigator.userAgent.toLowerCase();
      if (ua.includes('win')) {
        setOs('windows');
      } else if (ua.includes('linux')) {
        setOs('linux');
      } else {
        setOs('mac');
        setIsArm(!ua.includes('intel') || ua.includes('arm') || ua.includes('m1') || ua.includes('m2') || ua.includes('m3'));
      }
    }
  }, []);

  const primaryDownloadUrl = os === 'windows'
    ? downloads.winExe
    : os === 'linux'
    ? downloads.linuxAppImage
    : (isArm ? downloads.macArmDmg : downloads.macIntelDmg);

  const primaryDownloadLabel = os === 'windows'
    ? 'Скачать для Windows (.exe)'
    : os === 'linux'
    ? 'Скачать для Linux (.AppImage)'
    : `Скачать для macOS (${isArm ? 'Apple Silicon' : 'Intel'})`;

  const screens = {
    playlist: {
      title: 'Плейлист и двойной поиск',
      image: '/screenshots/app-playlist.png',
      desc: 'Поиск сразу по двум базам. Треки из Яндекса и редкие видео/ремиксы из YouTube Music в одной таблице.',
    },
    wave: {
      title: 'Моя Волна',
      image: '/screenshots/app-wave.png',
      desc: 'Умный радиопоток с фильтрами по настроению (Бодрое, Спокойное, Сон, Энергия) и переключением бэкенда рекомендаций.',
    },
    offline: {
      title: 'Оффлайн медиатека',
      image: '/screenshots/app-offline.png',
      desc: 'Кнопка «Скачать всё» в каждом плейлисте. Музыка сохраняется локально и играет без интернета с 0 мс задержкой.',
    },
    karaoke: {
      title: 'Караоке Lab',
      image: '/screenshots/app-lyrics.png',
      desc: 'Синхронизированные слова песен от LRCLIB с подсветкой текущей строки и ручной подгонкой задержки таймингов.',
    },
  };

  return (
    <section className="pt-28 pb-16 bg-[#090a0f] border-b border-white/[0.08] bg-subtle-grid relative overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
        {/* Header Block with Motion */}
        <div className="max-w-3xl mb-8">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-slate-300 mb-4"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Версия {latestVersion}</span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400">macOS, Windows, Linux</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-[1.12] mb-5"
          >
            Десктопный плеер для Яндекс Музыки и YouTube Music.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="text-base sm:text-lg text-slate-400 leading-relaxed mb-8"
          >
            Два каталога в одном интерфейсе. Оффлайн-прослушивание со скачиванием на диск в один клик, синхронные караоке-тексты LRCLIB и умная «Моя Волна». 100% бесплатно и без рекламы.
          </motion.p>

          {/* Download CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.24 }}
            className="relative inline-flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto mb-6"
          >
            <div className="inline-flex rounded-xl shadow-lg shadow-black/40">
              <a
                href={primaryDownloadUrl}
                className="flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-l-xl bg-white hover:bg-slate-100 text-black font-semibold text-sm transition-all active:scale-[0.98]"
              >
                {os === 'windows' ? (
                  <Monitor className="w-4 h-4 text-black" />
                ) : os === 'linux' ? (
                  <Terminal className="w-4 h-4 text-black" />
                ) : (
                  <Apple className="w-4 h-4 text-black" />
                )}
                <span>{primaryDownloadLabel}</span>
              </a>

              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="px-3.5 bg-white hover:bg-slate-200 text-black rounded-r-xl border-l border-slate-200 flex items-center justify-center transition-colors"
                title="Другие платформы"
                aria-label="Другие платформы"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>

            <a
              href="https://github.com/lonestill/listenfold"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-sm text-slate-200 font-medium transition-all hover:border-white/20 active:scale-[0.98]"
            >
              <span>Исходный код на GitHub</span>
              {stars > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-400 font-mono">
                  ★ <AnimatedCounter target={stars} />
                </span>
              )}
            </a>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div className="absolute top-full mt-2 left-0 right-0 sm:left-auto sm:right-auto sm:w-80 bg-[#12141d] border border-white/10 rounded-xl shadow-2xl z-50 p-2 text-left">
                <div className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-1.5 border-b border-white/5 mb-1 font-mono">
                  Все сборки ({latestVersion})
                </div>

                <a
                  href={downloads.macArmDmg}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-slate-200 transition-colors"
                  onClick={() => setDropdownOpen(false)}
                >
                  <div className="flex items-center gap-2.5">
                    <Apple className="w-4 h-4 text-white" />
                    <div>
                      <div className="font-semibold text-white">macOS Apple Silicon</div>
                      <div className="text-[11px] text-slate-400">M1, M2, M3, M4 (.dmg)</div>
                    </div>
                  </div>
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                </a>

                <a
                  href={downloads.macIntelDmg}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-slate-200 transition-colors"
                  onClick={() => setDropdownOpen(false)}
                >
                  <div className="flex items-center gap-2.5">
                    <Apple className="w-4 h-4 text-slate-400" />
                    <div>
                      <div className="font-semibold text-white">macOS Intel</div>
                      <div className="text-[11px] text-slate-400">x64 (.dmg)</div>
                    </div>
                  </div>
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                </a>

                <a
                  href={downloads.winExe}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-slate-200 transition-colors"
                  onClick={() => setDropdownOpen(false)}
                >
                  <div className="flex items-center gap-2.5">
                    <Monitor className="w-4 h-4 text-sky-400" />
                    <div>
                      <div className="font-semibold text-white">Windows</div>
                      <div className="text-[11px] text-slate-400">Win 10 / 11 (.exe)</div>
                    </div>
                  </div>
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                </a>

                <a
                  href={downloads.linuxAppImage}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-slate-200 transition-colors"
                  onClick={() => setDropdownOpen(false)}
                >
                  <div className="flex items-center gap-2.5">
                    <Terminal className="w-4 h-4 text-amber-400" />
                    <div>
                      <div className="font-semibold text-white">Linux AppImage</div>
                      <div className="text-[11px] text-slate-400">Портативный запуск (.AppImage)</div>
                    </div>
                  </div>
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                </a>

                <a
                  href={downloads.linuxDeb}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-slate-200 transition-colors"
                  onClick={() => setDropdownOpen(false)}
                >
                  <div className="flex items-center gap-2.5">
                    <Terminal className="w-4 h-4 text-amber-400" />
                    <div>
                      <div className="font-semibold text-white">Linux Debian / Ubuntu</div>
                      <div className="text-[11px] text-slate-400">Пакет (.deb)</div>
                    </div>
                  </div>
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                </a>
              </div>
            )}
          </motion.div>

          {/* Honest Quick Facts */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.32 }}
            className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400 font-mono"
          >
            <span className="flex items-center gap-1.5 text-slate-300">
              <Check className="w-3.5 h-3.5 text-emerald-400" /> Без платной подписки
            </span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <Check className="w-3.5 h-3.5 text-emerald-400" /> 0 мс стриминг с диска
            </span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <Check className="w-3.5 h-3.5 text-emerald-400" /> Без сбора данных
            </span>
            <span className="text-slate-500">
              • <AnimatedCounter target={totalDownloads} /> реальных скачиваний
            </span>
          </motion.div>
        </div>

        {/* =========================================================
            CLEAN APP WINDOW WITH SMOOTH CROSS-DISSOLVE TRANSITIONS
            ========================================================= */}
        <motion.div
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
          id="screens"
          className="mt-12 rounded-2xl bg-[#0e1017] border border-white/10 shadow-2xl overflow-hidden"
        >
          {/* Top Tabs Bar */}
          <div className="bg-[#12141d] border-b border-white/[0.08] px-4 py-2 flex flex-wrap items-center justify-between gap-3">
            {/* macOS window dots + Live Playing Status */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#ff5f57] inline-block"></span>
                <span className="w-3 h-3 rounded-full bg-[#febc2e] inline-block"></span>
                <span className="w-3 h-3 rounded-full bg-[#28c840] inline-block"></span>
              </div>
              <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-slate-400 pl-2 border-l border-white/10">
                <SoundVisualizer isPlaying={true} />
                <span className="text-slate-300 font-medium">Miyagi — 3YN</span>
                <span className="text-emerald-400 text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/20">0ms</span>
              </div>
            </div>

            {/* Screen Switcher with Animated Pill */}
            <div className="flex items-center gap-1 bg-[#090a0f] p-1 rounded-xl border border-white/[0.06]">
              <button
                onClick={() => setActiveScreen('playlist')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeScreen === 'playlist' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                <ListMusic className="w-3.5 h-3.5" />
                <span>Поиск и треки</span>
              </button>

              <button
                onClick={() => setActiveScreen('wave')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeScreen === 'wave' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Radio className="w-3.5 h-3.5 text-rose-400" />
                <span>Моя Волна</span>
              </button>

              <button
                onClick={() => setActiveScreen('offline')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeScreen === 'offline' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                <span>Оффлайн</span>
              </button>

              <button
                onClick={() => setActiveScreen('karaoke')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeScreen === 'karaoke' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Mic2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Караоке</span>
              </button>
            </div>
          </div>

          {/* Animated Screenshot Cross-Dissolve */}
          <div className="relative aspect-[16/10] bg-black overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.img
                key={activeScreen}
                src={screens[activeScreen].image}
                alt={screens[activeScreen].title}
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="w-full h-full object-cover object-top"
              />
            </AnimatePresence>
          </div>

          {/* Caption underneath */}
          <div className="p-4 sm:p-5 bg-[#0e1017] border-t border-white/[0.08] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div>
              <span className="font-semibold text-white mr-2">{screens[activeScreen].title}:</span>
              <span className="text-slate-400">{screens[activeScreen].desc}</span>
            </div>
            <span className="font-mono text-slate-500 shrink-0">Реальный скриншот приложения</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
