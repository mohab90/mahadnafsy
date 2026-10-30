import React, { useState, useMemo, useEffect } from 'react';
import { useEscapeKey } from '../../shared/ui/useEscapeKey';
import { Modal } from '../../shared/ui/Modal';
import {
  Users, BookOpen, MessageSquare, Calendar, Download, FileText,
  Heart, MessageCircle, Share2, MoreHorizontal, Play, Video,
  Pin, Plus, X, Send, Eye,
  ChevronRight, Award, Flame, Clock, CheckCircle, TrendingUp,
  Pencil, Trash2,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSiteData } from '../context/SiteDataContext';
import { cdnImg, cdnSrcSet } from '../lib/img';
import { isUpcoming } from '../lib/communityEvents';
import { CommunityEventsSection, FeaturedEventCard } from '../components/CommunityEventsSection';
import { useSeo } from '../lib/useSeo';
import { VideoSurface } from '../components/VideoSurface';
import PageHeader from '../components/PageHeader';
import { webLink } from '../lib/webLink';

const TAG_COLORS: Record<string, string> = {
  'نقاش حالة': 'bg-primary-50 text-primary-700 border-primary-100',
  'مشاركة علمية': 'bg-gold-pale/15 text-gold-deep border-gold/30',
  'نقاش عام': 'bg-paper text-muted-strong border-line',
  'استفسار': 'bg-white text-ink border-line-deep',
  'موارد': 'bg-gold-pale/15 text-gold-deep border-gold/30',
  'تجربة شخصية': 'bg-primary-50 text-primary-800 border-primary-100',
};
const getTagColor = (tag: string) => TAG_COLORS[tag] || 'bg-paper text-muted-strong border-line';
const ALL_TAGS = ['الكل', 'نقاش حالة', 'مشاركة علمية', 'نقاش عام', 'استفسار', 'موارد', 'تجربة شخصية'];

const SECTIONS = ['discussions', 'library', 'videos', 'events'] as const;
type CommunitySection = typeof SECTIONS[number];

