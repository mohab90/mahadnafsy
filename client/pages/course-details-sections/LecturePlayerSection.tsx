import React from 'react';
import { Lock } from 'lucide-react';
import type { CourseChapterItem, CourseLectureItem } from '../../types';
import { cdnImg } from '../../lib/img';
import { VideoSurface } from '../../components/VideoSurface';
import { HOSTED_FRAME_ALLOW, isFramedLectureUrl, isYouTubeLecture, lectureEmbedUrl, revealVideoUrl } from '../../lib/lectureVideo';

type LockedLecture = CourseLectureItem & { locked: boolean };

interface LecturePlayerSectionProps {
  content: Record<string, string>;
  subscriberLoading: boolean;
  accessMode: 'preview' | 'full' | 'limited';
  unlockedLectureCount: number;
  chapters: CourseChapterItem[];
  lecturesWithLock: LockedLecture[];
  selectedLecture: LockedLecture | null;
  selectedLectureId: string;
  setSelectedLectureId: (id: string) => void;
  resolvedLectureUrl: string;
  lectureGateNotice: string;
  setLectureGateNotice: (notice: string) => void;
  authUserEmail: string | undefined;
  onLockedLectureClick: () => void;
}

export const LecturePlayerSection: React.FC<LecturePlayerSectionProps> = ({
  content,
  subscriberLoading,
  accessMode,
  unlockedLectureCount,
  chapters,
  lecturesWithLock,
  selectedLecture,
  selectedLectureId,
  setSelectedLectureId,
  resolvedLectureUrl,
  lectureGateNotice,
  setLectureGateNotice,
  authUserEmail,
  onLockedLectureClick,
}) => {
  const handleLectureClick = (lecture: LockedLecture) => {
    if (lecture.locked) {
      setLectureGateNotice(content['courseDetails.player.lockedNotice'] || 'هذه المحاضرة غير متاحة في المعاينة المجانية.');
      return;
    }
    setLectureGateNotice('');
    setSelectedLectureId(lecture.id);
  };


  // One row of the curriculum. The chapter view and the flat list label the
  // lock in different words, so the caller passes them in.
  const lectureRow = (lecture: LockedLecture, index: number, lockedText: string, openText: string) => (
    <button
      type="button"
      onClick={() => handleLectureClick(lecture)}
      aria-current={selectedLectureId === lecture.id ? 'true' : undefined}
      className={`w-full rounded-2xl border p-3 text-right transition ${selectedLectureId === lecture.id ? 'border-primary-600 bg-primary-50' : 'border-line bg-white hover:border-ink/30'} ${lecture.locked ? 'opacity-80' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-ink">{index + 1}. {lecture.title}</p>
          <p className="mt-0.5 text-xs text-muted">{lecture.duration} • {lecture.lectureType === 'live' ? 'بث مباشر' : 'مسجّلة'}</p>
        </div>
        {lecture.locked ? (
          <span className="inline-flex flex-none items-center gap-1 rounded-full bg-paper px-2 py-1 text-xs font-extrabold text-gold-deep ring-1 ring-line"><Lock size={12} />{lockedText}</span>
        ) : (
          <span className="inline-flex flex-none items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-xs font-extrabold text-green-700">{openText}</span>
        )}
      </div>
    </button>
  );

  return (
    <section id="curriculum" className="scroll-mt-32 rounded-[28px] border border-line bg-white p-4 sm:p-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
                <span className="text-sm font-extrabold text-gold-deep">{accessMode === 'full' ? 'محاضراتك' : 'جرّب قبل ما تحجز'}</span>
                <h2 className="mt-1 text-[26px] font-black leading-tight text-ink sm:text-[34px]">{content['courseDetails.player.title'] || (accessMode === 'full' ? 'محاضرات البرنامج' : 'المنهج — وشوف أول محاضرة مجاناً')}</h2>
                {lecturesWithLock.length > 0 && (
                  <p className="mt-1.5 text-sm font-bold text-muted">
                    {lecturesWithLock.length} فيديو{chapters.length > 0 ? ` · ${chapters.length} ${chapters.length > 2 && chapters.length < 11 ? 'فصول' : 'فصل'}` : ''}
                  </p>
                )}
            </div>
                                    <div className={`rounded-full px-3 py-1 text-xs font-extrabold ${subscriberLoading ? 'bg-paper text-muted-soft ring-1 ring-line' : accessMode === 'full' ? 'bg-green-50 text-green-700 ring-1 ring-green-200' : accessMode === 'limited' ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-100' : 'bg-green-50 text-green-700 ring-1 ring-green-200'}`}>
                                            {subscriberLoading
                                                ? '⏳ جاري التحقق...'
                                                : accessMode === 'full'
                                                ? (content['courseDetails.player.fullBadge'] || 'صلاحية كاملة')
                                                : accessMode === 'limited'
                                                    ? (content['courseDetails.player.limitedBadge'] || `صلاحية محدودة — ${unlockedLectureCount} محاضرة`)
                                                    : (content['courseDetails.player.previewBadge'] || `معاينة مجانية — أول ${unlockedLectureCount} محاضرة`)}
            </div>
        </div>

        {lecturesWithLock.length === 0 && (
            <div className="rounded-2xl bg-paper p-4 text-sm text-muted ring-1 ring-line">
                {content['courseDetails.player.empty'] || 'لا توجد محاضرات مضافة لهذا الكورس حتى الآن.'}
            </div>
        )}

        {lecturesWithLock.length > 0 && (
            <div className="grid grid-cols-1 gap-4">
                <div
                    className="relative aspect-video overflow-hidden rounded-[20px] bg-ink"
                    onContextMenu={(e) => e.preventDefault()}
                >
                    {selectedLecture && !selectedLecture.locked ? (
                        !resolvedLectureUrl ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white/70">
                                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mb-3"></div>
                                <p className="text-sm">جاري تحميل الفيديو...</p>
                            </div>
                        ) : isFramedLectureUrl(resolvedLectureUrl) ? (
                            isYouTubeLecture(resolvedLectureUrl) ? (
                              // The two dark strips that used to sit here
                              // covered the corners YouTube happened to draw
                              // in, and cost a slice of the picture to do it.
                              // VideoSurface takes the controls away entirely.
                              <VideoSurface
                                key={selectedLecture.id}
                                url={resolvedLectureUrl}
                                title={selectedLecture.title}
                                watermark={authUserEmail || 'معهد الدراسات النفسية'}
                              />
                            ) : (
                              // Vimeo, Drive, any hosted player page. They
                              // answer none of VideoSurface's postMessage
                              // protocol, so they keep their own controls —
                              // framing them at all is the fix. These used to
                              // fall through to a plain media element, which played nothing.
                              <div className="relative w-full h-full">
                                <iframe
                                  key={selectedLecture.id}
                                  src={lectureEmbedUrl(resolvedLectureUrl)}
                                  className="w-full h-full"
                                  allow={HOSTED_FRAME_ALLOW}
                                  allowFullScreen
                                  title={selectedLecture.title}
                                />
                                <div className="absolute inset-0 z-10 pointer-events-none select-none overflow-hidden" aria-hidden="true">
                                  {Array.from({ length: 3 }, (_, row) =>
                                    Array.from({ length: 2 }, (_, col) => (
                                      <span
                                        key={`wm-${row}-${col}`}
                                        className="absolute text-white/25 text-[9px] font-semibold rotate-[-25deg] whitespace-nowrap"
                                        style={{ top: `${15 + row * 28}%`, left: `${col * 55}%` }}
                                      >
                                        {authUserEmail || 'معهد الدراسات النفسية'}
                                      </span>
                                    ))
                                  ).flat()}
                                </div>
                              </div>
                            )
                        ) : (
                            <video
                              className="w-full h-full"
                              controls
                              // Same as the dashboard player: no download item in
                              // the browser's own menu, no picture-in-picture, no
                              // right-click «save video as».
                              controlsList="nodownload noplaybackrate noremoteplayback"
                              disablePictureInPicture
                              onContextMenu={e => e.preventDefault()}
                              src={revealVideoUrl(resolvedLectureUrl)}
                            />
                        )
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-5 relative">
                            {selectedLecture?.thumbnail ? (
                                <img loading="lazy" decoding="async" src={cdnImg(selectedLecture.thumbnail, 640)} className="absolute inset-0 h-full w-full object-cover opacity-25" alt="" />
                            ) : null}
                            <div className="relative z-10">
                                <Lock className="mx-auto mb-2 text-white/90" size={28} />
                                <p className="font-black text-white">{content['courseDetails.player.lockedTitle'] || 'هذه المحاضرة مقفولة في المعاينة المجانية'}</p>
                                <p className="mt-1 text-sm text-white/65">{content['courseDetails.player.lockedHint'] || 'احجز مكانك وافتح كل محاضرات البرنامج.'}</p>
                                <button
                                  onClick={onLockedLectureClick}
                                  className="mt-4 inline-flex min-h-[46px] items-center rounded-2xl bg-gold-light px-5 text-sm font-black text-ink shadow-lg transition hover:bg-gold-pale"
                                >
                                  🔓 احجز وافتح كل المحاضرات
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="max-h-[460px] space-y-2 overflow-auto overscroll-contain pl-1">
                    {chapters.length > 0 ? (() => {
                      const chaptersWithLectures = chapters.map((ch) => ({
                        chapter: ch,
                        lectures: lecturesWithLock.filter((l) => l.chapterId === ch.id),
                      }));
                      const uncategorized = lecturesWithLock.filter((l) => !l.chapterId || !chapters.some((ch) => ch.id === l.chapterId));
                      let globalIdx = 0;
                      return (
                        <>
                          {chaptersWithLectures.map(({ chapter, lectures: chLectures }) => chLectures.length > 0 && (
                            <div key={chapter.id}>
                              <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-paper px-3 py-2 text-xs font-extrabold text-ink ring-1 ring-line">
                                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary-700 text-[11px] font-black text-white">{chapter.order}</span>
                                {chapter.title}
                              </div>
                              {chLectures.map((lecture) => {
                                const idx = globalIdx++;
                                return (
                                  <div key={lecture.id} className="mb-1">{lectureRow(lecture, idx, 'مقفولة', 'شاهد الآن')}</div>
                                );
                              })}
                            </div>
                          ))}
                          {uncategorized.map((lecture) => {
                            const idx = globalIdx++;
                            return (
                              <React.Fragment key={lecture.id}>{lectureRow(lecture, idx, 'مقفولة', 'شاهد الآن')}</React.Fragment>
                            );
                          })}
                        </>
                      );
                    })() : lecturesWithLock.map((lecture, index) => (
                        <React.Fragment key={lecture.id}>{lectureRow(lecture, index, 'مقفولة', 'شاهد الآن')}</React.Fragment>
                    ))}
                </div>
            </div>
        )}

        {lectureGateNotice && (
            <div role="status" className="mt-3 rounded-xl bg-paper px-3 py-2.5 text-sm font-bold text-gold-deep ring-1 ring-line">
                {lectureGateNotice}
            </div>
        )}
    </section>
  );
};
