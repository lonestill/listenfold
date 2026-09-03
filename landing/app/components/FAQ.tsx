'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

export const FAQ: React.FC = () => {
  const faqs = [
    {
      q: 'Нужна ли платная подписка Яндекс.Плюс или YouTube Premium?',
      a: 'Нет! Listenfold воспроизводит треки и позволяет сохранять их оффлайн бесплатно. Если вы авторизуетесь под своим аккаунтом Яндекса или Google, плеер просто подгрузит ваши личные плейлисты и лайки.',
    },
    {
      q: 'Как работает оффлайн-прослушивание?',
      a: 'При нажатии на кнопку скачивания плеер загружает аудиофайл в локальный кэш вашего компьютера (.cache/audio). При повторном воспроизведении или при отключении от сети файл стримится напрямую с вашего диска без интернет-запросов.',
    },
    {
      q: 'Mac выдаёт ошибку «Приложение повреждено». Как решить?',
      a: 'Это штатная защита Apple Gatekeeper для опенсорс-программ без коммерческого сертификата Apple ($99/год). Чтобы запустить, выполните команду в Терминале: xattr -cr /Applications/listenfold.app, либо откройте через правый клик → «Открыть».',
    },
    {
      q: 'Безопасен ли Listenfold для моих аккаунтов?',
      a: 'Да. Весь код на 100% открыт на GitHub (лицензия MIT). Плеер работает локально, не передаёт пароли или куки на сторонние сервера и не содержит трекеров рекламы.',
    },
    {
      q: 'Как обновлять плеер?',
      a: 'Внутри приложения есть встроенный Update Manager. При выходе нового релиза плеер покажет уведомление в настройках и обновится в 1 клик.',
    },
  ];

  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section id="faq" className="py-20 bg-[#090a0f] border-b border-white/[0.08]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">
            Вопросы и ответы
          </span>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white mt-1 tracking-tight">
            Часто задаваемые вопросы
          </h2>
        </div>

        <div className="space-y-2.5">
          {faqs.map((faq, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div
                key={idx}
                className="rounded-xl bg-[#0e1017] border border-white/[0.06] overflow-hidden transition-colors"
              >
                <button
                  onClick={() => setOpenIdx(isOpen ? null : idx)}
                  className="w-full p-4 sm:p-5 text-left flex items-center justify-between gap-4 font-semibold text-white text-sm hover:text-slate-200 transition-colors"
                >
                  <span>{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-white' : ''}`} />
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 sm:px-5 pb-5 text-xs sm:text-sm text-slate-400 leading-relaxed border-t border-white/[0.04] pt-3">
                        {faq.a}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
