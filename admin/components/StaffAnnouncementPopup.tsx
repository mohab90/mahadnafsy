import React, { useCallback, useEffect, useState } from 'react';
import { Megaphone, PartyPopper, Siren, X } from 'lucide-react';
import { mysqlAdmin } from '../lib/mysqlapi';
import { popupImage, popupVideo } from '../../shared/siteOffers';
import { useVisibleInterval } from '../../shared/useVisibleInterval';
import { useEscapeKey } from '../../shared/ui/useEscapeKey';

/**
 * A message from the administration, drawn over whatever the employee is doing (api/routes/staff-announcements.js).
 *
 * «في قسم الإدارة أبعت رسالة فيديو أو صور أو كلام بشكل مميز يظهر بوب أب للموظفين». It comes up when the system opens and is
 * asked for again every few minutes while the tab is in front, one message at a time, and stays until the employee closes it —
 * closing is remembered on the server, so it does not come back on the next sign-in.
 */
export type StaffAnnouncement = {
  id: string; title: string; body: string; images: string[]; videoUrl: string;
  style: 'info' | 'urgent' | 'celebrate'; createdAt: string; createdByName: string;
};

export const ANNOUNCEMENT_LOOKS: Record<StaffAnnouncement['style'], { name: string; bg: string; accent: string; ink: string; Icon: typeof Megaphone }> = {
  info:      { name: 'عادي',  bg: 'linear-gradient(135deg,#1e1b4b 0%,#4338ca 55%,#7c3aed 100%)', accent: '#fbbf24', ink: '#1e1b4b', Icon: Megaphone },
  urgent:    { name: 'مهم',   bg: 'linear-gradient(135deg,#7f1d1d 0%,#dc2626 55%,#f59e0b 100%)', accent: '#fde68a', ink: '#7f1d1d', Icon: Siren },
  celebrate: { name: 'تهنئة', bg: 'linear-gradient(135deg,#064e3b 0%,#059669 55%,#14b8a6 100%)', accent: '#fde047', ink: '#064e3b', Icon: PartyPopper },
};

/** The card itself — shared with the preview in the administration's compose screen. */
export const AnnouncementCard: React.FC<{
  item: Pick<StaffAnnouncement, 'title' | 'body' | 'images' | 'videoUrl' | 'style'> & { createdByName?: string };
  onClose?: () => void; closeLabel?: string; footer?: React.ReactNode;
}> = ({ item, onClose, closeLabel = 'تمام، فهمت', footer }) => {
  const look = ANNOUNCEMENT_LOOKS[item.style] || ANNOUNCEMENT_LOOKS.info;
  const video = popupVideo(item.videoUrl);
  const images = item.images.map(popupImage).filter(Boolean);
  const [shown, setShown] = useState(0);
  const picture = images[Math.min(shown, images.length - 1)];
  const { Icon } = look;
  return (
    <div className="relative w-full max-w-lg overflow-hidden rounded-[28px] text-white shadow-[0_30px_80px_-10px_rgba(0,0,0,.6)]" style={{ background: look.bg }} dir="rtl">
      <style>{'@keyframes announceRise{from{opacity:0;transform:translateY(24px) scale(.94)}to{opacity:1;transform:none}}'}</style>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="إغلاق" className="absolute left-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 hover:bg-black/50">
          <X size={18} />
        </button>
      )}
      {video && (
        <div className="relative aspect-video w-full bg-black">
          {video.kind === 'frame'
            ? <iframe src={video.src} title={item.title} className="absolute inset-0 h-full w-full border-0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
            : <video src={video.src} controls playsInline preload="metadata" className="absolute inset-0 h-full w-full bg-black object-contain" />}
        </div>
      )}
      {!video && picture && <img src={picture} alt={item.title} className="block max-h-72 w-full object-cover" />}
      {!video && images.length > 1 && (
        <div className="flex justify-center gap-1.5 bg-black/20 px-3 py-2">
          {images.map((src, index) => (
            <button key={src} type="button" onClick={() => setShown(index)} aria-label={`صورة ${index + 1}`}
              className={`h-12 w-12 overflow-hidden rounded-lg border-2 ${index === shown ? 'border-white' : 'border-transparent opacity-70'}`}>
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="px-5 pb-5 pt-5 text-center sm:px-7">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-extrabold">
          <Icon size={13} style={{ color: look.accent }} /> رسالة من الإدارة{item.createdByName ? ` — ${item.createdByName}` : ''}
        </div>
        <h2 className="mb-2 text-balance text-2xl font-black leading-snug">{item.title}</h2>
        {item.body && <p className="mb-4 max-h-[40vh] overflow-y-auto whitespace-pre-line text-[15px] leading-7 text-white/90">{item.body}</p>}
        {footer}
        {onClose && (
          <button type="button" onClick={onClose} className="mt-1 flex min-h-[52px] w-full items-center justify-center rounded-2xl px-5 text-lg font-black shadow-xl transition active:scale-95"
            style={{ background: look.accent, color: look.ink }}>{closeLabel}</button>
        )}
      </div>
    </div>
  );
};

const StaffAnnouncementPopup: React.FC = () => {
  const [queue, setQueue] = useState<StaffAnnouncement[]>([]);
  const [closing, setClosing] = useState(false);

  const load = useCallback(() => {
    mysqlAdmin.adminGet<{ items: StaffAnnouncement[] }>('/staff/announcements/pending')
      .then(result => setQueue(Array.isArray(result?.items) ? result.items : []))
      .catch(() => { /* an announcement is never worth an error on the employee's screen */ });
  }, []);
  useEffect(() => { load(); }, [load]);
  useVisibleInterval(load, 5 * 60 * 1000);

  const current = queue[0];
  const close = useCallback(async () => {
    if (!current || closing) return;
    setClosing(true);
    // Gone from the screen at once; the server is told in the background. If that fails it simply shows again next time.
    setQueue(list => list.filter(item => item.id !== current.id));
    try { await mysqlAdmin.adminPost(`/staff/announcements/${encodeURIComponent(current.id)}/seen`, {}); } catch { /* shown again next time */ }
    setClosing(false);
  }, [current, closing]);
  useEscapeKey(() => { void close(); }, Boolean(current));

  if (!current) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={current.title}>
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <div className="relative flex max-h-full w-full justify-center overflow-y-auto motion-safe:animate-[announceRise_.4s_ease-out]">
        <AnnouncementCard item={current} onClose={() => void close()}
          closeLabel={queue.length > 1 ? `تمام — الرسالة اللي بعدها (${queue.length - 1})` : 'تمام، فهمت'} />
      </div>
    </div>
  );
};

export default StaffAnnouncementPopup;
