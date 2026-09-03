'use client';

import React from 'react';
import { Download, Star } from 'lucide-react';

const GithubIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

interface NavbarProps {
  stars: number;
  latestVersion: string;
}

export const Navbar: React.FC<NavbarProps> = ({ stars, latestVersion }) => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-[#090a0f]/90 backdrop-blur-md border-b border-white/[0.08]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-full flex items-center justify-between">
        {/* Brand */}
        <a href="#" className="flex items-center gap-2.5 group">
          <svg className="w-5 h-5 text-white group-hover:scale-105 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/>
          </svg>
          <span className="font-bold text-sm text-white tracking-tight">Listenfold</span>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-slate-400 border border-white/[0.08]">
            {latestVersion}
          </span>
        </a>

        {/* Nav Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs text-slate-400 font-medium">
          <a href="#screens" className="hover:text-white transition-colors">Скриншоты</a>
          <a href="#features" className="hover:text-white transition-colors">Что умеет</a>
          <a href="#offline" className="hover:text-white transition-colors flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            Оффлайн
          </a>
          <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
        </nav>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <a
            href="https://github.com/lonestill/listenfold"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-medium text-slate-300 transition-colors"
          >
            <GithubIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">GitHub</span>
            {stars > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-amber-400 pl-1.5 border-l border-white/10 font-mono">
                <Star className="w-3 h-3 fill-amber-400" />
                {stars}
              </span>
            )}
          </a>

          <a
            href="#download"
            className="flex items-center gap-1.5 px-3.5 h-8 rounded-lg bg-white hover:bg-slate-100 text-black font-semibold text-xs transition-all shadow-sm"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Скачать</span>
          </a>
        </div>
      </div>
    </header>
  );
};