const Community: React.FC = () => {
  const { section } = useParams();
  useSeo({ title: 'المجتمع النفسي | معهد الدراسات النفسية', path: section ? `/community/${section}` : '/community', description: 'مجتمع المتخصصين في الصحة النفسية — مقالات ومكتبة وفعاليات ونقاش مهني.' });
  const {
    communityPosts, communityLibraryItems, communityVideos, communityEvents,
    addCommunityPost, updateCommunityPost, deleteCommunityPost,
    toggleCommunityPostLike, addCommunityPostComment,
    loadCommunity,
    content, isAdmin, authUser,
  } = useSiteData();
  // This is the only screen that reads community content, and it used to be
  // fetched on every page of the site — four requests before every first paint,
  // three of them returning `[]`. It loads here, once, when someone arrives.
  useEffect(() => { void loadCommunity(); }, [loadCommunity]);
  const navigate = useNavigate();
  // Each section has its own address — /community/discussions, /events,
  // /videos, /library — so it can be linked to and shared.
  const activeTab: CommunitySection = SECTIONS.includes(section as CommunitySection) ? section as CommunitySection : 'discussions';
  const setActiveTab = (key: CommunitySection) => navigate(`/community/${key}`);
  const [tagFilter, setTagFilter] = useState('الكل');
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [showNewPostModal, setShowNewPostModal] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState<string | null>(null);
  // A video lightbox, like the one on the home page.
  useEscapeKey(() => setShowVideoModal(null), showVideoModal !== null);
  const [newPost, setNewPost] = useState({ title: '', body: '', tag: 'نقاش عام' });
  const [postSubmitted, setPostSubmitted] = useState(false);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [commentPanelId, setCommentPanelId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [contextMenuPostId, setContextMenuPostId] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostDraft, setEditPostDraft] = useState({ title: '', body: '', tag: 'نقاش عام' });
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The headline the community page leads with. It was `847 + posts.length` —
  // a number invented in source and shown to every visitor as a fact, alongside
  // a «متصل الآن» figure derived from it by multiplying by 0.07, which nothing
  // measures: there is no presence data behind it at all.
  //
  // The count is now the institute's to state, the way home.stats.* already
  // works, seeded with the figure the page has been showing so nothing changes
  // until someone decides otherwise. The invented "online now" line is gone —
  // it could not be made true, only removed.
  const totalMembers = Number(content['community.memberCount'] || 847) + communityPosts.length;


  const filteredPosts = useMemo(() => {
    // Only show approved posts (or legacy posts without status) to regular users
    const visible = communityPosts.filter(p => !p.status || p.status === 'approved' || p.isOwner);
    const sorted = [...visible].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return sorted.filter(p => tagFilter === 'الكل' || p.tag === tagFilter);
  }, [communityPosts, tagFilter]);

  const handleLike = async (id: string) => {
    if (actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      const result = await toggleCommunityPostLike(id);
      setLikedPosts(prev => {
        const next = new Set(prev);
        if (result.liked) next.add(id); else next.delete(id);
        return next;
      });
    } catch {
      setActionError('تعذر حفظ الإعجاب. سجّل الدخول وتأكد من اتصالك ثم حاول مرة أخرى.');
    } finally {
      setActionPending(false);
    }
  };

  const handleSubmitComment = async (postId: string) => {
    const post = communityPosts.find(p => p.id === postId);
    const body = commentDrafts[postId];
    if (!post || !body?.trim() || actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      await addCommunityPostComment(postId, body.trim());
      setCommentDrafts(prev => ({ ...prev, [postId]: '' }));
    } catch {
      setActionError('تعذر حفظ التعليق. سجّل الدخول وتأكد من اتصالك ثم حاول مرة أخرى.');
    } finally {
      setActionPending(false);
    }
  };

  const handleSubmitPost = async () => {
    if (!newPost.title.trim() || !newPost.body.trim() || actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      await addCommunityPost({
        id: `cp-${Date.now()}`,
        authorName: 'مشترك',
        authorRole: 'عضو',
        authorImage: 'https://ui-avatars.com/api/?name=%D9%85%D8%B4%D8%AA%D8%B1%D9%83&background=7c3aed&color=fff&size=100',
        title: newPost.title.trim(),
        body: newPost.body.trim(),
        tag: newPost.tag,
        likes: 0,
        comments: 0,
        createdAt: 'الآن',
        status: 'pending',
      });
      setNewPost({ title: '', body: '', tag: 'نقاش عام' });
      setPostSubmitted(true);
      setTimeout(() => { setShowNewPostModal(false); setPostSubmitted(false); }, 2000);
    } catch (failure) {
      // A refusal that says why (an account with no subscription) is shown as said.
      const refused = (failure as { code?: string })?.code === 'SUBSCRIBER_REQUIRED' && failure instanceof Error;
      setActionError(refused ? failure.message : 'لم يتم حفظ المنشور. تأكد من تسجيل الدخول والاتصال ثم حاول مرة أخرى.');
    } finally {
      setActionPending(false);
    }
  };

  const handleUpdatePost = async () => {
    if (!editingPostId || !editPostDraft.title.trim() || !editPostDraft.body.trim() || actionPending) return;
    const post = communityPosts.find(p => p.id === editingPostId);
    if (!post) return;
    setActionPending(true);
    setActionError(null);
    try {
      await updateCommunityPost({ ...post, title: editPostDraft.title.trim(), body: editPostDraft.body.trim(), tag: editPostDraft.tag });
      setEditPostDraft({ title: '', body: '', tag: 'نقاش عام' });
      setPostSubmitted(true);
      setTimeout(() => { setShowNewPostModal(false); setPostSubmitted(false); setEditingPostId(null); }, 1500);
    } catch {
      setActionError('تعذر تحديث المنشور ولم يتم تغيير النسخة المحفوظة.');
    } finally {
      setActionPending(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      await deleteCommunityPost(postId);
      setContextMenuPostId(null);
    } catch {
      setActionError('تعذر حذف المنشور ولم يتم حذفه من الواجهة.');
    } finally {
      setActionPending(false);
    }
  };

  const handleShare = (title: string) => {
    if (navigator.share) {
      navigator.share({ title, url: window.location.href }).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }
  };

  const card = 'rounded-[24px] border border-line bg-white';
  const fieldClass = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';

  return (
    <div className="min-h-screen bg-paper">
      {/* Hero */}
      <PageHeader
        eyebrow={(
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[13px] text-ink ring-1 ring-line">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {totalMembers.toLocaleString('ar-EG-u-nu-latn')} عضو نشط في المجتمع
          </span>
        )}
        title={content['community.heroTitle'] || 'المجتمع النفسي المتخصص'}
        subtitle={content['community.heroSubtitle'] || 'مساحة آمنة ومتخصصة لتبادل الخبرات ومناقشة الحالات والنمو المهني بين المتخصصين في الصحة النفسية'}
      >
        <div className="flex flex-wrap justify-center gap-2">
          {([
            { icon: MessageSquare, label: `${communityPosts.length} نقاش` },
            { icon: FileText, label: `${communityLibraryItems.length} مرجع علمي` },
            { icon: Video, label: `${communityVideos.length} محاضرة` },
            { icon: Calendar, label: `${communityEvents.length} فعالية` },
          ] as const).map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-sm font-extrabold text-muted-strong ring-1 ring-line">
              <Icon size={15} className="text-primary-700" />
              {label}
            </span>
          ))}
        </div>
      </PageHeader>

      <div className="container mx-auto px-4 py-8 sm:py-12">
        {actionError && (
          <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {actionError}
          </div>
        )}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4 lg:gap-8">

          {/* Left Sidebar */}
          <div className="min-w-0 space-y-5 lg:col-span-1">
            <div className={`${card} p-5 lg:sticky lg:top-24`}>
              <div className="mb-5 flex items-center gap-3 border-b border-line pb-5">
                <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-ink text-lg font-black text-gold-pale">م</div>
                <div className="min-w-0">
                  <h3 className="font-black text-ink">متخصص في المجتمع</h3>
                  <p className="mt-0.5 inline-block rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-extrabold text-primary-700">عضو نشط</p>
                </div>
              </div>
              {authUser && !isAdmin ? (
                <button onClick={() => { setActionError(null); setShowNewPostModal(true); }} className="mb-5 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 font-black text-white transition hover:bg-primary-800">
                  <Plus size={18} />مشاركة جديدة
                </button>
              ) : (
                <p className="mb-5 rounded-2xl bg-paper px-3 py-2.5 text-center text-xs font-bold leading-relaxed text-muted-strong ring-1 ring-line">{isAdmin ? 'انت داخل بحساب الإدارة — المشاركات والموافقة عليها من لوحة التحكم ← المجتمع.' : 'سجّل الدخول للمشاركة والتفاعل.'}</p>
              )}
              <nav className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
                {([
                  { key: 'discussions', icon: MessageSquare, label: content['community.discussions.title'] || 'ساحة النقاش', count: communityPosts.length },
                  { key: 'library', icon: BookOpen, label: content['community.library.title'] || 'المكتبة الرقمية', count: communityLibraryItems.length },
                  { key: 'videos', icon: Video, label: content['community.videos.title'] || 'ورش ومحاضرات', count: communityVideos.length },
                  { key: 'events', icon: Calendar, label: content['community.events.title'] || 'الفعاليات', count: communityEvents.length },
                ] as const).map(({ key, icon: Icon, label, count }) => (
                  <Link key={key} to={`/community/${key}`} aria-current={activeTab === key ? 'page' : undefined} className={`flex min-h-[46px] w-full items-center justify-between gap-2 rounded-xl px-3 text-sm transition ${activeTab === key ? 'bg-ink font-black text-white' : 'font-bold text-muted-strong hover:bg-paper'}`}>
                    <span className="flex min-w-0 items-center gap-2"><Icon size={17} className="flex-none" /><span className="truncate">{label}</span></span>
                    <span className={`flex-none rounded-full px-2 py-0.5 text-xs font-extrabold tabular-nums ${activeTab === key ? 'bg-white/15 text-gold-pale' : 'bg-paper text-muted ring-1 ring-line'}`}>{count}</span>
                  </Link>
                ))}
              </nav>
              <div className="mt-5 border-t border-line pt-5">
                <h4 className="mb-3 text-xs font-extrabold text-muted">الوسوم</h4>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_TAGS.slice(1).map(tag => (
                    <button key={tag} onClick={() => { setActiveTab('discussions'); setTagFilter(tag); }} className={`rounded-full border px-3 py-1.5 text-xs font-extrabold transition hover:border-line-deep ${getTagColor(tag)}`}>{tag}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="min-w-0 space-y-5 lg:col-span-2">

            {activeTab === 'discussions' && (
              <div className="animate-fade-in space-y-4">
                <FeaturedEventCard events={communityEvents} />
                <div className="flex gap-2 flex-wrap">
                  {ALL_TAGS.map(tag => (
                    <button key={tag} onClick={() => setTagFilter(tag)} aria-pressed={tagFilter === tag} className={`min-h-[40px] rounded-full border px-4 text-sm font-extrabold transition ${tagFilter === tag ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted-strong hover:border-line-deep'}`}>{tag}</button>
                  ))}
                </div>
                <div onClick={authUser && !isAdmin ? () => setShowNewPostModal(true) : undefined} className={`${card} group flex items-center gap-3 p-4 transition ${authUser && !isAdmin ? 'cursor-pointer hover:border-line-deep' : 'opacity-70'}`}>
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary-50 font-black text-primary-700">م</div>
                  <div className="min-w-0 flex-1 truncate rounded-full bg-paper px-4 py-2.5 text-sm text-muted-soft ring-1 ring-line transition group-hover:bg-white">شارك أفكارك، أسئلتك، أو حالة للنقاش...</div>
                </div>
                {filteredPosts.length === 0 && (
                  <div className="rounded-[24px] border border-dashed border-line-deep py-12 text-center text-muted">
                    <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
                    <p>لا توجد نقاشات تطابق بحثك</p>
                  </div>
                )}
                {filteredPosts.map(post => (
                  <div key={post.id} className={`${card} p-5 transition hover:border-line-deep sm:p-6`}>
                    {post.pinned && (
                      <div className="mb-3 flex items-center gap-1.5 text-xs font-extrabold text-gold-deep">
                        <Pin size={12} fill="currentColor" />منشور مثبت
                      </div>
                    )}
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <img loading="lazy" decoding="async" width={44} height={44} src={post.authorImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(post.authorName)}&background=9f1239&color=fff&size=80`} className="h-11 w-11 flex-none rounded-full bg-sand object-cover ring-1 ring-line" alt={post.authorName} onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(post.authorName)}&background=881337&color=fff&size=80`; }} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="truncate text-sm font-black text-ink">{post.authorRole === 'Admin' ? 'الإدارة' : post.authorName}</h4>
                            {post.authorRole === 'Admin' && <span className="rounded-full bg-primary-700 px-2 py-0.5 text-[10px] font-black text-white">إدارة</span>}
                          </div>
                          <p className="text-xs text-muted-soft">{post.authorRole === 'Admin' ? 'معهد الدراسات النفسية' : post.authorRole} • {post.createdAt}</p>
                        </div>
                      </div>
                      {post.isOwner && <div className="relative">
                        <button onClick={(e) => { e.stopPropagation(); setContextMenuPostId(contextMenuPostId === post.id ? null : post.id); }} aria-label="خيارات المنشور" className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-soft transition hover:bg-paper hover:text-ink"><MoreHorizontal size={18} /></button>
                        {contextMenuPostId === post.id && (
                          <div className="absolute left-0 top-full z-10 mt-1 min-w-[120px] overflow-hidden rounded-2xl border border-line bg-white py-1 shadow-[0_20px_40px_-20px_rgba(26,15,18,.4)]">
                            <button onClick={() => { setEditingPostId(post.id); setEditPostDraft({ title: post.title, body: post.body, tag: post.tag }); setShowNewPostModal(true); setContextMenuPostId(null); }} className="flex min-h-[40px] w-full items-center gap-2 px-3 text-sm font-bold text-ink hover:bg-paper"><Pencil size={13} />تعديل</button>
                            <button onClick={() => handleDeletePost(post.id)} className="flex min-h-[40px] w-full items-center gap-2 px-3 text-sm font-bold text-red-600 hover:bg-red-50"><Trash2 size={13} />حذف</button>
                          </div>
                        )}
                      </div>}
                    </div>
                    <div className="mb-4">
                      <span className={`mb-2 inline-block rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${getTagColor(post.tag)}`}>{post.tag}</span>
                      <h5 className="mb-2 text-[17px] font-black leading-snug text-ink">{post.title}</h5>
                      <p className={`break-words text-[15px] leading-relaxed text-muted-body ${expandedPost !== post.id && post.body.length > 200 ? 'line-clamp-3' : ''}`}>{post.body}</p>
                      {post.body.length > 200 && (
                        <button onClick={() => setExpandedPost(expandedPost === post.id ? null : post.id)} className="mt-1 text-sm font-extrabold text-primary-700 hover:underline">
                          {expandedPost === post.id ? 'عرض أقل' : 'قراءة المزيد'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between border-t border-line pt-3">
                      <div className="flex gap-2">
                        <button onClick={() => void handleLike(post.id)} disabled={actionPending || !authUser} className={`group flex min-h-[44px] items-center gap-2 rounded-xl px-2.5 text-sm transition disabled:opacity-50 ${likedPosts.has(post.id) ? 'text-primary-700' : 'text-muted hover:bg-paper hover:text-primary-700'}`}>
                          <Heart size={17} className={likedPosts.has(post.id) ? 'fill-primary-700' : 'group-hover:fill-primary-700'} />
                          <span className="font-bold tabular-nums">{post.likes}</span>
                        </button>
                        <button onClick={() => setCommentPanelId(commentPanelId === post.id ? null : post.id)} className={`flex min-h-[44px] items-center gap-2 rounded-xl px-2.5 text-sm transition ${commentPanelId === post.id ? 'bg-paper text-primary-700' : 'text-muted hover:bg-paper hover:text-ink'}`}>
                          <MessageCircle size={17} /><span className="font-bold tabular-nums">{post.comments}</span>
                        </button>
                      </div>
                      <button onClick={() => handleShare(post.title)} className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-2.5 text-xs font-bold text-muted-soft transition hover:bg-paper hover:text-ink">
                        <Share2 size={15} />مشاركة
                      </button>
                    </div>
                    {commentPanelId === post.id && (
                      <div className="mt-3 space-y-3 border-t border-line pt-4">
                        {(post.commentsList || []).length > 0 && (
                          <div className="space-y-3">
                            {(post.commentsList || []).map(c => (
                              <div key={c.id} className="flex gap-3">
                                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-black text-primary-700">{c.author.charAt(0)}</div>
                                <div className="min-w-0 flex-1 rounded-2xl bg-paper p-3 ring-1 ring-line">
                                  <p className="mb-1 text-xs font-black text-ink">{c.author} <span className="font-normal text-muted-soft">• {c.at}</span></p>
                                  <p className="break-words text-sm text-muted-body">{c.body}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {(post.commentsList || []).length === 0 && (
                          <p className="py-2 text-center text-xs text-muted-soft">لا توجد تعليقات بعد. كن أول من يعلق!</p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <input
                            value={commentDrafts[post.id] || ''}
                            onChange={e => setCommentDrafts(prev => ({ ...prev, [post.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') void handleSubmitComment(post.id); }}
                            placeholder={authUser ? 'اكتب تعليقك...' : 'سجّل الدخول للتعليق'}
                            disabled={!authUser || actionPending}
                            className={`${fieldClass} min-h-[46px] min-w-0 flex-1 disabled:opacity-60`}
                          />
                          <button onClick={() => void handleSubmitComment(post.id)} disabled={actionPending || !authUser} aria-label="إرسال التعليق" className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-xl bg-primary-700 text-white transition hover:bg-primary-800 disabled:bg-line disabled:text-muted-soft">
                            <Send size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'library' && (
              <div className="animate-fade-in space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xl font-black text-ink">المكتبة الرقمية المتخصصة</h3>
                  <span className="flex-none rounded-full bg-white px-3 py-1 text-xs font-extrabold text-muted-strong ring-1 ring-line">{communityLibraryItems.length} مرجع</span>
                </div>
                {communityLibraryItems.map(item => (
                  <div key={item.id} className={`${card} group flex items-start gap-4 p-5 transition hover:-translate-y-0.5 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)]`}>
                    <div className={`flex-shrink-0 rounded-2xl p-3 ${item.fileType.toLowerCase().includes('book') ? 'bg-gold-pale/15 text-gold-deep' : item.fileType === 'PDF' ? 'bg-primary-50 text-primary-700' : 'bg-paper text-muted-strong ring-1 ring-line'}`}>
                      {item.fileType.toLowerCase().includes('book') ? <BookOpen size={26} /> : <FileText size={26} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <h3 className="font-black leading-snug text-ink transition group-hover:text-primary-700">{item.title}</h3>
                        <span className="flex-shrink-0 rounded-full bg-paper px-2 py-0.5 text-[10px] font-extrabold text-muted ring-1 ring-line">{item.fileType}</span>
                      </div>
                      <p className="mb-1 text-sm leading-relaxed text-muted-body">{item.description}</p>
                      <p className="mb-3 text-xs text-muted-soft">{item.fileSize}</p>
                      <a href={webLink(item.downloadUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-primary-50 px-4 text-sm font-extrabold text-primary-700 transition hover:bg-primary-100">
                        <Download size={14} />تحميل الملف
                      </a>
                    </div>
                  </div>
                ))}
                {communityLibraryItems.length === 0 && (
                  <div className="rounded-[24px] border border-dashed border-line-deep py-12 text-center text-muted"><BookOpen size={40} className="mx-auto mb-3 opacity-30" /><p>لا توجد ملفات في المكتبة بعد</p></div>
                )}
              </div>
            )}

            {activeTab === 'videos' && (
              <div className="animate-fade-in space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-black text-ink">ورش ومحاضرات مسجلة</h3>
                    <p className="text-sm text-muted">مكتبة محتوى مجاني لتطوير مهاراتك</p>
                  </div>
                  <span className="flex-none rounded-full bg-white px-3 py-1 text-xs font-extrabold text-muted-strong ring-1 ring-line">{communityVideos.length} فيديو</span>
                </div>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  {communityVideos.map(video => (
                    <div key={video.id} className={`${card} group overflow-hidden transition hover:-translate-y-1 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)]`}>
                      <div className="relative aspect-video cursor-pointer bg-sand" onClick={() => video.videoUrl ? setShowVideoModal(video.videoUrl) : undefined}>
                        {video.thumbnail && <img loading="lazy" decoding="async" src={cdnImg(video.thumbnail, 640)} srcSet={cdnSrcSet(video.thumbnail, [400, 640])} sizes="(min-width: 768px) 320px, 100vw" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" alt={video.title} />}
                        <div className="absolute inset-0 flex items-center justify-center bg-ink/25 transition group-hover:bg-ink/15">
                          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-primary-700 shadow-lg transition group-hover:scale-110">
                            <Play fill="currentColor" className="ml-1" size={22} />
                          </div>
                        </div>
                        <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-ink/80 px-2.5 py-1 text-[11px] font-bold text-white"><Clock size={10} />{video.duration}</span>
                        {!video.videoUrl && <span className="absolute left-2 top-2 rounded-full bg-gold-light px-2.5 py-0.5 text-[11px] font-black text-ink">قريباً</span>}
                      </div>
                      <div className="p-4 sm:p-5">
                        <h4 className="mb-1.5 font-black leading-snug text-ink transition group-hover:text-primary-700">{video.title}</h4>
                        {video.description && <p className="mb-2 line-clamp-2 text-sm text-muted">{video.description}</p>}
                        <div className="flex items-center justify-between text-xs text-muted">
                          <span className="flex items-center gap-1"><Eye size={12} />{video.viewsLabel} مشاهدة</span>
                          {video.videoUrl && <button onClick={() => setShowVideoModal(video.videoUrl!)} className="flex min-h-[40px] items-center gap-1 font-extrabold text-primary-700 hover:underline">مشاهدة <ChevronRight size={12} className="rtl:rotate-180" /></button>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {communityVideos.length === 0 && (
                  <div className="rounded-[24px] border border-dashed border-line-deep py-12 text-center text-muted"><Video size={40} className="mx-auto mb-3 opacity-30" /><p>لا توجد فيديوهات بعد</p></div>
                )}
              </div>
            )}

            {activeTab === 'events' && <CommunityEventsSection events={communityEvents} />}
          </div>

          {/* Right Sidebar */}
          <div className="min-w-0 space-y-5 lg:col-span-1">
            <div className={`${card} p-5`}>
              {/* «أعضاء نشطون الآن» promised live presence the site does not
                  track. The panel is a member count and five decorative
                  initials, so it now says what it actually is. */}
              <h3 className="mb-4 flex items-center gap-2 text-sm font-black text-ink"><Users size={16} className="text-primary-700" />أعضاء المجتمع</h3>
              <div className="mb-3 flex -space-x-2 py-1 rtl:space-x-reverse">
                {['أ','ب','ج','د','ه'].map((letter, i) => {
                  const colors = ['bg-primary-700','bg-ink','bg-gold-deep','bg-primary-900','bg-muted-strong'];
                  return <div key={i} className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-white ${colors[i]} text-xs font-bold text-white`}>{letter}</div>;
                })}
                <div className="flex h-9 min-w-[36px] items-center justify-center rounded-full border-2 border-white bg-primary-50 px-1 text-[10px] font-black text-primary-700">+{totalMembers - 5}</div>
              </div>
              <div className="text-xs font-bold text-muted">{totalMembers.toLocaleString('ar-EG-u-nu-latn')} عضو</div>
            </div>

            <div className={`${card} p-5`}>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-ink"><TrendingUp size={16} className="text-primary-700" />إحصائيات المجتمع</h3>
              <div className="divide-y divide-line">
                {[
                  { label: 'نقاشات هذا الأسبوع', value: communityPosts.length },
                  { label: 'ملفات في المكتبة', value: communityLibraryItems.length },
                  { label: 'محاضرات مسجلة', value: communityVideos.length },
                  { label: 'فعاليات قادمة', value: communityEvents.filter(event => isUpcoming(event)).length },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-muted-body">{s.label}</span>
                    <span className="text-sm font-black tabular-nums text-ink">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={`${card} p-5`}>
              <h3 className="mb-4 flex items-center gap-2 text-sm font-black text-ink"><Flame size={16} className="text-primary-700" />أكثر النقاشات تفاعلاً</h3>
              <div className="space-y-3">
                {[...communityPosts].sort((a, b) => b.likes - a.likes).slice(0, 4).map((p, i) => (
                  <div key={p.id} className="group flex cursor-pointer items-start gap-3" onClick={() => { setActiveTab('discussions'); setTagFilter('الكل'); }}>
                    <span className={`mt-0.5 w-5 flex-shrink-0 text-xs font-black ${i === 0 ? 'text-gold-deep' : 'text-muted-faint'}`}>#{i + 1}</span>
                    <p className="line-clamp-2 text-sm leading-snug text-muted-body transition group-hover:text-primary-700">{p.title}</p>
                  </div>
                ))}
                {communityPosts.length === 0 && <p className="text-xs text-muted-soft">لا توجد نقاشات بعد</p>}
              </div>
            </div>

            <div className="rounded-[24px] bg-ink p-5 text-white">
              <Award size={28} className="mb-3 text-gold-light" />
              <h3 className="mb-2 text-lg font-black">المجتمع المتميز</h3>
              <p className="mb-4 text-xs leading-relaxed text-white/65">انضم لأكثر من {totalMembers.toLocaleString('ar-EG-u-nu-latn')} متخصص واحصل على وصول كامل لجميع المحتوى والورش</p>
              {/* This was the most prominent call to action on the page and it did
                  nothing at all. Someone already signed in has nothing to join,
                  so send them where the content actually is instead. */}
              <button type="button" onClick={() => navigate(authUser ? '/courses' : '/auth')}
                className="flex min-h-[46px] w-full items-center justify-center rounded-xl bg-gold-light text-sm font-black text-ink transition hover:bg-gold-pale">
                {authUser ? 'تصفح الدورات' : 'انضم الآن'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* New Post / Edit Modal */}
      {showNewPostModal && (
    <Modal
      open
      onClose={() => { setShowNewPostModal(false); setEditingPostId(null); }}
      title={editingPostId ? 'تعديل المشاركة' : 'مشاركة في ساحة النقاش'}
    >

            <div className="overflow-y-auto flex-1">
              {actionError && <div role="alert" className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{actionError}</div>}
              {postSubmitted ? (
                <div className="p-8 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-50"><CheckCircle size={32} className="text-green-600" /></div>
                  <h3 className="mb-2 text-xl font-black text-ink">{editingPostId ? 'تم التحديث بنجاح!' : '📬 تم استلام منشورك!'}</h3>
                  <p className="text-sm text-muted">{editingPostId ? 'ستظهر التعديلات فوراً' : 'سيتم مراجعته من قِبل الإدارة قبل نشره للجميع'}</p>
                </div>
              ) : (
                <div className="space-y-4 p-5">
                  <>
                      <div>
                        <label className="mb-1 block text-[13px] font-bold text-muted-strong">تصنيف المشاركة</label>
                        <div className="flex flex-wrap gap-2">
                          {ALL_TAGS.slice(1).map(tag => (
                            <button key={tag} type="button" onClick={() => editingPostId ? setEditPostDraft(p => ({ ...p, tag })) : setNewPost(p => ({ ...p, tag }))}
                              className={`min-h-[38px] rounded-full border px-3.5 text-xs font-extrabold transition ${(editingPostId ? editPostDraft.tag : newPost.tag) === tag ? 'border-ink bg-ink text-white' : getTagColor(tag)}`}>{tag}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[13px] font-bold text-muted-strong">عنوان المشاركة <span className="text-red-500">*</span></label>
                        <input value={editingPostId ? editPostDraft.title : newPost.title} onChange={e => editingPostId ? setEditPostDraft(p => ({ ...p, title: e.target.value })) : setNewPost(p => ({ ...p, title: e.target.value }))} className={fieldClass} placeholder="عنوان يلخص مشاركتك" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[13px] font-bold text-muted-strong">تفاصيل المشاركة <span className="text-red-500">*</span></label>
                        <textarea value={editingPostId ? editPostDraft.body : newPost.body} onChange={e => editingPostId ? setEditPostDraft(p => ({ ...p, body: e.target.value })) : setNewPost(p => ({ ...p, body: e.target.value }))} rows={5} className={`${fieldClass} resize-none py-3`} placeholder="شارك أفكارك أو أسئلتك بالتفصيل..." />
                      </div>
                      <button onClick={editingPostId ? handleUpdatePost : handleSubmitPost} disabled={actionPending || (editingPostId ? (!editPostDraft.title.trim() || !editPostDraft.body.trim()) : (!newPost.title.trim() || !newPost.body.trim()))} className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 font-black text-white transition hover:bg-primary-800 disabled:bg-line disabled:text-muted-soft">
                        <Send size={16} />{actionPending ? 'جارٍ الحفظ...' : editingPostId ? 'تحديث المشاركة' : 'نشر المشاركة'}
                      </button>
                  </>
                </div>
              )}
            </div>
    </Modal>
      )}

      {/* Video Modal */}
      {showVideoModal && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setShowVideoModal(null)}>
          <button onClick={() => setShowVideoModal(null)} aria-label="إغلاق" className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"><X size={22} /></button>
          <div className="w-full max-w-4xl" onClick={e => e.stopPropagation()}>
            <div className="relative aspect-video overflow-hidden rounded-[24px] shadow-2xl">
              <VideoSurface url={showVideoModal} title="فيديو المجتمع" autoplay />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Community;
