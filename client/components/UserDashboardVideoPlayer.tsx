import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Lock, NotebookPen, Play, X } from 'lucide-react';
import type HlsType from 'hls.js';
import { mysqlClient } from '../lib/mysqlapi';
import { useSiteData } from '../context/SiteDataContext';

const _vk = (import.meta.env.VITE_VIDEO_KEY as string) || '';
const deobfV2 = (raw: string): string => {
  if (!raw || !raw.startsWith('enc:') || !_vk) return raw;
  try {
    return atob(raw.slice(4)).split('').map((c, i) =>
      String.fromCharCode(c.charCodeAt(0) ^ _vk.charCodeAt(i % _vk.length))
    ).join('');
  } catch { return raw; }
};

/* ─── HLS-capable video player ───────────────────────────────────────────── */
interface HlsVideoPlayerProps {
  src: string;
  startTime?: number;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onSeeked?: (video: HTMLVideoElement) => void;
}
const HlsVideoPlayer: React.FC<HlsVideoPlayerProps> = ({ src, startTime = 0, onTimeUpdate, onSeeked }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let hls: HlsType | null = null;
    let cancelled = false;

    // Native playback (MP4 / direct URL / Safari-native HLS).
    const startNative = () => {
      video.src = src;
      video.addEventListener('loadedmetadata', () => {
        if (startTime > 0) video.currentTime = startTime;
        video.play().catch(() => {});
      }, { once: true });
    };

    const isHls = src.includes('.m3u8') || src.includes('/hls/') || src.includes('kind=hls');
    if (isHls) {
      // hls.js (~500KB) is loaded on demand ONLY when an HLS stream actually
      // plays, so it never ships in the initial student-dashboard bundle.
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled || !videoRef.current) return;
        if (Hls.isSupported()) {
          hls = new Hls({ enableWorker: false });
          hls.loadSource(src);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (startTime > 0) video.currentTime = startTime;
            video.play().catch(() => {});
          });
        } else {
          // Safari native HLS or fallback
          startNative();
        }
      }).catch(() => { if (!cancelled) startNative(); });
    } else {
      startNative();
    }

    return () => { cancelled = true; hls?.destroy(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <video
      ref={videoRef}
      className="w-full h-full"
      controls
      autoPlay
      playsInline
      onContextMenu={e => e.preventDefault()}
      onTimeUpdate={e => onTimeUpdate?.(e.currentTarget.currentTime, e.currentTarget.duration)}
      onSeeked={e => onSeeked?.(e.currentTarget)}
    />
  );
};

