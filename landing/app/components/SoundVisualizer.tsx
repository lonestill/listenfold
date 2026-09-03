'use client';

import React, { useState, useEffect } from 'react';

export const SoundVisualizer: React.FC<{ isPlaying?: boolean }> = ({ isPlaying = true }) => {
  const [bars, setBars] = useState<number[]>([12, 24, 18, 28, 14, 22, 30, 16, 26, 12, 20, 28]);

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setBars(prev => prev.map(() => Math.floor(Math.random() * 22) + 6));
    }, 120);
    return () => clearInterval(interval);
  }, [isPlaying]);

  return (
    <div className="flex items-end gap-[2.5px] h-6 px-2">
      {bars.map((height, i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-full bg-emerald-400 transition-all duration-150 ease-out"
          style={{ height: isPlaying ? `${height}px` : '4px', opacity: 0.85 }}
        />
      ))}
    </div>
  );
};
