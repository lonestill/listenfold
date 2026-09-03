'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Layers, HardDrive, Mic2, Radio, Zap, RefreshCw } from 'lucide-react';

export const Features: React.FC = () => {
  const features = [
    {
      icon: <Layers className="w-5 h-5 text-amber-400" />,
      tag: 'Каталог',
      title: 'Яндекс + YouTube в одном поиске',
      description: 'Больше не нужно держать открытыми две разные вкладки. Слушайте 320 kbps треки из Яндекса и редкие неофициальные ремиксы, лайвы и каверы с YouTube в общем списке.',
    },
    {
      icon: <HardDrive className="w-5 h-5 text-emerald-400" />,
      tag: 'Оффлайн',
      title: 'Реальное скачивание на диск',
      description: 'Кнопка «Скачать всё» в шапке любого альбома сохраняет файлы в локальный кэш (.cache/audio). При отсутствии интернета плеер мгновенно стримит аудио с SSD без задержки.',
    },
    {
      icon: <Mic2 className="w-5 h-5 text-cyan-400" />,
      tag: 'Тексты',
      title: 'Караоке через LRCLIB',
      description: 'Синхронизированные субтитры с подсветкой строки в реальном времени. Если тайминги немного отстают, оффсет задержки можно откалибровать стрелками прямо во время трека.',
    },
    {
      icon: <Radio className="w-5 h-5 text-rose-400" />,
      tag: 'Рекомендации',
      title: 'Моя Волна под настроение',
      description: 'Бесконечный радиопоток с фильтрами: «Хорошее настроение», «Энергия», «Сон», «Отдых». Источник рекомендаций можно переключать между Яндексом и YouTube Music.',
    },
    {
      icon: <Zap className="w-5 h-5 text-yellow-400" />,
      tag: 'Кэш и скорость',
      title: 'Переключение версий за 0 мс',
      description: 'У каждого трека доступен быстрый выбор альтернативных версий: Original, Remix, Live, Acoustic. Предзагрузка следующих треков очереди в фоне исключает паузы при воспроизведении.',
    },
    {
      icon: <RefreshCw className="w-5 h-5 text-indigo-400" />,
      tag: 'Обновления',
      title: 'Встроенный менеджер обновлений',
      description: 'Плеер сам опрашивает GitHub Releases API и показывает уведомление, когда выходит новая версия. Обновление ставится в один клик без переустановки руками.',
    },
  ];

  return (
    <section id="features" className="py-20 bg-[#090a0f] border-b border-white/[0.08]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="max-w-3xl mb-12">
          <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">
            Возможности
          </span>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white mt-1 tracking-tight">
            Собрано для тех, кто слушает много музыки
          </h2>
          <p className="text-sm text-slate-400 mt-2">
            Никаких ограничений веб-версий, рекламных баннеров и навязанных платных функций.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <motion.div
              key={i}
              whileHover={{ y: -3 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="p-6 rounded-xl bg-[#0e1017] border border-white/[0.06] hover:border-white/[0.14] transition-colors"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                  {f.icon}
                </div>
                <span className="text-[10.5px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/5">
                  {f.tag}
                </span>
              </div>

              <h3 className="text-base font-bold text-white mb-2">
                {f.title}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {f.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
