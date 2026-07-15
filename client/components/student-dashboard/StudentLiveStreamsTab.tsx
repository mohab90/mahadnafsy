import React from 'react';
import { Calendar, Radio, User, Video } from 'lucide-react';
import type { LiveStream } from '../../types';

interface StudentLiveStreamsTabProps {
  upcomingLives: LiveStream[];
}

const formatLiveDate = (value: string) => value.replace('T', ' ').slice(0, 16);

export const StudentLiveStreamsTab: React.FC<StudentLiveStreamsTabProps> = ({ upcomingLives }) => {
  const nextLive =
    upcomingLives.find((live) => live.status === 'live') ||
    upcomingLives
      .filter((live) => live.status === 'upcoming')
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];

  return (
    <div className="max-w-2xl space-y-4">
      <h3 className="font-extrabold text-gray-800 text-base flex items-center gap-2">
        <Radio size={18} className="text-primary-600" /> البث المباشر
      </h3>

      {upcomingLives.length === 0 ? (
        <div className="rounded-2xl border border-white/50 p-12 text-center glass-card-premium shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-primary-500/20 transition-all duration-300 hover:-translate-y-2 backdrop-blur-xl bg-white/70">
          <Radio size={40} className="text-gray-200 mx-auto mb-4" />
          <p className="text-gray-500 font-bold">لا توجد بثوث مباشرة قادمة حاليا</p>
        </div>
      ) : (
        <>
          {nextLive && (
            <div className={`rounded-2xl p-5 text-white ${nextLive.status === 'live' ? 'bg-gradient-to-l from-red-700 to-red-900' : 'bg-gradient-to-l from-primary-700 to-primary-900'}`}>
              <div className="flex items-center gap-2 mb-3">
                {nextLive.status === 'live' ? (
                  <span className="flex items-center gap-1.5 text-xs font-bold bg-white/20 px-3 py-1 rounded-full">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                    مباشر الآن
                  </span>
                ) : (
                  <span className="text-xs font-bold bg-white/20 px-3 py-1 rounded-full">البث القادم</span>
                )}
              </div>
              <h4 className="font-extrabold text-lg mb-1">{nextLive.title}</h4>
              <div className="flex flex-wrap gap-3 text-white/80 text-sm mb-4">
                <span className="flex items-center gap-1"><User size={14} />{nextLive.instructorName}</span>
                <span className="flex items-center gap-1"><Calendar size={14} />{formatLiveDate(nextLive.scheduledAt)}</span>
                {nextLive.durationMinutes && <span>{nextLive.durationMinutes} دقيقة</span>}
              </div>
              {nextLive.description && <p className="text-white/70 text-sm mb-4">{nextLive.description}</p>}
              <a
                href={nextLive.streamUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-white text-primary-800 font-extrabold px-6 py-3 rounded-xl hover:bg-white/90 transition text-sm"
              >
                <Video size={16} /> {nextLive.status === 'live' ? 'انضم الآن للبث المباشر' : 'رابط البث'}
              </a>
            </div>
          )}

          <div className="space-y-3">
            {upcomingLives.filter((live) => live.id !== nextLive?.id).map((live) => (
              <div key={live.id} className="rounded-2xl border border-white/50 p-4 flex items-center gap-4 glass-card-premium shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-primary-500/20 transition-all duration-300 hover:-translate-y-2 backdrop-blur-xl bg-white/70">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${live.status === 'live' ? 'bg-red-100' : 'bg-blue-100'}`}>
                  <Radio size={18} className={live.status === 'live' ? 'text-red-600' : 'text-blue-600'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-800 text-sm">{live.title}</p>
                  <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                    <span><User size={11} className="inline ml-0.5" />{live.instructorName}</span>
                    <span><Calendar size={11} className="inline ml-0.5" />{formatLiveDate(live.scheduledAt)}</span>
                  </div>
                </div>
                <a
                  href={live.streamUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-xs bg-primary-50 text-primary-700 font-bold px-3 py-1.5 rounded-lg hover:bg-primary-100 transition"
                >
                  رابط
                </a>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
