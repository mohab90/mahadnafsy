import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react';

import { youtubeEmbedUrl } from '../lib/lectureVideo';

/**
 * A YouTube video with none of YouTube in it.
 *
 * «عاوز اقفل اني يظهر علامه اليوتيوب في اسفل الشاشه او انه يضغط علي عنوان
 * الفيديو ويتنقل منه لليوتيوب». The parameters that were supposed to do this —
 * modestbranding and showinfo — have both been retired by YouTube (2023 and
 * 2018), so they sat in the URL doing nothing while the logo and the clickable
 * title stayed exactly where they were. The strips of dark gradient laid over
 * the corners were the next attempt: they covered part of the picture, they
 * only covered the two places somebody had thought of, and they moved whenever
 * YouTube moved its own furniture.
 *
 * This is the version that does not depend on guessing where YouTube will draw
 * things:
 *
 *   controls=0            there is no control bar, so there is no logo in it,
 *                         and no title bar to click. Verified on the live site
 *                         against a real lecture — playing and on hover, the
 *                         frame shows the video and nothing else.
 *   pointer-events: none  the frame cannot be clicked at all. Whatever YouTube
 *                         decides to draw tomorrow, it is not reachable.
 *   everything else ours  play, pause, seek, volume, speed, fullscreen and the
 *                         poster, driven over postMessage.
 *
 * The last part is what makes the first two affordable: taking YouTube's
 * controls away without replacing them would leave a video nobody can pause.
 *
 * Fullscreen goes through this component's own wrapper rather than the frame,
 * because YouTube's native fullscreen chrome puts the title back on screen.
 *
 * Two pieces of branding survive controls=0 and neither is a link: the red play
 * button on the poster and the wordmark on the loading screen. The poster and
 * the spinner here sit on top of both until the video is actually playing.
 *
 * What this is not: a lock. A screen recorder still records, and nothing on a
 * page can stop that. It closes the doors that were standing open.
 */

/** YouTube's player states, as they arrive over postMessage. */
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;

const YT_ORIGINS = ['https://www.youtube.com', 'https://www.youtube-nocookie.com'];

const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export interface VideoSurfaceProps {
  /** The stored URL, obfuscated or not. */
  url: string;
  /** Shown on the poster, and read out to screen readers. Ours, never YouTube's. */
  title?: string;
  autoplay?: boolean;
  /** Where to resume from. */
  startSeconds?: number;
  /** Repeated faintly across the picture — the viewer's own email, usually. */
  watermark?: string;
  /** Called about four times a second while playing. */
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  className?: string;
}

