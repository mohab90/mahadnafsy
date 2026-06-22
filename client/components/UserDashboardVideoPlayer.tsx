import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Lock, NotebookPen, Play, X } from 'lucide-react';
import Hls from 'hls.js';
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
    let hls: Hls | null = null;

    const isHls = src.includes('.m3u8') || src.includes('/hls/');
    if (isHls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: false });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (startTime > 0) video.currentTime = startTime;
        video.play().catch(() => {});
      });
    } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = src;
      video.addEventListener('loadedmetadata', () => {
        if (startTime > 0) video.currentTime = startTime;
        video.play().catch(() => {});
      }, { once: true });
    } else {
      // Regular MP4 / direct URL
      video.src = src;
      video.addEventListener('loadedmetadata', () => {
        if (startTime > 0) video.currentTime = startTime;
        video.play().catch(() => {});
      }, { once: true });
    }

    return () => { hls?.destroy(); };
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
  const { getCourseLectures, getCourseChapters, subscribers, authUser, updateSubscriber } = useSiteData();
  const [selectedId, setSelectedId] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [openChapters, setOpenChapters] = useState<Record<string, boolean>>({});
  const [lecturesLoading, setLecturesLoading] = useState(false);
  // Resolved playable URL for the selected lecture. Paid lectures no longer ship their URL in
  // the public catalog — it's fetched on demand from the auth-gated access endpoint.
  const [resolvedUrl, setResolvedUrl] = useState('');

  const subscriber = authUser?.email
    ? subscribers.find(s =>
        s.email.toLowerCase().trim() === authUser.email!.toLowerCase().trim()
      )
    : undefined;

  // ── Per-lecture notes (localStorage) ──────────────────────────────────────
  const notesKey = (lectureId: string) =>
    subscriber ? `notes:${subscriber.id}:${lectureId}` : null;
  const getNotes = (lectureId: string) => {
    const k = notesKey(lectureId);
    if (!k) return '';
    try { return localStorage.getItem(k) || ''; } catch { return ''; }
  };
  const saveNotes = (lectureId: string, text: string) => {
    const k = notesKey(lectureId);
    if (!k) return;
    try { localStorage.setItem(k, text); } catch { /* quota */ }
  };
  const [noteText, setNoteText] = useState('');
  useEffect(() => { setNoteText(getNotes(selectedId)); }, [selectedId, subscriber?.id]);
  const handleNoteChange = (v: string) => {
    setNoteText(v);
    if (selectedId) saveNotes(selectedId, v);
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
    if (!selected || selected.locked) return;
    if (selected.videoUrl) { setResolvedUrl(selected.videoUrl); return; }
    mysqlClient.getLectureAccess(selected.id)
      .then(r => { if (!cancelled && r.accessible && r.video_url) setResolvedUrl(r.video_url); })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.locked, selected?.videoUrl]);

  // Mark a lecture as 100% complete and persist to subscriber record
  const markLectureComplete = (lectureId: string) => {
    if (markedRef.current.has(lectureId)) return;
    markedRef.current.add(lectureId);
    const sub = subscribers.find(s =>
      authUser?.email && s.email.toLowerCase().trim() === authUser.email.toLowerCase().trim()
    );
    if (!sub) return;
    // Update local state immediately
    updateSubscriber({ ...sub, lectureProgress: { ...(sub.lectureProgress || {}), [lectureId]: 100 } });
    // Persist to DB via client endpoint (works for non-admin users too)
    void mysqlClient.saveLectureProgress(lectureId, 100).catch(() => {});
  };

  // ── Video time save/restore (resume within video) ──────────────────────────
  const getSavedTime = (lectureId: string): number => {
    if (!subscriber) return 0;
    try { return parseInt(localStorage.getItem(`vt:${subscriber.id}:${lectureId}`) || '0') || 0; } catch { return 0; }
  };
  const saveTime = (lectureId: string, seconds: number) => {
    if (!subscriber || seconds < 3) return;
    try { localStorage.setItem(`vt:${subscriber.id}:${lectureId}`, String(Math.floor(seconds))); } catch { /* quota */ }
  };
  // Ref to avoid double-seeking on native video remount
  const timeSeekedRef = useRef<Set<string>>(new Set());
  useEffect(() => { timeSeekedRef.current.delete(selectedId); }, [selectedId]);

  // Listen for YouTube messages — ended + time tracking via infoDelivery
  useEffect(() => {
    const handleMsg = (ev: MessageEvent) => {
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
    const params = `?autoplay=1&controls=1&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3&color=white&playsinline=1&enablejsapi=1${start}`;
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
          {selectedId && getNotes(selectedId) && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />}
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
            !resolvedUrl ? (
              <div className="text-gray-500 text-center">
                <div className="w-8 h-8 border-2 border-gray-500 border-t-white rounded-full animate-spin mx-auto mb-3"></div>
                <p className="text-sm">جاري تحميل الفيديو...</p>
              </div>
            ) : resolvedUrl.includes('youtube') || resolvedUrl.includes('youtu.be') || resolvedUrl.startsWith('enc:') ? (
              <iframe
                key={selected.id}
                src={getEmbedUrl(resolvedUrl, getSavedTime(selected.id))}
                className="w-full h-full"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
                title={selected.title}
              />
            ) : (
              <HlsVideoPlayer
                key={selected.id}
                src={deobfV2(resolvedUrl)}
                startTime={getSavedTime(selected.id)}
                onTimeUpdate={(currentTime, duration) => {
                  if (Math.floor(currentTime) % 5 === 0) saveTime(selected.id, currentTime);
                  if (duration > 0 && currentTime / duration >= 0.8) markLectureComplete(selected.id);
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
