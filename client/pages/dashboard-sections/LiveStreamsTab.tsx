import React from 'react';
import { Radio, User, Calendar, Video } from 'lucide-react';

interface LiveStreamsTabProps {
  upcomingLives: any[];
}

export const LiveStreamsTab: React.FC<LiveStreamsTabProps> = ({ upcomingLives }) => {
  const nextLive = upcomingLives.find(ls => ls.status === 'live') || upcomingLives.filter(ls => ls.status === 'upcoming').sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
  
  return (
    <div className="max-w-2xl space-y-4">
      <h3 className="font-extrabold text-gray-800 text-base flex items-center gap-2">
        <Radio size={18} className="text-primary-600" /> البث المباشر
      </h3>
      {upcomingLives.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm">
          <Radio size={40} className="text-gray-200 mx-auto mb-4" />
          <p className="text-gray-500 font-bold">لا توجد بثوث مباشرة قادمة حالياً</p>
        </div>
      ) : (
        <>
          {nextLive && (
            <div className={`rounded-2xl p-5 text-white ${nextLive.status === 'live' ? 'bg-gradient-to-l from-red-700 to-red-900' : 'bg-gradient-to-l from-primary-700 to-primary-900'}`}>
              <div className="flex items-center gap-2 mb-3">
                {nextLive.status === 'live' ? <span className="flex items-center gap-1.5 text-xs font-bold bg-white/20 px-3 py-1 rounded-full"><span className="w-2 h-2 rounded-full bg-white animate-pulse" />🔴 مباشر الآن</span> : <span className="text-xs font-bold bg-white/20 px-3 py-1 rounded-full">📅 البث القادم</span>}
              </div>
              <h4 className="font-extrabold text-lg mb-1">{nextLive.title}</h4>
              <div className="flex flex-wrap gap-3 text-white/80 text-sm mb-4">
                <span className="flex items-center gap-1"><User size={14} />{nextLive.instructorName}</span>
                <span className="flex items-center gap-1"><Calendar size={14} />{nextLive.scheduledAt.replace('T', ' ').slice(0, 16)}</span>
                {nextLive.durationMinutes && <span>{nextLive.durationMinutes} دقيقة</span>}
              </div>
              {nextLive.description && <p className="text-white/70 text-sm mb-4">{nextLive.description}</p>}
              <a href={nextLive.streamUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-white text-primary-800 font-extrabold px-6 py-3 rounded-xl hover:bg-white/90 transition text-sm">
                <Video size={16} /> {nextLive.status === 'live' ? 'انضم الآن للبث المباشر' : 'رابط البث'}
              </a>
            </div>
          )}
          <div className="space-y-3">
            {upcomingLives.filter(ls => ls.id !== nextLive?.id).map(ls => (
              <div key={ls.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${ls.status === 'live' ? 'bg-red-100' : 'bg-blue-100'}`}>
                  <Radio size={18} className={ls.status === 'live' ? 'text-red-600' : 'text-blue-600'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-800 text-sm">{ls.title}</p>
                  <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                    <span><User size={11} className="inline ml-0.5" />{ls.instructorName}</span>
                    <span><Calendar size={11} className="inline ml-0.5" />{ls.scheduledAt.replace('T', ' ').slice(0, 16)}</span>
                  </div>
                </div>
                <a href={ls.streamUrl} target="_blank" rel="noopener noreferrer"
                  className="flex-shrink-0 text-xs bg-primary-50 text-primary-700 font-bold px-3 py-1.5 rounded-lg hover:bg-primary-100 transition">
                  🔗 رابط
                </a>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