/* ─── Full-screen video player modal ─────────────────────────────────────── */
interface VideoPlayerProps {
  courseId: string;
  onClose: () => void;
}
export const VideoPlayer: React.FC<VideoPlayerProps> = ({ courseId, onClose }) => {
  const { getCourseLectures, getCourseChapters, subscribers, authUser, mySubscriberId, refreshMySubscriber } = useSiteData();
  const [selectedId, setSelectedId] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [openChapters, setOpenChapters] = useState<Record<string, boolean>>({});
  const [lecturesLoading, setLecturesLoading] = useState(false);
  // Resolved playable URL for the selected lecture. Paid lectures no longer ship their URL in
  // the public catalog — it's fetched on demand from the auth-gated access endpoint.
  const [resolvedUrl, setResolvedUrl] = useState('');
  const [accessError, setAccessError] = useState('');

  // Keyed on the id the server resolved, not on a client-side email match: a
  // client who signed in by WhatsApp number has no email, and matching on it
  // left them with no subscriber — no notes, no progress, on courses they paid for.
  const subscriber = mySubscriberId
    ? subscribers.find(s => s.id === mySubscriberId)
    : undefined;

  const [noteText, setNoteText] = useState('');
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    setNoteText('');
    if (selectedId && subscriber) {
      mysqlClient.getLectureNote(selectedId)
        .then(({ note }) => { if (!cancelled) setNoteText(note || ''); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [selectedId, subscriber?.id]);
  const handleNoteChange = (v: string) => {
    setNoteText(v);
    if (!selectedId) return;
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    const lectureId = selectedId;
    noteTimerRef.current = setTimeout(() => {
      void mysqlClient.saveLectureNote(lectureId, v).catch(() => {});
    }, 600);
  };
  // Prevent saving progress more than once per lecture per session
  const markedRef = useRef<Set<string>>(new Set());

  const chapters = getCourseChapters(courseId);
  const rawLectures = getCourseLectures(courseId).slice().sort((a, b) => {
    const chOrderA = chapters.find(c => c.id === a.chapterId)?.order ?? Infinity;
    const chOrderB = chapters.find(c => c.id === b.chapterId)?.order ?? Infinity;
    if (chOrderA !== chOrderB) return chOrderA - chOrderB;
    return (a.order ?? 0) - (b.order ?? 0);
  });

  const rawAccess = subscriber?.courseAccess?.[courseId];
  const isEnrolled = !!(subscriber && subscriber.enrolledCourseIds.includes(String(courseId)));
  // accessMode priority: explicit courseAccess from DB enrollments > enrolled with no limit = full > not enrolled = preview
  const accessMode = typeof rawAccess === 'object' && rawAccess !== null && rawAccess.mode === 'limited' ? 'limited'
    : rawAccess === 'full' || (typeof rawAccess === 'object' && rawAccess !== null && rawAccess.mode === 'full') ? 'full'
    : rawAccess === 'preview' ? 'preview'
    : isEnrolled ? 'full'   // enrolled with no explicit access limit = full access
    : 'preview';
  const lectureLimit = typeof rawAccess === 'object' && rawAccess !== null ? Number((rawAccess as { lectureLimit?: number }).lectureLimit || 2) : 2;
  const unlockedCount = accessMode === 'full' ? rawLectures.length : accessMode === 'limited' ? Math.min(lectureLimit, rawLectures.length) : 2;

  type LectureWithLock = typeof rawLectures[0] & { locked: boolean };
  const lectures: LectureWithLock[] = rawLectures.map((l, i) => ({
    ...l, locked: accessMode !== 'full' && i >= unlockedCount,
  }));

  // ── Refetch lectures if empty when player opens (handles case where Batch B failed during a server outage) ──
  const { reloadLectures } = useSiteData();
  useEffect(() => {
    if (rawLectures.length > 0 || lecturesLoading) return;
    setLecturesLoading(true);
    reloadLectures().finally(() => setLecturesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  useEffect(() => {
    if (rawLectures.length === 0) return;
    const progress = subscriber?.lectureProgress || {};
    const unlocked = lectures.filter(l => !l.locked);
    if (unlocked.length === 0) return;
    // 1. Check localStorage for the last-watched lecture for this subscriber+course
    const lsKey = subscriber ? `last-lecture:${subscriber.id}:${courseId}` : null;
    if (lsKey) {
      const saved = localStorage.getItem(lsKey);
      if (saved && unlocked.some(l => l.id === saved)) {
        setSelectedId(saved);
        return;
      }
    }
    // 2. Try to resume: last lecture that was started but not finished
    const inProgress = unlocked.filter(l => progress[l.id] !== undefined && (progress[l.id] as number) < 100);
    if (inProgress.length > 0) { setSelectedId(inProgress[inProgress.length - 1].id); return; }
    // 3. First unwatched lecture (no entry in progress)
    const firstUnwatched = unlocked.find(l => !progress[l.id]);
    if (firstUnwatched) { setSelectedId(firstUnwatched.id); return; }
    // 4. All done: start from beginning
    setSelectedId(unlocked[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawLectures.length]);

  // Persist the currently selected lecture so we can resume next time
  useEffect(() => {
    if (!selectedId || !subscriber) return;
    try { localStorage.setItem(`last-lecture:${subscriber.id}:${courseId}`, selectedId); } catch { /* quota */ }
  }, [selectedId, subscriber?.id, courseId]);

  const selected = lectures.find(l => l.id === selectedId) || null;

  // Resolve the playable URL: preview lectures carry it directly; paid ones are fetched
  // on demand from the auth-gated endpoint (which verifies enrollment + limit + drip).
  useEffect(() => {
    let cancelled = false;
    setResolvedUrl('');
    setAccessError('');
    if (!selected || selected.locked) return;
    if (selected.videoUrl) { setResolvedUrl(selected.videoUrl); return; }
    mysqlClient.getLectureAccess(selected.id)
      .then(r => {
        if (cancelled) return;
        if (r.accessible && r.video_url) setResolvedUrl(r.video_url);
        else if (r.reason === 'drip_locked') {
          const when = r.unlocks_at ? new Date(r.unlocks_at).toLocaleDateString('ar-EG') : '';
          setAccessError(`المحاضرة هتفتح في موعدها${when ? ` يوم ${when}` : ''}`);
        } else setAccessError('المحاضرة غير متاحة ضمن صلاحية اشتراكك الحالية');
      })
      .catch(() => { if (!cancelled) setAccessError('تعذر التحقق من صلاحية المحاضرة؛ حاول مرة أخرى'); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.locked, selected?.videoUrl]);

  // Persist completion through the canonical LMS progress endpoint.
  const markLectureComplete = (lectureId: string, watchSeconds?: number) => {
    if (markedRef.current.has(lectureId)) return;
    markedRef.current.add(lectureId);
    void mysqlClient.saveLectureProgress(lectureId, 100, watchSeconds ?? getSavedTime(lectureId))
      .then(result => {
        if (result.ok) refreshMySubscriber();
      })
      .catch(() => {});
  };

  // ── Video time save/restore (resume within video) ──────────────────────────
  const getSavedTime = (lectureId: string): number => {
    if (!subscriber) return 0;
    try { return parseInt(localStorage.getItem(`vt:${subscriber.id}:${lectureId}`) || '0') || 0; } catch { return 0; }
  };
  const saveTime = (lectureId: string, seconds: number, duration?: number) => {
    if (!subscriber || seconds < 3) return;
    try { localStorage.setItem(`vt:${subscriber.id}:${lectureId}`, String(Math.floor(seconds))); } catch { /* quota */ }
    const bucket = Math.floor(seconds / 15);
    const lastBucket = watchSyncRef.current.get(lectureId);
    if (bucket > 0 && bucket !== lastBucket) {
      watchSyncRef.current.set(lectureId, bucket);
      // Report the percentage actually watched. This used to resend whatever
      // percentage was already stored, so a lecture stayed at 0% until the 80%
      // completion mark flipped it straight to 100 — the learner (and the admin
      // looking at their file) could never see partial progress. Never walks
      // backwards, so re-watching an earlier part can't lower a lecture's score.
      const stored = Number(subscriber.lectureProgress?.[lectureId]) || 0;
      const watched = duration && duration > 0
        ? Math.min(100, Math.round((seconds / duration) * 100))
        : stored;
      void mysqlClient.saveLectureProgress(lectureId, Math.max(stored, watched), seconds).catch(() => {});
    }
  };
  const watchSyncRef = useRef(new Map<string, number>());
  // Ref to avoid double-seeking on native video remount
  const timeSeekedRef = useRef<Set<string>>(new Set());
  useEffect(() => { timeSeekedRef.current.delete(selectedId); }, [selectedId]);

  // Listen for YouTube messages — ended + time tracking via infoDelivery
  useEffect(() => {
    const handleMsg = (ev: MessageEvent) => {
      if (!['https://www.youtube.com', 'https://www.youtube-nocookie.com'].includes(ev.origin)) return;
      try {
        const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        // YouTube Iframe API sends {event:'onStateChange', info:0} when video ends
        if (data?.event === 'onStateChange' && data?.info === 0 && selectedId) {
          markLectureComplete(selectedId);
        }
        // YouTube sends infoDelivery with currentTime when enablejsapi=1
        if (data?.event === 'infoDelivery' && typeof data?.info?.currentTime === 'number' && selectedId) {
          saveTime(selectedId, data.info.currentTime);
        }
      } catch { /* ignore non-JSON messages */ }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const getEmbedUrl = (url: string, startSec = 0) => {
    if (!url) return '';
    const plain = deobfV2(url);
    if (!plain) return '';
    const start = startSec > 0 ? `&start=${Math.floor(startSec)}` : '';
    // disablekb=1 removes YouTube's keyboard shortcuts, some of which navigate
    // away from the lesson. fs=0 drops the fullscreen control, whose native
    // chrome exposes the video title (and with it a route to youtube.com).
    const params = `?autoplay=1&controls=1&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3&color=white&playsinline=1&enablejsapi=1&disablekb=1&fs=0${start}`;
    if (plain.includes('youtube.com/watch?v=')) {
      try { const videoId = new URL(plain).searchParams.get('v') || ''; return `https://www.youtube-nocookie.com/embed/${videoId}${params}`; } catch { /* fall through */ }
    }
    if (plain.includes('youtu.be/')) {
      const videoId = plain.split('youtu.be/')[1]?.split('?')[0] || '';
      return `https://www.youtube-nocookie.com/embed/${videoId}${params}`;
    }
    if (plain.includes('youtube.com/embed/')) {
      const videoId = plain.split('embed/')[1]?.split('?')[0] || '';
      return `https://www.youtube-nocookie.com/embed/${videoId}${params}`;
    }
    return plain;
  };

  const grouped =
    chapters.length > 0
      ? chapters.map(ch => ({ ch, lecs: lectures.filter(l => l.chapterId === ch.id) }))
      : [{ ch: null as typeof chapters[0] | null, lecs: lectures }];

  return (
    <div className="fixed inset-0 z-[100] bg-gray-950 flex flex-col" dir="rtl">
      {/* Top bar */}
      <div className="h-12 bg-gray-900 border-b border-gray-700 flex items-center px-4 gap-4 flex-shrink-0">
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition flex items-center gap-1.5 text-sm"
        >
          <X size={16} /> إغلاق
        </button>
        <span className="text-white text-sm font-bold truncate flex-1">{selected?.title || 'اختر محاضرة'}</span>
        <button
          onClick={() => setNotesOpen(p => !p)}
          className={`text-sm flex items-center gap-1 flex-shrink-0 transition ${notesOpen ? 'text-yellow-400' : 'text-gray-400 hover:text-white'}`}
          title="ملاحظاتي"
        >
          <NotebookPen size={15} />
          <span className="text-xs hidden sm:inline">ملاحظات</span>
          {selectedId && noteText && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />}
        </button>
        <button
          onClick={() => setSidebarOpen(p => !p)}
          className="text-gray-400 hover:text-white text-sm flex items-center gap-1 flex-shrink-0"
        >
          {sidebarOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          <span className="text-xs">{sidebarOpen ? 'إخفاء' : 'المحاضرات'}</span>
        </button>
      </div>

      <div className="flex flex-col sm:flex-row flex-1 overflow-hidden">
        {/* Video panel */}
        <div className="bg-black flex items-center justify-center flex-shrink-0 w-full aspect-video sm:aspect-auto sm:flex-1 sm:min-w-0">
          {selected && !selected.locked ? (
            accessError ? (
              <div className="text-amber-300 text-center px-6">
                <Lock size={40} className="mx-auto mb-3 text-amber-400" />
                <p className="text-sm font-bold">{accessError}</p>
              </div>
            ) : !resolvedUrl ? (
              <div className="text-gray-500 text-center">
                <div className="w-8 h-8 border-2 border-gray-500 border-t-white rounded-full animate-spin mx-auto mb-3"></div>
                <p className="text-sm">جاري تحميل الفيديو...</p>
              </div>
            ) : resolvedUrl.includes('youtube') || resolvedUrl.includes('youtu.be') || resolvedUrl.startsWith('enc:') || resolvedUrl.includes('kind=embed') ? (
              /* The embed still renders YouTube's own title bar across the top on
                 hover, and that title (and the logo beside it) link out to
                 youtube.com. The strip below sits over that band and swallows the
                 clicks, so the lesson can't be used as a doorway to YouTube. It
                 covers only the top ~15%, leaving the control bar fully usable. */
              <div className="relative w-full h-full">
                <iframe
                  key={selected.id}
                  src={getEmbedUrl(resolvedUrl, getSavedTime(selected.id))}
                  className="w-full h-full"
                  // fullscreen is in both the permission policy and the legacy
                  // attribute: without them the player's own expand button is
                  // inert, which is why a lesson could not be watched full
                  // screen while the promo and community players could.
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  // "no-referrer" broke playback outright: YouTube's embed
                  // player uses the Referer header to validate the embedding
                  // domain, and with it stripped it serves "Error 153: Video
                  // player configuration error" instead of the video —
                  // reproduced live 2026-08-05. strict-origin-when-cross-origin
                  // sends only the bare origin (https://mahadnafsy.com), same
                  // as the free promo-video player, which never had this bug.
                  referrerPolicy="strict-origin-when-cross-origin"
                  title={selected.title}
                />
                <div
                  className="absolute top-0 left-0 right-0 h-[15%] min-h-[48px] cursor-default"
                  onClick={e => e.preventDefault()}
                  onContextMenu={e => e.preventDefault()}
                  aria-hidden="true"
                />
              </div>
            ) : (
              <HlsVideoPlayer
                key={selected.id}
                src={deobfV2(resolvedUrl)}
                startTime={getSavedTime(selected.id)}
                onTimeUpdate={(currentTime, duration) => {
                  if (Math.floor(currentTime) % 5 === 0) saveTime(selected.id, currentTime, duration);
                  if (duration > 0 && currentTime / duration >= 0.8) markLectureComplete(selected.id, currentTime);
                }}
                onSeeked={(vid) => {
                  const t = getSavedTime(selected.id);
                  if (t > 0 && !timeSeekedRef.current.has(selected.id)) {
                    timeSeekedRef.current.add(selected.id);
                    vid.currentTime = t;
                  }
                }}
              />
            )
          ) : selected?.locked ? (
            <div className="text-center text-gray-400 px-6">
              <Lock size={48} className="mx-auto mb-3 text-gray-600" />
              <p className="text-lg font-bold text-white mb-1">هذه المحاضرة مقيدة</p>
              <p className="text-sm">يرجى الترقية للوصول الكامل</p>
            </div>
          ) : (
            <div className="text-gray-500 text-center">
              {lecturesLoading ? (
                <>
                  <div className="w-8 h-8 border-2 border-gray-500 border-t-white rounded-full animate-spin mx-auto mb-3"></div>
                  <p className="text-sm">جاري تحميل المحاضرات...</p>
                </>
              ) : (
                <>
                  <Play size={48} className="mx-auto mb-3" />
                  <p>اختر محاضرة من القائمة</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Notes panel */}
        {notesOpen && (
          <div className="flex-none w-full sm:w-72 bg-gray-950 border-t border-gray-700 sm:border-t-0 sm:border-r flex flex-col flex-shrink-0">
            <div className="px-4 py-2 bg-gray-900 border-b border-gray-700 flex items-center gap-2">
              <NotebookPen size={13} className="text-yellow-400" />
              <span className="text-xs font-bold text-yellow-400">ملاحظاتي — {selected?.title || ''}</span>
            </div>
            <textarea
              dir="rtl"
              value={noteText}
              onChange={e => handleNoteChange(e.target.value)}
              placeholder="اكتب ملاحظاتك هنا..."
              className="flex-1 bg-gray-950 text-gray-100 text-sm p-3 resize-none focus:outline-none placeholder:text-gray-600"
              disabled={!selected || !!selected.locked}
            />
            <div className="px-3 py-1.5 border-t border-gray-800 text-xs text-gray-600 flex justify-between">
              <span>تُحفظ تلقائياً</span>
              {noteText && <span>{noteText.length} حرف</span>}
            </div>
          </div>
        )}

        {/* Sidebar */}
        {sidebarOpen && (
          <div className="flex-1 sm:flex-none sm:w-72 bg-gray-900 border-t border-gray-700 sm:border-t-0 sm:border-r overflow-y-auto flex-shrink-0">
            {grouped.map(({ ch, lecs }) => (
              <div key={ch?.id || 'default'}>
                {ch && (
                  <button
                    onClick={() => setOpenChapters(p => ({ ...p, [ch.id]: !p[ch.id] }))}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 text-sm font-bold text-white hover:bg-gray-700 transition"
                  >
                    <span>{ch.title}</span>
                    {openChapters[ch.id] !== false ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}
                {(!ch || openChapters[ch.id] !== false) && lecs.map((l, i) => (
                  <button
                    key={l.id}
                    onClick={() => { if (!l.locked) setSelectedId(l.id); }}
                    className={[
                      'w-full text-right px-4 py-3 border-b border-gray-800 text-xs transition flex items-start gap-2',
                      selectedId === l.id ? 'bg-primary-800 text-white' : 'text-gray-300 hover:bg-gray-800',
                      l.locked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    <span className="flex-shrink-0 mt-0.5">
                      {l.locked
                        ? <Lock size={12} className="text-gray-500" />
                        : <Play size={12} className="text-primary-400" />}
                    </span>
                    <span className="flex-1 leading-snug">{i + 1}. {l.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── Main UserDashboard ─────────────────────────────────────────────────── */