export const VideoSurface: React.FC<VideoSurfaceProps> = ({
  url, title, autoplay = false, startSeconds = 0, watermark,
  onTimeUpdate, onEnded, className = '',
}) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<number>(-1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  /** Until this is true the poster covers the frame, red play button and all. */
  const [started, setStarted] = useState(false);
  /** Where the thumb is while being dragged, so the bar does not fight the user. */
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const src = youtubeEmbedUrl(url, { autoplay, startSeconds, jsApi: true });

  const command = useCallback((func: string, args: unknown[] = []) => {
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }), '*');
  }, []);

  // The handshake. Without it YouTube sends no infoDelivery at all, and this
  // component has no idea what the video is doing.
  const listen = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'listening', id: 1 }), '*');
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!YT_ORIGINS.includes(event.origin)) return;
      let data: Record<string, unknown>;
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch { return; }
      if (!data || typeof data !== 'object') return;

      const info = (data.info ?? {}) as Record<string, unknown>;
      if (data.event === 'onReady' || data.event === 'initialDelivery') listen();

      const playerState = typeof data.event === 'string' && data.event === 'onStateChange'
        ? Number(data.info)
        : typeof info.playerState === 'number' ? info.playerState : null;
      if (playerState !== null && Number.isFinite(playerState)) {
        setState(playerState);
        if (playerState === PLAYING) setStarted(true);
        if (playerState === ENDED) onEnded?.();
      }

      if (typeof info.currentTime === 'number') {
        setCurrent(info.currentTime);
        const known = typeof info.duration === 'number'
          ? info.duration
          : Number((info.progressState as Record<string, unknown> | undefined)?.duration) || 0;
        if (known > 0) setDuration(known);
        if (known > 0) onTimeUpdate?.(info.currentTime, known);
      }
      if (typeof info.duration === 'number' && info.duration > 0) setDuration(info.duration);
      if (typeof info.volume === 'number') setVolume(info.volume);
      if (typeof info.muted === 'boolean') setMuted(info.muted);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [listen, onEnded, onTimeUpdate]);

  // A new video means a new frame, so the handshake has to happen again. The
  // interval is for the case where onReady arrived before this component was
  // listening, which happens on a cached frame.
  useEffect(() => {
    setStarted(false);
    setState(-1);
    setCurrent(0);
    setDuration(0);
    const id = setInterval(listen, 700);
    const stop = setTimeout(() => clearInterval(id), 6000);
    return () => { clearInterval(id); clearTimeout(stop); };
  }, [src, listen]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const playing = state === PLAYING;

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChromeVisible(false), 2600);
  }, []);

  // Controls stay put while paused — hiding them then only makes people hunt.
  useEffect(() => {
    if (!playing) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setChromeVisible(true);
    } else showChrome();
  }, [playing, showChrome]);

  const toggle = useCallback(() => {
    if (playing) command('pauseVideo');
    else command('playVideo');
    showChrome();
  }, [playing, command, showChrome]);

  const seekTo = (seconds: number) => {
    const target = Math.max(0, Math.min(seconds, duration || seconds));
    command('seekTo', [target, true]);
    setCurrent(target);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement === wrapRef.current) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen?.().catch(() => {});
  };

  // YouTube's own shortcuts are off (disablekb=1) and the frame cannot take
  // focus, so these are the only ones. Space and the arrows are what people
  // reach for.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys = [' ', 'k', 'ArrowLeft', 'ArrowRight', 'm', 'f'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    showChrome();
    if (event.key === ' ' || event.key === 'k') toggle();
    if (event.key === 'ArrowLeft') seekTo(current - 5);
    if (event.key === 'ArrowRight') seekTo(current + 5);
    if (event.key === 'm') { command(muted ? 'unMute' : 'mute'); setMuted(!muted); }
    if (event.key === 'f') toggleFullscreen();
  };

  const shown = scrubbing ?? current;
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;

  return (
    <div
      ref={wrapRef}
      className={`relative w-full h-full bg-black overflow-hidden ${className}`}
      onMouseMove={showChrome}
      onMouseLeave={() => playing && setChromeVisible(false)}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="region"
      aria-label={title || 'مشغل الفيديو'}
    >
      <iframe
        ref={frameRef}
        src={src}
        className="absolute inset-0 w-full h-full"
        // The whole point. Nothing YouTube draws — now or after their next
        // redesign — can be clicked, so nothing it draws can be a way out.
        style={{ pointerEvents: 'none' }}
        tabIndex={-1}
        // No fullscreen permission and no allowFullScreen: YouTube's native
        // fullscreen puts the title back on screen. The wrapper goes fullscreen
        // instead, and these controls go with it.
        allow="autoplay; encrypted-media"
        // Stripping the referrer entirely makes YouTube answer «Error 153:
        // Video player configuration error» instead of the video — it uses the
        // Referer to check the embedding domain. This sends the bare origin.
        referrerPolicy="strict-origin-when-cross-origin"
        title={title || 'video'}
      />

      {/* Ours, per viewer. Not a deterrent to a determined copier; a name on a
          copy that turns up somewhere it should not be. */}
      {watermark && (
        <div className="absolute inset-0 z-10 pointer-events-none select-none overflow-hidden" aria-hidden="true">
          {Array.from({ length: 3 }, (_, row) =>
            Array.from({ length: 2 }, (_, col) => (
              <span
                key={`wm-${row}-${col}`}
                className="absolute text-white/20 text-[10px] font-semibold rotate-[-25deg] whitespace-nowrap"
                style={{ top: `${15 + row * 28}%`, left: `${col * 55}%` }}
              >
                {watermark}
              </span>
            ))
          ).flat()}
        </div>
      )}

      {/* Click anywhere to play or pause. Sits under the control bar so the
          buttons still get their own clicks. */}
      <button
        type="button"
        className="absolute inset-0 z-20 w-full h-full cursor-pointer"
        onClick={toggle}
        aria-label={playing ? 'إيقاف مؤقت' : 'تشغيل'}
      />

      {/* The poster. It is here to cover YouTube's red play button and the
          wordmark on its loading screen, both of which survive controls=0. */}
      {!started && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black">
          {/* Above the button, not below it: the control bar is drawn on top of
              this and a title underneath disappeared behind it. */}
          {title && (
            <p className="px-6 text-center text-white/90 text-sm font-bold line-clamp-2">{title}</p>
          )}
          <button
            type="button"
            onClick={toggle}
            className="w-16 h-16 rounded-full bg-white/95 hover:bg-white transition flex items-center justify-center shadow-2xl"
            aria-label="تشغيل الفيديو"
          >
            {state === BUFFERING
              ? <Loader2 size={26} className="animate-spin text-gray-900" />
              : <Play size={26} className="text-gray-900 mr-[-3px]" fill="currentColor" />}
          </button>
        </div>
      )}

      {/* Buffering after it has started: our spinner, over YouTube's. */}
      {started && state === BUFFERING && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 pointer-events-none">
          <Loader2 size={34} className="animate-spin text-white/90" />
        </div>
      )}

      <div
        className={`absolute bottom-0 left-0 right-0 z-40 px-3 pb-2 pt-8 bg-gradient-to-t from-black/85 to-transparent transition-opacity duration-200 ${
          chromeVisible || !started ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        dir="ltr"
      >
        <input
          type="range"
          min={0}
          max={Math.max(duration, 1)}
          step={0.5}
          value={shown}
          onChange={event => setScrubbing(Number(event.target.value))}
          onMouseUp={event => { seekTo(Number((event.target as HTMLInputElement).value)); setScrubbing(null); }}
          onTouchEnd={event => { seekTo(Number((event.target as HTMLInputElement).value)); setScrubbing(null); }}
          className="w-full h-1 appearance-none rounded-full cursor-pointer accent-white"
          style={{ background: `linear-gradient(to right, #fff ${pct}%, rgba(255,255,255,0.3) ${pct}%)` }}
          aria-label="موضع التشغيل"
        />
        <div className="flex items-center gap-3 mt-1.5 text-white">
          <button type="button" onClick={toggle} aria-label={playing ? 'إيقاف مؤقت' : 'تشغيل'} className="hover:text-white/80 transition">
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>

          <button
            type="button"
            onClick={() => { command(muted ? 'unMute' : 'mute'); setMuted(!muted); }}
            aria-label={muted ? 'تشغيل الصوت' : 'كتم الصوت'}
            className="hover:text-white/80 transition"
          >
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            onChange={event => {
              const next = Number(event.target.value);
              setVolume(next);
              setMuted(next === 0);
              command('setVolume', [next]);
              if (next > 0 && muted) command('unMute');
            }}
            className="w-16 h-1 appearance-none rounded-full cursor-pointer accent-white"
            style={{ background: `linear-gradient(to right, #fff ${muted ? 0 : volume}%, rgba(255,255,255,0.3) ${muted ? 0 : volume}%)` }}
            aria-label="مستوى الصوت"
          />

          <span className="text-[11px] font-mono tabular-nums text-white/90">
            {clock(shown)} / {clock(duration)}
          </span>

          <div className="mr-auto flex items-center gap-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => setSpeedOpen(open => !open)}
                className="text-[11px] font-bold px-1.5 py-0.5 rounded hover:bg-white/15 transition"
                aria-label="سرعة التشغيل"
              >
                {speed}×
              </button>
              {speedOpen && (
                <div className="absolute bottom-7 left-0 bg-black/90 rounded-lg py-1 min-w-[56px]">
                  {SPEEDS.map(rate => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => { setSpeed(rate); command('setPlaybackRate', [rate]); setSpeedOpen(false); }}
                      className={`block w-full px-3 py-1 text-[11px] text-right hover:bg-white/15 transition ${
                        rate === speed ? 'font-bold text-white' : 'text-white/80'}`}
                    >
                      {rate}×
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'}
              className="hover:text-white/80 transition"
            >
              {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoSurface;
