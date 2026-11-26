import React, { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { GameLang, TRANSLATIONS } from '../i18n';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'hero';
  lang?: GameLang;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'compact', lang = 'uz' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const t = TRANSLATIONS[lang];

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  };

  const buttonClasses =
    variant === 'hero'
      ? 'flex items-center justify-center gap-2 px-5 py-3 rounded-lg border border-white/20 bg-[#151c25]/90 hover:bg-[#1e2734] text-stone-100 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0'
      : 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-white/15 bg-[#0d1117]/86 text-stone-200 hover:bg-[#171e28] transition-colors cursor-pointer whitespace-nowrap shrink-0';

  const label = isInstallable ? t.installApp : isIOS ? t.installIOS : t.installApp;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={label}
        className={buttonClasses}
      >
        {isIOS ? <Smartphone className="w-3.5 h-3.5 text-amber-400" /> : <Download className="w-3.5 h-3.5 text-amber-400" />}
        <span className={variant === 'compact' ? 'hidden sm:inline' : ''}>{label}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
        >
          <div className="w-full max-w-sm rounded-xl border border-white/15 bg-[#12171e] p-6 text-stone-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <img
                  src="/pwa-192x192.png"
                  alt={t.gameTitle}
                  className="w-11 h-11 rounded-xl border border-white/15 shrink-0"
                />
                <div>
                  <h3 id="pwa-install-title" className="font-display text-lg tracking-wide text-stone-100">
                    {isIOS ? t.installModalTitleIOS : t.installModalTitle}
                  </h3>
                  <p className="text-xs text-stone-400">{t.installModalSubtitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label={t.closeLabel}
                className="p-1.5 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="mt-4 space-y-2.5 text-sm text-stone-300">
                <li className="flex items-start gap-2.5">
                  <span className="font-mono-num text-amber-400 font-semibold">1.</span>
                  <span>
                    {t.installStep1IOS}{' '}
                    <strong className="text-white inline-flex items-center gap-1">
                      <Share className="w-3.5 h-3.5 inline" /> {t.installStep1IOSBold}
                    </strong>{' '}
                    {t.installStep1IOSRest}
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono-num text-amber-400 font-semibold">2.</span>
                  <span>
                    {t.installStep2IOS} <strong className="text-white">{t.installStep2IOSBold1}</strong>
                    {t.installStep2IOSMid} <strong className="text-white">{t.installStep2IOSBold2}</strong>.
                  </span>
                </li>
              </ol>
            ) : (
              <ol className="mt-4 space-y-2.5 text-sm text-stone-300">
                <li className="flex items-start gap-2.5">
                  <span className="font-mono-num text-amber-400 font-semibold">1.</span>
                  <span>{t.installStep1Desktop}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono-num text-amber-400 font-semibold">2.</span>
                  <span>
                    {t.installStep2Desktop} <strong className="text-white">{t.installStep2DesktopBold1}</strong>{' '}
                    {t.installStep2DesktopMid} <strong className="text-white">{t.installStep2DesktopBold2}</strong>.
                  </span>
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full rounded-lg bg-amber-500 hover:bg-amber-400 py-2.5 text-sm font-semibold text-stone-950 transition-colors cursor-pointer"
            >
              {t.gotIt}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
