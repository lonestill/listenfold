'use client';

import React, { useState, useEffect } from 'react';
import { Apple, Monitor, Terminal, Download, Copy, Check, Info, ArrowRight } from 'lucide-react';

interface DownloadSectionProps {
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

export const DownloadSection: React.FC<DownloadSectionProps> = ({ latestVersion, downloads }) => {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [userOs, setUserOs] = useState<'mac' | 'windows' | 'linux'>('mac');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ua = window.navigator.userAgent.toLowerCase();
      if (ua.includes('win')) {
        setUserOs('windows');
      } else if (ua.includes('linux')) {
        setUserOs('linux');
      } else {
        setUserOs('mac');
      }
    }
  }, []);

  const copyMacCommand = () => {
    navigator.clipboard.writeText('xattr -cr /Applications/listenfold.app');
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <section id="download" className="py-20 bg-[#07080c] border-b border-white/[0.08]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="max-w-3xl mb-12">
          <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">
            Загрузка
          </span>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white mt-1 tracking-tight">
            Выберите вашу платформу
          </h2>
          <p className="text-sm text-slate-400 mt-2">
            Текущий стабильный релиз: <span className="text-white font-mono font-semibold">{latestVersion}</span>. Все файлы проверены и собираются автоматически через GitHub Actions.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* ================= macOS CARD ================= */}
          <div className={`p-6 rounded-2xl bg-[#0e1017] border flex flex-col justify-between transition-all ${
            userOs === 'mac' ? 'border-white/30 shadow-xl shadow-black/60 ring-1 ring-white/20' : 'border-white/[0.08]'
          }`}>
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white">
                  <Apple className="w-5 h-5" />
                </div>
                {userOs === 'mac' ? (
                  <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold flex items-center gap-1">
                    <Check className="w-3 h-3 stroke-[3]" /> Ваша ОС
                  </span>
                ) : (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/5">
                    macOS 11+
                  </span>
                )}
              </div>

              <h3 className="text-lg font-bold text-white mb-1">macOS</h3>
              <p className="text-xs text-slate-400 mb-6">
                Для всех моделей Mac на Apple Silicon (M1/M2/M3/M4) и процессорах Intel.
              </p>

              {/* Big, Unmistakable Download Buttons */}
              <div className="space-y-2.5 mb-6">
                <a
                  href={downloads.macArmDmg}
                  className="flex items-center justify-between p-3.5 rounded-xl bg-white hover:bg-slate-100 text-black font-bold text-xs shadow-md transition-all group active:scale-[0.98]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-black/10 flex items-center justify-center shrink-0">
                      <Download className="w-4 h-4 text-black" />
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-bold text-black leading-tight">Скачать .dmg (Apple Silicon)</div>
                      <div className="text-[10.5px] text-slate-600 font-normal">Для процессоров M1, M2, M3, M4</div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600 group-hover:translate-x-0.5 transition-transform" />
                </a>

                <a
                  href={downloads.macIntelDmg}
                  className="flex items-center justify-between p-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] text-white text-xs font-medium transition-all group active:scale-[0.98]"
                >
                  <div className="flex items-center gap-2.5">
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                    <div className="text-left">
                      <div className="text-xs font-semibold text-white leading-tight">Скачать .dmg (Intel)</div>
                      <div className="text-[10px] text-slate-400">Для Mac на процессорах Intel x64</div>
                    </div>
                  </div>
                  <span className="text-[10.5px] font-mono text-slate-500">x64</span>
                </a>
              </div>
            </div>

            {/* Mac Fix Helper */}
            <div className="p-3 rounded-xl bg-black/50 border border-white/[0.06] text-[11px] text-slate-400">
              <div className="flex items-center justify-between text-slate-300 font-medium mb-1">
                <span className="flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-amber-400" />
                  Если Mac блокирует запуск:
                </span>
                <button
                  onClick={copyMacCommand}
                  className="text-white hover:underline flex items-center gap-1 font-mono text-[10px]"
                >
                  {copiedCmd ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCmd ? 'Готово!' : 'Копировать'}</span>
                </button>
              </div>
              <code className="block bg-[#090a0f] p-1.5 rounded font-mono text-[10px] text-slate-300 select-all border border-white/5">
                xattr -cr /Applications/listenfold.app
              </code>
            </div>
          </div>

          {/* ================= WINDOWS CARD ================= */}
          <div className={`p-6 rounded-2xl bg-[#0e1017] border flex flex-col justify-between transition-all ${
            userOs === 'windows' ? 'border-white/30 shadow-xl shadow-black/60 ring-1 ring-white/20' : 'border-white/[0.08]'
          }`}>
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-sky-400">
                  <Monitor className="w-5 h-5" />
                </div>
                {userOs === 'windows' ? (
                  <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold flex items-center gap-1">
                    <Check className="w-3 h-3 stroke-[3]" /> Ваша ОС
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/5">
                    Windows 10 / 11
                  </span>
                )}
              </div>

              <h3 className="text-lg font-bold text-white mb-1">Windows</h3>
              <p className="text-xs text-slate-400 mb-6">
                Автоматический установщик с ярлыком на рабочем столе и меню «Пуск».
              </p>

              {/* Big, Unmistakable Download Button */}
              <div className="space-y-2.5 mb-6">
                <a
                  href={downloads.winExe}
                  className="flex items-center justify-between p-3.5 rounded-xl bg-white hover:bg-slate-100 text-black font-bold text-xs shadow-md transition-all group active:scale-[0.98]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-black/10 flex items-center justify-center shrink-0">
                      <Download className="w-4 h-4 text-black" />
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-bold text-black leading-tight">Скачать .exe установщик</div>
                      <div className="text-[10.5px] text-slate-600 font-normal">Для Windows 10 / 11 (64-bit)</div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600 group-hover:translate-x-0.5 transition-transform" />
                </a>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-black/50 border border-white/[0.06] text-[11px] text-slate-400">
              <span className="text-slate-300 font-medium block mb-1">Предупреждение SmartScreen:</span>
              Если Windows покажет синее окно, нажмите <span className="text-white">«Подробнее» → «Выполнить в любом случае»</span>.
            </div>
          </div>

          {/* ================= LINUX CARD ================= */}
          <div className={`p-6 rounded-2xl bg-[#0e1017] border flex flex-col justify-between transition-all ${
            userOs === 'linux' ? 'border-white/30 shadow-xl shadow-black/60 ring-1 ring-white/20' : 'border-white/[0.08]'
          }`}>
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-amber-400">
                  <Terminal className="w-5 h-5" />
                </div>
                {userOs === 'linux' ? (
                  <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold flex items-center gap-1">
                    <Check className="w-3 h-3 stroke-[3]" /> Ваша ОС
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/5">
                    Все дистрибутивы
                  </span>
                )}
              </div>

              <h3 className="text-lg font-bold text-white mb-1">Linux</h3>
              <p className="text-xs text-slate-400 mb-6">
                Портативный запуск без установки либо нативный .deb пакет.
              </p>

              {/* Big, Unmistakable Download Buttons */}
              <div className="space-y-2.5 mb-6">
                <a
                  href={downloads.linuxAppImage}
                  className="flex items-center justify-between p-3.5 rounded-xl bg-white hover:bg-slate-100 text-black font-bold text-xs shadow-md transition-all group active:scale-[0.98]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-black/10 flex items-center justify-center shrink-0">
                      <Download className="w-4 h-4 text-black" />
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-bold text-black leading-tight">Скачать .AppImage</div>
                      <div className="text-[10.5px] text-slate-600 font-normal">Портативный (любой Linux)</div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600 group-hover:translate-x-0.5 transition-transform" />
                </a>

                <a
                  href={downloads.linuxDeb}
                  className="flex items-center justify-between p-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] text-white text-xs font-medium transition-all group active:scale-[0.98]"
                >
                  <div className="flex items-center gap-2.5">
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                    <div className="text-left">
                      <div className="text-xs font-semibold text-white leading-tight">Скачать .deb пакет</div>
                      <div className="text-[10px] text-slate-400">Для Ubuntu, Debian, Mint</div>
                    </div>
                  </div>
                  <span className="text-[10.5px] font-mono text-slate-500">amd64</span>
                </a>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-black/50 border border-white/[0.06] text-[11px] text-slate-400">
              <span className="text-slate-300 font-medium block mb-1">Команда запуска AppImage:</span>
              <code className="block bg-[#090a0f] p-1.5 rounded font-mono text-[10px] text-slate-300 border border-white/5">
                chmod +x Listenfold*.AppImage && ./Listenfold*.AppImage
              </code>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
