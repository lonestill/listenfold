import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: "Listenfold — Музыка из Яндекса и YouTube в одном потоке",
  description: "Бесплатный десктопный плеер нового поколения. Объединяет Яндекс.Музыку и YouTube Music, поддерживает скачивание треков оффлайн, умную Мою Волну и синхронное караоке LRCLIB.",
  keywords: ["music player", "yandex music", "youtube music", "desktop player", "offline music", "karaoke", "listenfold", "плеер", "яндекс музыка", "оффлайн музыка"],
  authors: [{ name: "lonestill", url: "https://github.com/lonestill" }],
  openGraph: {
    title: "Listenfold — Плеер для Яндекс.Музыки и YouTube Music",
    description: "Два музыкальных мира в одном красивом десктопном приложении. Без рекламы, 100% бесплатно, с оффлайн-режимом.",
    url: "https://listenfold.lonestill.uk",
    siteName: "Listenfold",
    locale: "ru_RU",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Listenfold — Плеер для Яндекс.Музыки и YouTube Music",
    description: "Слушайте треки из двух сервисов в одном интерфейсе с оффлайн-режимом и караоке.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="dark scroll-smooth">
      <body className={`${inter.className} bg-[#090a0f] text-slate-100 min-h-screen selection:bg-emerald-500/30 selection:text-emerald-300 antialiased`}>
        {children}
      </body>
    </html>
  );
}
