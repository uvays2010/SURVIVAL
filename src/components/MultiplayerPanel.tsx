import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Cloud,
  Copy,
  ExternalLink,
  LogIn,
  LogOut,
  MapPin,
  Send,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { FIREBASE_PROJECT_ID } from '../firebase';
import {
  buildShareableRoomUrl,
  ConnectionStatus,
  MultiplayerChatMessage,
  PLAYER_PALETTE,
  RemotePlayerState,
  SyncTransport,
} from '../game/multiplayer';
import { WorldMapId } from '../game/types';
import { GameLang, TRANSLATIONS } from '../i18n';

interface MultiplayerPanelProps {
  visible: boolean;
  isOpen: boolean;
  onClose: () => void;
  status: ConnectionStatus;
  transport: SyncTransport;
  authUser: { uid: string; displayName: string | null } | null;
  roomId: string;
  selfId: string | null;
  playerName: string;
  activeMapId: WorldMapId;
  remotePlayers: RemotePlayerState[];
  messages: MultiplayerChatMessage[];
  lang: GameLang;
  onChangeName: (name: string) => void;
  onJoinRoom: (roomId: string) => void;
  onGoToPlayer: (player: RemotePlayerState) => void;
  onSendChat: (text: string) => void;
  onSignInCloud: () => Promise<void>;
  onSignOutCloud: () => Promise<void>;
}

