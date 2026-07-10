import React from 'react';
import { Lock } from 'lucide-react';
import type { CourseChapterItem, CourseLectureItem } from '../../types';

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
  getEmbedUrl: (url: string) => string;
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
  getEmbedUrl,
}) => {
  const handleLectureClick = (lecture: LockedLecture) => {
    if (lecture.locked) {
      setLectureGateNotice(content['courseDetails.player.lockedNotice'] || 'هذه المحاضرة غير متاحة على صلاحية Preview.');
      return;
    }
    setLectureGateNotice('');
    setSelectedLectureId(lecture.id);
  };

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <h2 className="text-2xl font-bold text-gray-900 border-r-4 border-primary-600 pr-3">{content['courseDetails.player.title'] || 'تشغيل المحاضرات'}</h2>
                                    <div className={`px-3 py-1 rounded-full text-xs font-bold ${subscriberLoading ? 'bg-gray-100 text-gray-400' : accessMode === 'full' ? 'bg-green-100 text-green-700' : accessMode === 'limited' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {subscriberLoading
                                                ? '⏳ جاري التحقق...'
                                                : accessMode === 'full'
                                                ? (content['courseDetails.player.fullBadge'] || 'صلاحية كاملة Full')
                                                : accessMode === 'limited'
                                                    ? (content['courseDetails.player.limitedBadge'] || `صلاحية Limited - عدد ${unlockedLectureCount} محاضرة`)
                                                    : (content['courseDetails.player.previewBadge'] || `صلاحية Preview - أول ${unlockedLectureCount} محاضرة`)}
            </div>
        </div>

        {lecturesWithLock.length === 0 && (
            <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-4">
                {content['courseDetails.player.empty'] || 'لا توجد محاضرات مضافة لهذا الكورس حتى الآن.'}
            </div>
        )}

        {lecturesWithLock.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
                <div
                    className="rounded-xl border border-gray-200 overflow-hidden bg-black aspect-video relative"
                    onContextMenu={(e) => e.preventDefault()}
                >
                    {selectedLecture && !selectedLecture.locked ? (
                        !resolvedLectureUrl ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white/70">
                                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mb-3"></div>
                                <p className="text-sm">جاري تحميل الفيديو...</p>
                            </div>
                        ) : (resolvedLectureUrl || '').includes('youtube.com') || (resolvedLectureUrl || '').includes('youtu.be') || (resolvedLectureUrl || '').startsWith('enc:') ? (
                            <div className="relative w-full h-full">
                              <iframe
                                src={getEmbedUrl(resolvedLectureUrl)}
                                className="w-full h-full"
                                allow="autoplay; encrypted-media; fullscreen"
                                allowFullScreen
                                title={selectedLecture.title}
                              />
                              {/* Block YouTube channel name (top-left) — pointer-events:auto prevents clicking it */}
                              <div className="absolute top-0 left-0 h-14 w-56 z-20 cursor-default" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.92) 60%, transparent)' }} onClick={(e) => e.preventDefault()} />
                              {/* Block YouTube logo (bottom-right) — pointer-events:auto prevents clicking it */}
                              <div className="absolute bottom-0 right-0 h-10 w-44 z-20 cursor-default" style={{ background: 'linear-gradient(to left, rgba(0,0,0,0.92) 60%, transparent)' }} onClick={(e) => e.preventDefault()} />
                              {/* Watermark */}
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
                        ) : (
                            <video className="w-full h-full" controls src={resolvedLectureUrl} />
                        )
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-5 relative">
                            {selectedLecture?.thumbnail ? (
                                <img loading="lazy" decoding="async" src={selectedLecture.thumbnail} className="absolute inset-0 w-full h-full object-cover opacity-30" alt="" />
                            ) : null}
                            <div className="relative z-10">
                                <Lock className="mx-auto mb-2 text-white/90" size={28} />
                                <p className="text-white font-bold">{content['courseDetails.player.lockedTitle'] || 'هذه المحاضرة مقفولة ضمن باقة Preview'}</p>
                                <p className="text-gray-200 text-sm mt-1">{content['courseDetails.player.lockedHint'] || 'للانتقال للمشاهدة الكاملة، قم بالترقية إلى Full.'}</p>
                                <button
                                  onClick={onLockedLectureClick}
                                  className="mt-4 bg-white text-primary-700 hover:bg-primary-50 font-bold px-5 py-2 rounded-xl text-sm transition shadow-lg"
                                >
                                  🔓 اشترك وافتح جميع المحاضرات
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="space-y-2 max-h-[420px] overflow-auto">
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
                              <div className="text-xs font-bold text-primary-700 bg-primary-50 px-3 py-1.5 rounded-lg mb-1.5 flex items-center gap-1">
                                <span className="w-5 h-5 bg-primary-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold">{chapter.order}</span>
                                {chapter.title}
                              </div>
                              {chLectures.map((lecture) => {
                                const idx = globalIdx++;
                                return (
                                  <button key={lecture.id} onClick={() => handleLectureClick(lecture)} className={`w-full text-right border rounded-xl p-3 transition mb-1 ${selectedLectureId === lecture.id ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-white'} ${lecture.locked ? 'opacity-80' : ''}`}>
                                    <div className="flex items-center justify-between gap-2">
                                      <div><p className="font-bold text-sm text-gray-800">{idx + 1}. {lecture.title}</p><p className="text-xs text-gray-500 mt-0.5">{lecture.duration} • {lecture.lectureType === 'live' ? 'Live' : 'Recorded'}</p></div>
                                      {lecture.locked ? <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700"><Lock size={12} />Locked</span> : <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">Open</span>}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                          {uncategorized.map((lecture) => {
                            const idx = globalIdx++;
                            return (
                              <button key={lecture.id} onClick={() => handleLectureClick(lecture)} className={`w-full text-right border rounded-xl p-3 transition ${selectedLectureId === lecture.id ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-white'} ${lecture.locked ? 'opacity-80' : ''}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div><p className="font-bold text-sm text-gray-800">{idx + 1}. {lecture.title}</p><p className="text-xs text-gray-500 mt-0.5">{lecture.duration} • {lecture.lectureType === 'live' ? 'Live' : 'Recorded'}</p></div>
                                  {lecture.locked ? <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700"><Lock size={12} />Locked</span> : <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">Open</span>}
                                </div>
                              </button>
                            );
                          })}
                        </>
                      );
                    })() : lecturesWithLock.map((lecture, index) => (
                        <button
                          key={lecture.id}
                          onClick={() => handleLectureClick(lecture)}
                          className={`w-full text-right border rounded-xl p-3 transition ${selectedLectureId === lecture.id ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-white'} ${lecture.locked ? 'opacity-80' : ''}`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <p className="font-bold text-sm text-gray-800">{index + 1}. {lecture.title}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">{lecture.duration} • {lecture.lectureType === 'live' ? 'Live' : 'Recorded'}</p>
                                </div>
                                {lecture.locked ? (
                                    <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700"><Lock size={12} />مقفل</span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">مفتوح</span>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        )}

        {lectureGateNotice && (
            <div className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {lectureGateNotice}
            </div>
        )}
    </section>
  );
};
