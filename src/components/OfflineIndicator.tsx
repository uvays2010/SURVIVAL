import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { GameLang, TRANSLATIONS } from '../i18n';

export const OfflineIndicator: React.FC<{ lang?: GameLang }> = ({ lang = 'uz' }) => {
  const isOnline = useOnlineStatus();
  const t = TRANSLATIONS[lang];

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-stone-950 shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>{t.offlineBanner}</span>
    </div>
  );
};
