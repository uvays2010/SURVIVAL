import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, MapPin, Send, Users, Wifi, WifiOff, X } from 'lucide-react';
import {
  ConnectionStatus,
  MultiplayerChatMessage,
  PLAYER_PALETTE,
  RemotePlayerState,
} from '../game/multiplayer';
import { WorldMapId } from '../game/types';
import { GameLang, TRANSLATIONS } from '../i18n';

interface MultiplayerPanelProps {
  visible: boolean;
  isOpen: boolean;
  onClose: () => void;
  status: ConnectionStatus;
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
}

export const MultiplayerPanel: React.FC<MultiplayerPanelProps> = ({
  visible,
  isOpen,
  onClose,
  status,
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
}) => {
  const t = TRANSLATIONS[lang];
  const [nameInput, setNameInput] = useState(playerName);
  const [roomInput, setRoomInput] = useState(roomId);
  const [chatInput, setChatInput] = useState('');
  const [copied, setCopied] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

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
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', roomId);
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored if blocked by browser permissions
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
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-[#111720]">
          <div className="flex items-center gap-2.5 min-w-0">
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
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t.map.closeMap}
            className="p-1.5 rounded-lg bg-[#1a222d] text-stone-300 hover:text-white hover:bg-[#243040] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-4">
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