export const MultiplayerPanel: React.FC<MultiplayerPanelProps> = ({
  visible,
  isOpen,
  onClose,
  status,
  transport,
  authUser,
  roomId,
  playerName,
  activeMapId,
  remotePlayers,
  messages,
  lang,
  onChangeName,
  onJoinRoom,
  onGoToPlayer,
  onSendChat,
  onSignInCloud,
  onSignOutCloud,
}) => {
  const t = TRANSLATIONS[lang];
  const [nameInput, setNameInput] = useState(playerName);
  const [roomInput, setRoomInput] = useState(roomId);
  const [chatInput, setChatInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [showInviteUrl, setShowInviteUrl] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [unauthorizedDomain, setUnauthorizedDomain] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const shareUrl = buildShareableRoomUrl(roomId);
  const firebaseAuthConsoleUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/settings`;

  useEffect(() => {
    setNameInput(playerName);
  }, [playerName]);

  useEffect(() => {
    setRoomInput(roomId);
  }, [roomId]);

  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages.length]);

  if (!visible || !isOpen) return null;

  const statusText =
    status === 'connected'
      ? t.multiplayer.connected
      : status === 'reconnecting'
      ? t.multiplayer.reconnecting
      : status === 'disconnected'
      ? t.multiplayer.disconnected
      : t.multiplayer.connecting;

  const handleCopyInvite = async () => {
    setShowInviteUrl(true);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback read-only link box stays visible for manual copy
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setUnauthorizedDomain(null);
    setAuthBusy(true);
    try {
      await onSignInCloud();
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code ?? '')
          : '';
      if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setUnauthorizedDomain(host);
        setAuthError(`${t.multiplayer.authDomainTitle} (${code})`);
      } else if (code === 'auth/popup-blocked') {
        setAuthError(t.multiplayer.authPopupBlocked);
      } else {
        setAuthError(code ? `${t.multiplayer.authError} (${code})` : t.multiplayer.authError);
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCopyDomain = async () => {
    if (!unauthorizedDomain) return;
    try {
      await navigator.clipboard.writeText(unauthorizedDomain);
      setCopiedDomain(true);
      window.setTimeout(() => setCopiedDomain(false), 1800);
    } catch {
      // Selectable input remains available
    }
  };

  const handleGoogleSignOut = async () => {
    setAuthBusy(true);
    try {
      await onSignOutCloud();
    } finally {
      setAuthBusy(false);
    }
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim()) {
      onChangeName(nameInput.trim());
    }
  };

  const handleRoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomInput.trim()) {
      onJoinRoom(roomInput.trim());
    }
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput);
    setChatInput('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={t.multiplayer.title}
    >
      <div
        className="w-full max-w-2xl max-h-[92%] overflow-y-auto rounded-xl border border-white/15 bg-[#0d1218] text-stone-100 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 bg-[#111720]">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <Users className="w-4 h-4 text-amber-400 shrink-0" />
            <h2 className="font-display text-sm sm:text-base font-semibold tracking-wide truncate">
              {t.multiplayer.title}
            </h2>
            <span className="text-stone-500">·</span>
            <span
              className={`flex items-center gap-1 text-xs font-medium whitespace-nowrap ${
                status === 'connected' ? 'text-emerald-400' : 'text-amber-300'
              }`}
            >
              {status === 'connected' ? (
                <Wifi className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{statusText}</span>
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${
                transport === 'cloud'
                  ? 'bg-emerald-500/18 text-emerald-300 border border-emerald-400/30'
                  : 'bg-white/8 text-stone-300 border border-white/12'
              }`}
            >
              <Cloud className="w-3 h-3 shrink-0" />
              <span>{transport === 'cloud' ? t.multiplayer.cloudConnected : t.multiplayer.localMode}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {authUser && (
              <button
                type="button"
                disabled={authBusy}
                onClick={handleGoogleSignOut}
                title={t.multiplayer.signOut}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#1a222d] hover:bg-[#243040] text-[11px] text-stone-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t.multiplayer.signOut}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t.map.closeMap}
              className="p-1.5 rounded-lg bg-[#1a222d] text-stone-300 hover:text-white hover:bg-[#243040] transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-4">
          {/* Cloud Sync / Google Sign-In Callout when not signed into Firebase yet */}
          {!authUser && (
            <div className="flex flex-col gap-2.5 rounded-lg bg-amber-500/12 border border-amber-400/35 p-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-xs sm:text-sm font-semibold text-amber-300">
                    {t.multiplayer.cloudBannerTitle}
                  </span>
                  <span className="text-[11px] sm:text-xs text-stone-300 leading-snug">
                    {t.multiplayer.cloudBannerDesc}
                  </span>
                  {authError && !unauthorizedDomain && (
                    <span className="text-[11px] text-rose-300 mt-1">{authError}</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={handleGoogleSignIn}
                  className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-semibold text-stone-950 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>{t.multiplayer.connectGoogle}</span>
                </button>
              </div>

              {unauthorizedDomain && (
                <div className="rounded-lg bg-[#0b1016] border border-rose-400/35 p-2.5 flex flex-col gap-2">
                  <div className="text-xs font-semibold text-rose-300">
                    {t.multiplayer.authDomainTitle}
                  </div>
                  <div className="text-[11px] text-stone-300 leading-relaxed">
                    {t.multiplayer.authDomainDesc}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={unauthorizedDomain}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 min-w-[160px] px-2.5 py-1.5 rounded bg-[#141b24] border border-white/15 text-xs font-mono-num text-amber-300 select-all focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCopyDomain}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#1d2734] hover:bg-[#283547] text-xs font-medium text-stone-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {copiedDomain ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-300">{t.multiplayer.copied}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>{t.multiplayer.copyDomain}</span>
                        </>
                      )}
                    </button>
                    <a
                      href={firebaseAuthConsoleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/35 text-xs font-medium text-amber-300 transition-colors whitespace-nowrap shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>{t.multiplayer.openFirebaseAuth}</span>
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Identity & Room Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <form onSubmit={handleNameSubmit} className="flex flex-col gap-1.5">
              <label className="text-xs text-stone-400 font-medium">{t.multiplayer.yourName}</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  maxLength={18}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-[#141b24] border border-white/12 text-xs sm:text-sm text-white focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-[#1d2734] hover:bg-[#283547] text-xs font-medium text-stone-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {t.multiplayer.saveName}
                </button>
              </div>
            </form>

            <form onSubmit={handleRoomSubmit} className="flex flex-col gap-1.5">
              <label className="text-xs text-stone-400 font-medium">{t.multiplayer.roomCode}</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  maxLength={20}
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-[#141b24] border border-white/12 text-xs sm:text-sm text-white font-mono-num focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-semibold text-stone-950 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {t.multiplayer.joinRoom}
                </button>
                <button
                  type="button"
                  onClick={handleCopyInvite}
                  title={t.multiplayer.copyInvite}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1d2734] hover:bg-[#283547] text-xs font-medium text-stone-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300 hidden sm:inline">{t.multiplayer.copied}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{t.multiplayer.copyInvite}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {showInviteUrl && (
            <div className="flex flex-col gap-1 rounded-lg bg-[#0a0e13] border border-white/10 p-2.5">
              <input
                type="text"
                readOnly
                value={shareUrl}
                onFocus={(e) => e.target.select()}
                className="w-full px-2.5 py-1.5 rounded bg-[#141b24] border border-white/12 text-xs font-mono-num text-amber-300 select-all focus:outline-none"
              />
              <span className="text-[11px] text-stone-400">{t.multiplayer.inviteHint}</span>
            </div>
          )}

          {/* Connected Players + Room Chat */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-white/10 pt-3">
            {/* Players List */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-stone-400 font-medium">
                <span>{t.multiplayer.playersInRoom}</span>
                <span className="font-mono-num text-amber-300">{remotePlayers.length + 1}</span>
              </div>

              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                {/* Local player entry */}
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#141b24] border border-white/10">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-white shrink-0" />
                    <span className="text-xs sm:text-sm font-medium text-white truncate">
                      {playerName}
                    </span>
                    <span className="text-[11px] text-amber-400 font-medium shrink-0">
                      ({t.multiplayer.youBadge})
                    </span>
                  </div>
                  <span className="text-[11px] text-stone-400 truncate max-w-[120px]">
                    {t.worldMaps[activeMapId].name}
                  </span>
                </div>

                {remotePlayers.length === 0 ? (
                  <p className="text-xs text-stone-400 leading-relaxed py-2 px-1">
                    {t.multiplayer.onlyYou}
                  </p>
                ) : (
                  remotePlayers.map((rp) => {
                    const colorCss =
                      PLAYER_PALETTE[((rp.colorIdx % PLAYER_PALETTE.length) + PLAYER_PALETTE.length) % PLAYER_PALETTE.length];
                    const mapMeta = t.worldMaps[rp.mapId] ?? t.worldMaps.lost_valley;
                    return (
                      <div
                        key={rp.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#141b24] border border-white/10"
                      >
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: colorCss }}
                            />
                            <span className="text-xs sm:text-sm font-medium text-stone-100 truncate">
                              {rp.name}
                            </span>
                          </div>
                          <span className="text-[11px] text-stone-400 truncate pl-4">
                            {mapMeta.name}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => onGoToPlayer(rp)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/18 hover:bg-amber-500/30 text-amber-300 border border-amber-400/30 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <MapPin className="w-3 h-3" />
                          <span>{t.multiplayer.goToPlayer}</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Room Chat */}
            <div className="flex flex-col gap-2">
              <div className="text-xs text-stone-400 font-medium">{t.multiplayer.chatTitle}</div>
              <div className="flex-1 min-h-[140px] max-h-48 overflow-y-auto rounded-lg bg-[#0a0e13] border border-white/10 p-2.5 flex flex-col gap-1.5">
                {messages.length === 0 ? (
                  <div className="text-xs text-stone-500 my-auto text-center">
                    {t.multiplayer.noMessages}
                  </div>
                ) : (
                  messages.map((m) => {
                    const colorCss =
                      PLAYER_PALETTE[((m.colorIdx % PLAYER_PALETTE.length) + PLAYER_PALETTE.length) % PLAYER_PALETTE.length];
                    return (
                      <div key={m.id} className="text-xs leading-snug break-words">
                        <span className="font-semibold" style={{ color: colorCss }}>
                          {m.name}:{' '}
                        </span>
                        <span className="text-stone-200">{m.text}</span>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={handleChatSubmit} className="flex items-center gap-1.5">
                <input
                  type="text"
                  maxLength={140}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={t.multiplayer.chatPlaceholder}
                  className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-[#141b24] border border-white/12 text-xs text-white placeholder:text-stone-500 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-semibold text-stone-950 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.multiplayer.send}</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
