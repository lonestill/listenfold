'use client';

import React from 'react';
import { HardDrive, WifiOff, Check, ArrowRight } from 'lucide-react';

export const OfflineDeepDive: React.FC = () => {
  return (
    <section id="offline" className="py-20 bg-[#07080c] border-b border-white/[0.08]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Text */}
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono font-medium mb-4">
              <WifiOff className="w-3.5 h-3.5" />
              <span>ОФФЛАЙН 2.0</span>
            </div>

            <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight mb-4">
              Музыка играет даже без интернета. Настоящий оффлайн на ПК.
            </h2>

            <p className="text-sm text-slate-400 leading-relaxed mb-6">
              Веб-версии стримингов требуют постоянного подключения к сети. Listenfold позволяет в один клик сохранить плейлист или альбом на диск компьютера и слушать его где угодно — в самолёте, поезде или при плохом сигнале.
            </p>

            <div className="space-y-3 font-mono text-xs">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-white font-semibold">Хранение на диске</div>
                  <div className="text-slate-400 font-sans text-xs mt-0.5">
                    Файлы сохраняются в <code className="text-emerald-300">.cache/audio</code> с проверкой целостности через манифест.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-white font-semibold">0 мс задержка воспроизведения</div>
                  <div className="text-slate-400 font-sans text-xs mt-0.5">
                    Локальный HTTP Range-стриминг: перемотка и запуск треков происходят мгновенно без буферизации.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-white font-semibold">Пакетная загрузка «Скачать всё»</div>
                  <div className="text-slate-400 font-sans text-xs mt-0.5">
                    Реальный прогресс-бар в шапке, подсчёт загруженных треков и автоматическая простановка статусов.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Screenshot */}
          <div className="lg:col-span-6">
            <div className="rounded-xl bg-[#0e1017] border border-white/10 overflow-hidden shadow-xl">
              <div className="h-8 bg-[#12141d] border-b border-white/[0.06] px-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]"></span>
                  <span className="ml-2 text-xs font-mono text-slate-400">Оффлайн медиатека</span>
                </div>
                <span className="text-[10px] font-mono text-emerald-400">Offline-ready</span>
              </div>

              <img
                src="/screenshots/app-offline.png"
                alt="Оффлайн медиатека в Listenfold"
                className="w-full aspect-[16/10] object-cover object-top"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
