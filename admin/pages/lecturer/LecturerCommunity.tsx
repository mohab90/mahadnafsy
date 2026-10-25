import { useCallback, useEffect, useState } from 'react';
import { BookOpen, CalendarDays, Heart, MessageCircle, Pin, PlayCircle, Send, Trash2 } from 'lucide-react';
import { confirmDialog } from '../../../shared/ui/confirmDialog';
import { cairoDay } from '../../../shared/cairoDate';
import { errorText, lecturerApi, type CommunityPost, type Notify } from './lecturerApi';
import { Card, Empty, field, Loading, primaryButton } from './ui';

type Library = Awaited<ReturnType<typeof lecturerApi.communityLibrary>>;
type Videos = Awaited<ReturnType<typeof lecturerApi.communityVideos>>;
type Events = Awaited<ReturnType<typeof lecturerApi.communityEvents>>;

/**
 * «يشارك في المجتمع بكامل المحتوى»: everything the community has — the feed, the library, the videos, the events — and the
 * lecturer takes part with the «محاضر» badge: posts need no review, comments carry the badge. (Their free live is on the
 * lives tab.)
 */
export function LecturerCommunity({ notify, name }: { notify: Notify; name: string }) {
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [library, setLibrary] = useState<Library>([]);
  const [videos, setVideos] = useState<Videos>([]);
  const [events, setEvents] = useState<Events>([]);
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [comment, setComment] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    lecturerApi.communityPosts().then(setPosts).catch(error => { notify('error', errorText(error, 'تعذر تحميل المجتمع')); setPosts([]); });
  }, [notify]);
  useEffect(() => {
    load();
    lecturerApi.communityLibrary().then(setLibrary).catch(() => setLibrary([]));
    lecturerApi.communityVideos().then(setVideos).catch(() => setVideos([]));
    lecturerApi.communityEvents().then(setEvents).catch(() => setEvents([]));
  }, [load]);

  const run = async (key: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await work(); if (done) notify('success', done); load(); } catch (error) { notify('error', errorText(error)); } finally { setBusy(''); }
  };

  const publish = () => run('post', async () => { await lecturerApi.post({ title: draft.title, body: draft.body }); setDraft({ title: '', body: '' }); }, 'اتنشر المنشور');
  const send = (post: CommunityPost) => run(`c:${post.id}`, async () => { await lecturerApi.comment(post.id, comment[post.id] || ''); setComment(current => ({ ...current, [post.id]: '' })); });
  const removeComment = (commentId: string) => run(`x:${commentId}`, () => lecturerApi.deleteComment(commentId), 'اتمسح التعليق');
  const remove = async (post: CommunityPost) => { if (await confirmDialog('مسح المنشور ده؟')) await run(`d:${post.id}`, () => lecturerApi.deletePost(post.id), 'اتمسح المنشور'); };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <Card title="انشر في المجتمع" icon={<Send size={18} className="text-primary-600" />}>
          <input className={field} placeholder="عنوان المنشور" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
          <textarea rows={3} className={field} placeholder="اكتب للأعضاء…" value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} />
          <button type="button" className={primaryButton} disabled={busy === 'post' || !draft.title.trim() || !draft.body.trim()} onClick={() => void publish()}><Send size={15} /> انشر (بشارة «محاضر»)</button>
        </Card>
        {posts === null ? <Loading /> : posts.length === 0 ? <Empty>المجتمع لسه فاضي.</Empty> : posts.map(post => (
          <Card key={post.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex flex-wrap items-center gap-1.5 font-extrabold text-gray-900">{post.pinned && <Pin size={13} className="text-red-500" />}{post.title}</p>
                <p className="text-xs text-gray-500">
                  {post.authorName} {post.authorRole && <span className={`mr-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${post.authorRole === 'محاضر' ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600'}`}>{post.authorRole}</span>}
                  · {cairoDay(post.createdAt)}
                </p>
              </div>
              {post.authorRole === 'محاضر' && post.authorName === name && (
                <button type="button" aria-label="مسح المنشور" disabled={busy === `d:${post.id}`} onClick={() => void remove(post)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm text-gray-700">{post.body}</p>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <button type="button" className="inline-flex items-center gap-1 font-bold hover:text-red-600" onClick={() => void run(`l:${post.id}`, () => lecturerApi.like(post.id))}><Heart size={14} /> {post.likes || 0}</button>
              <span className="inline-flex items-center gap-1"><MessageCircle size={14} /> {post.commentsList.length}</span>
            </div>
            {post.commentsList.length > 0 && (
              <ul className="space-y-1.5 border-t border-gray-100 pt-3">
                {post.commentsList.map(item => (
                  <li key={item.id} className="flex items-start justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm">
                    <span><b className="text-gray-900">{item.author}</b> <span className="text-gray-700">{item.body}</span></span>
                    {((post.authorRole === 'محاضر' && post.authorName === name) || item.author === `${name} (محاضر)`) && (
                      <button type="button" aria-label="مسح التعليق" onClick={() => void removeComment(item.id)} className="shrink-0 rounded-lg p-1 text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input className={field} placeholder="اكتب تعليق…" value={comment[post.id] || ''} onChange={e => setComment({ ...comment, [post.id]: e.target.value })} />
              <button type="button" className={primaryButton} disabled={busy === `c:${post.id}` || !(comment[post.id] || '').trim()} onClick={() => void send(post)}>رد</button>
            </div>
          </Card>
        ))}
      </div>

      <aside className="space-y-5">
        <Card title="فعاليات" icon={<CalendarDays size={16} className="text-violet-600" />}>
          {events.length === 0 ? <p className="text-xs text-gray-400">مفيش فعاليات.</p> : events.slice(0, 6).map(event => (
            <p key={event.id} className="text-sm"><b className="text-gray-900">{event.title}</b> <span className="text-xs text-gray-500">{event.dateLabel || event.date_label}</span></p>
          ))}
        </Card>
        <Card title="فيديوهات" icon={<PlayCircle size={16} className="text-red-500" />}>
          {videos.length === 0 ? <p className="text-xs text-gray-400">مفيش فيديوهات.</p> : videos.slice(0, 6).map(video => (
            <a key={video.id} href={video.videoUrl || video.video_url || '#'} target="_blank" rel="noopener noreferrer" className="block text-sm font-bold text-primary-700 hover:underline">{video.title} {video.duration && <span className="text-xs font-normal text-gray-400">· {video.duration}</span>}</a>
          ))}
        </Card>
        <Card title="المكتبة" icon={<BookOpen size={16} className="text-emerald-600" />}>
          {library.length === 0 ? <p className="text-xs text-gray-400">المكتبة فاضية.</p> : library.slice(0, 8).map(item => (
            <a key={item.id} href={item.downloadUrl || '#'} target="_blank" rel="noopener noreferrer" className="block text-sm font-bold text-primary-700 hover:underline">{item.title} {item.fileType && <span className="text-xs font-normal text-gray-400">· {item.fileType}</span>}</a>
          ))}
        </Card>
      </aside>
    </div>
  );
}
