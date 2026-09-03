'use client';

import React from 'react';
import { Check, X, Minus } from 'lucide-react';

export const Comparison: React.FC = () => {
  const criteria = [
    { name: 'Каталог Яндекс.Музыки + YouTube в одном месте', us: true, ym: false, ytm: false, sp: false },
    { name: 'Оффлайн прослушивание без платной подписки', us: true, ym: false, ytm: false, sp: false },
    { name: 'Караоке с точной миллисекундной подгонкой (LRCLIB)', us: true, ym: false, ytm: false, sp: false },
    { name: 'Полное отсутствие рекламы и трекинга', us: true, ym: false, ytm: false, sp: false },
    { name: '100% Открытый исходный код (MIT)', us: true, ym: false, ytm: false, sp: false },
    { name: 'Встроенный Update Manager прямо в приложении', us: true, ym: true, ytm: false, sp: true },
    { name: 'Кроссплатформенность: macOS, Windows, Linux', us: true, ym: false, ytm: false, sp: true },
  ];

  return (
    <section className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Сравнение</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mt-2">
            Зачем платить за ограничения?
          </h2>
          <p className="text-slate-400 text-sm mt-3">
            Сравните возможности Listenfold с официальными клиентами и веб-версиями стримингов.
          </p>
        </div>

        <div className="max-w-4xl mx-auto overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="py-4 px-4 text-sm font-semibold text-slate-400">Возможность</th>
                <th className="py-4 px-4 text-sm font-bold text-emerald-400 text-center bg-emerald-500/10 rounded-t-xl border-t border-x border-emerald-500/20">
                  Listenfold
                </th>
                <th className="py-4 px-4 text-sm font-medium text-slate-400 text-center">Яндекс (Desktop)</th>
                <th className="py-4 px-4 text-sm font-medium text-slate-400 text-center">YouTube Web</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {criteria.map((c, i) => (
                <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-4 px-4 text-sm text-slate-200 font-medium">
                    {c.name}
                  </td>
                  <td className="py-4 px-4 text-center bg-emerald-500/[0.04] border-x border-emerald-500/10">
                    <div className="inline-flex w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 items-center justify-center">
                      <Check className="w-4 h-4 stroke-[3]" />
                    </div>
                  </td>
                  <td className="py-4 px-4 text-center">
                    {c.ym ? (
                      <Check className="w-4 h-4 text-emerald-400 mx-auto" />
                    ) : (
                      <X className="w-4 h-4 text-rose-500/70 mx-auto" />
                    )}
                  </td>
                  <td className="py-4 px-4 text-center">
                    {c.ytm ? (
                      <Check className="w-4 h-4 text-emerald-400 mx-auto" />
                    ) : (
                      <X className="w-4 h-4 text-rose-500/70 mx-auto" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
