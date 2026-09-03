'use client';

import React from 'react';
import { Heart } from 'lucide-react';

const GithubIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-white/[0.06] bg-[#090a0c] py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-5">
        <div className="flex items-center gap-2.5">
          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/>
          </svg>
          <span className="font-bold text-white text-sm">Listenfold</span>
          <span className="text-xs text-slate-500 font-mono">v0.1.11</span>
        </div>

        <div className="flex items-center gap-6 text-xs text-slate-400">
          <a href="https://github.com/lonestill/listenfold" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors flex items-center gap-1.5">
            <GithubIcon className="w-4 h-4 text-slate-400" />
            <span>GitHub</span>
          </a>
          <a href="https://github.com/lonestill/listenfold/releases" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
            Релизы
          </a>
          <a href="https://github.com/lonestill/listenfold/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
            MIT License
          </a>
        </div>

        <div className="text-xs text-slate-500 flex items-center gap-1">
          Listenfold Contributors
        </div>
      </div>
    </footer>
  );
};
