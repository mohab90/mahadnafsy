import React, { useState, useMemo, useEffect } from 'react';
import {
  Users, BookOpen, MessageSquare, Calendar, Download, FileText,
  Heart, MessageCircle, Share2, MoreHorizontal, Play, Video,
  Pin, Plus, X, Send, Eye, Bell,
  ChevronRight, ChevronLeft, Award, Flame, Clock, CheckCircle, TrendingUp,
  Pencil, Trash2,
} from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { cdnImg } from '../lib/img';

const TAG_COLORS: Record<string, string> = {
  'نقاش حالة': 'bg-blue-50 text-blue-700 border-blue-200',
  'مشاركة علمية': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'نقاش عام': 'bg-gray-100 text-gray-700 border-gray-200',
  'استفسار': 'bg-amber-50 text-amber-700 border-amber-200',
  'موارد': 'bg-violet-50 text-violet-700 border-violet-200',
  'تجربة شخصية': 'bg-pink-50 text-pink-700 border-pink-200',
};
const getTagColor = (tag: string) => TAG_COLORS[tag] || 'bg-gray-100 text-gray-600 border-gray-200';
const ALL_TAGS = ['الكل', 'نقاش حالة', 'مشاركة علمية', 'نقاش عام', 'استفسار', 'موارد', 'تجربة شخصية'];

const ARABIC_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const ARABIC_DAYS_SHORT = ['سبت','أحد','اثن','ثلا','أرب','خمس','جمع'];

const Community: React.FC = () => {
  useEffect(() => { document.title = 'المجتمع النفسي | معهد الدراسات النفسية'; }, []);
  const {
    communityPosts, communityLibraryItems, communityVideos, communityEvents,
    addCommunityPost, updateCommunityPost, deleteCommunityPost,
    toggleCommunityPostLike, addCommunityPostComment,
    content, isAdmin, authUser,
  } = useSiteData();
  const [activeTab, setActiveTab] = useState<'discussions' | 'library' | 'events' | 'videos'>('discussions');
  const [tagFilter, setTagFilter] = useState('الكل');
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [showNewPostModal, setShowNewPostModal] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState<string | null>(null);
  const [newPost, setNewPost] = useState({ title: '', body: '', tag: 'نقاش عام' });
  const [postSubmitted, setPostSubmitted] = useState(false);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [commentPanelId, setCommentPanelId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [contextMenuPostId, setContextMenuPostId] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostDraft, setEditPostDraft] = useState({ title: '', body: '', tag: 'نقاش عام' });
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const totalMembers = 847 + communityPosts.length;

  const getEmbedUrl = (url: string) => {
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
    if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&autoplay=1`;
    return url;
  };

  const filteredPosts = useMemo(() => {
    // Only show approved posts (or legacy posts without status) to regular users
    const visible = communityPosts.filter(p => !p.status || p.status === 'approved' || p.isOwner);
    const sorted = [...visible].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return sorted.filter(p => tagFilter === 'الكل' || p.tag === tagFilter);
  }, [communityPosts, tagFilter]);

  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const firstDayCol = (() => {
    const jsDay = new Date(calendarYear, calendarMonth, 1).getDay();
    return (jsDay + 1) % 7; // Sat=0, Sun=1, ..., Fri=6
  })();
  const todayStr = new Date().toISOString().slice(0, 10);

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
    } catch {
      setActionError('لم يتم حفظ المنشور. تأكد من تسجيل الدخول والاتصال ثم حاول مرة أخرى.');
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

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Hero */}
      <div className="bg-gradient-to-br from-gray-900 via-primary-900 to-gray-900 text-white py-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary-600 rounded-full blur-[120px] opacity-20"></div>
        <div className="container mx-auto px-4 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 bg-primary-600/30 border border-primary-400/30 rounded-full px-4 py-1.5 text-sm font-medium mb-5">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            {totalMembers.toLocaleString('ar-EG-u-nu-latn')} عضو نشط في المجتمع
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4">{content['community.heroTitle'] || 'المجتمع النفسي المتخصص'}</h1>
          <p className="text-gray-300 text-lg max-w-2xl mx-auto leading-relaxed">
            {content['community.heroSubtitle'] || 'مساحة آمنة ومتخصصة لتبادل الخبرات ومناقشة الحالات والنمو المهني بين المتخصصين في الصحة النفسية'}
          </p>
          <div className="flex flex-wrap justify-center gap-4 mt-8">
            {([
              { icon: MessageSquare, label: `${communityPosts.length} نقاش` },
              { icon: FileText, label: `${communityLibraryItems.length} مرجع علمي` },
              { icon: Video, label: `${communityVideos.length} محاضرة` },
              { icon: Calendar, label: `${communityEvents.length} فعالية` },
            ] as const).map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 bg-white/10 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10 text-sm">
                <Icon size={15} className="text-primary-300" />
                <span className="text-gray-200">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {actionError && (
          <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {actionError}
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">

          {/* Left Sidebar */}
          <div className="lg:col-span-1 space-y-5">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 sticky top-24">
              <div className="flex items-center gap-3 mb-5 pb-5 border-b border-gray-100">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-lg shadow">م</div>
                <div>
                  <h3 className="font-bold text-gray-900">متخصص في المجتمع</h3>
                  <p className="text-xs text-primary-600 font-medium bg-primary-50 px-2 py-0.5 rounded-full inline-block mt-0.5">عضو نشط</p>
                </div>
              </div>
              {authUser && !isAdmin ? (
                <button onClick={() => { setActionError(null); setShowNewPostModal(true); }} className="w-full bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-xl font-bold mb-5 shadow flex items-center justify-center gap-2 transition">
                  <Plus size={18} />مشاركة جديدة
                </button>
              ) : (
                <p className="mb-5 rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-700">سجّل الدخول للمشاركة والتفاعل.</p>
              )}
              <nav className="space-y-1">
                {([
                  { key: 'discussions', icon: MessageSquare, label: content['community.discussions.title'] || 'ساحة النقاش', count: communityPosts.length },
                  { key: 'library', icon: BookOpen, label: content['community.library.title'] || 'المكتبة الرقمية', count: communityLibraryItems.length },
                  { key: 'videos', icon: Video, label: content['community.videos.title'] || 'ورش ومحاضرات', count: communityVideos.length },
                  { key: 'events', icon: Calendar, label: content['community.events.title'] || 'الفعاليات', count: communityEvents.length },
                ] as const).map(({ key, icon: Icon, label, count }) => (
                  <button key={key} onClick={() => setActiveTab(key)} className={`w-full flex items-center justify-between p-3 rounded-xl transition text-sm font-medium ${activeTab === key ? 'bg-primary-50 text-primary-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>
                    <div className="flex items-center gap-3"><Icon size={18} />{label}</div>
                    <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${activeTab === key ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
                  </button>
                ))}
              </nav>
              <div className="mt-5 pt-5 border-t border-gray-100">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">الوسوم</h4>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_TAGS.slice(1).map(tag => (
                    <button key={tag} onClick={() => { setActiveTab('discussions'); setTagFilter(tag); }} className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition ${getTagColor(tag)}`}>{tag}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-2 space-y-5">

            {activeTab === 'discussions' && (
              <div className="animate-fade-in space-y-4">
                <div className="flex gap-2 flex-wrap">
                  {ALL_TAGS.map(tag => (
                    <button key={tag} onClick={() => setTagFilter(tag)} className={`text-xs px-3 py-1.5 rounded-full border font-medium transition ${tagFilter === tag ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'}`}>{tag}</button>
                  ))}
                </div>
                <div onClick={authUser && !isAdmin ? () => setShowNewPostModal(true) : undefined} className={`bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex gap-3 items-center transition group ${authUser && !isAdmin ? 'cursor-pointer hover:border-primary-300' : 'opacity-70'}`}>
                  <div className="w-10 h-10 rounded-full bg-primary-100 flex-shrink-0 flex items-center justify-center text-primary-600 font-bold">م</div>
                  <div className="flex-1 bg-gray-50 group-hover:bg-primary-50 rounded-full px-4 py-2.5 text-gray-400 text-sm transition">شارك أفكارك، أسئلتك، أو حالة للنقاش...</div>
                </div>
                {filteredPosts.length === 0 && (
                  <div className="text-center py-12 text-gray-400">
                    <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
                    <p>لا توجد نقاشات تطابق بحثك</p>
                  </div>
                )}
                {filteredPosts.map(post => (
                  <div key={post.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:border-primary-100 transition">
                    {post.pinned && (
                      <div className="flex items-center gap-1.5 text-amber-600 text-xs font-bold mb-3">
                        <Pin size={12} fill="currentColor" />منشور مثبت
                      </div>
                    )}
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <img loading="lazy" decoding="async" src={post.authorImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(post.authorName)}&background=7c3aed&color=fff&size=80`} className="w-11 h-11 rounded-full object-cover border-2 border-gray-100" alt={post.authorName} onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(post.authorName)}&background=6d28d9&color=fff&size=80`; }} />
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-gray-900 text-sm">{post.authorRole === 'Admin' ? 'الإدارة' : post.authorName}</h4>
                            {post.authorRole === 'Admin' && <span className="text-[10px] bg-primary-600 text-white px-1.5 py-0.5 rounded-full font-bold">إدارة</span>}
                          </div>
                          <p className="text-xs text-gray-400">{post.authorRole === 'Admin' ? 'معهد الدراسات النفسية' : post.authorRole} • {post.createdAt}</p>
                        </div>
                      </div>
                      {post.isOwner && <div className="relative">
                        <button onClick={(e) => { e.stopPropagation(); setContextMenuPostId(contextMenuPostId === post.id ? null : post.id); }} aria-label="خيارات المنشور" className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition"><MoreHorizontal size={18} /></button>
                        {contextMenuPostId === post.id && (
                          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 py-1 min-w-[100px]">
                            <button onClick={() => { setEditingPostId(post.id); setEditPostDraft({ title: post.title, body: post.body, tag: post.tag }); setShowNewPostModal(true); setContextMenuPostId(null); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Pencil size={13} />تعديل</button>
                            <button onClick={() => handleDeletePost(post.id)} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"><Trash2 size={13} />حذف</button>
                          </div>
                        )}
                      </div>}
                    </div>
                    <div className="mb-4">
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border inline-block mb-2 ${getTagColor(post.tag)}`}>{post.tag}</span>
                      <h5 className="font-bold text-gray-900 mb-2 leading-snug">{post.title}</h5>
                      <p className={`text-gray-700 leading-relaxed text-sm ${expandedPost !== post.id && post.body.length > 200 ? 'line-clamp-3' : ''}`}>{post.body}</p>
                      {post.body.length > 200 && (
                        <button onClick={() => setExpandedPost(expandedPost === post.id ? null : post.id)} className="text-primary-600 text-xs font-bold mt-1 hover:underline">
                          {expandedPost === post.id ? 'عرض أقل' : 'قراءة المزيد'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between pt-4 border-t border-gray-50">
                      <div className="flex gap-5">
                        <button onClick={() => void handleLike(post.id)} disabled={actionPending || !authUser} className={`flex items-center gap-2 text-sm transition group disabled:opacity-50 ${likedPosts.has(post.id) ? 'text-red-500' : 'text-gray-500 hover:text-red-500'}`}>
                          <Heart size={17} className={likedPosts.has(post.id) ? 'fill-red-500' : 'group-hover:fill-red-500'} />
                          <span className="font-medium">{post.likes}</span>
                        </button>
                        <button onClick={() => setCommentPanelId(commentPanelId === post.id ? null : post.id)} className={`flex items-center gap-2 text-sm transition ${commentPanelId === post.id ? 'text-primary-600' : 'text-gray-500 hover:text-blue-500'}`}>
                          <MessageCircle size={17} /><span className="font-medium">{post.comments}</span>
                        </button>
                      </div>
                      <button onClick={() => handleShare(post.title)} className="text-gray-400 hover:text-gray-600 transition flex items-center gap-1 text-xs">
                        <Share2 size={15} />مشاركة
                      </button>
                    </div>
                    {commentPanelId === post.id && (
                      <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                        {(post.commentsList || []).length > 0 && (
                          <div className="space-y-3">
                            {(post.commentsList || []).map(c => (
                              <div key={c.id} className="flex gap-3">
                                <div className="w-8 h-8 rounded-full bg-primary-100 flex-shrink-0 flex items-center justify-center text-primary-600 text-xs font-bold">{c.author.charAt(0)}</div>
                                <div className="flex-1 bg-gray-50 rounded-xl p-3">
                                  <p className="text-xs font-bold text-gray-800 mb-1">{c.author} <span className="font-normal text-gray-400">• {c.at}</span></p>
                                  <p className="text-sm text-gray-700">{c.body}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {(post.commentsList || []).length === 0 && (
                          <p className="text-xs text-gray-400 text-center py-2">لا توجد تعليقات بعد. كن أول من يعلق!</p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <input
                            value={commentDrafts[post.id] || ''}
                            onChange={e => setCommentDrafts(prev => ({ ...prev, [post.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') void handleSubmitComment(post.id); }}
                            placeholder={authUser ? 'اكتب تعليقك...' : 'سجّل الدخول للتعليق'}
                            disabled={!authUser || actionPending}
                            className="flex-1 border border-gray-200 disabled:bg-gray-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-400"
                          />
                          <button onClick={() => void handleSubmitComment(post.id)} disabled={actionPending || !authUser} className="bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white p-2 rounded-xl transition flex-shrink-0">
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
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-gray-900">المكتبة الرقمية المتخصصة</h3>
                  <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">{communityLibraryItems.length} مرجع</span>
                </div>
                {communityLibraryItems.map(item => (
                  <div key={item.id} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-start gap-4 hover:shadow-md hover:border-primary-100 transition group">
                    <div className={`p-3 rounded-xl flex-shrink-0 ${item.fileType.toLowerCase().includes('book') ? 'bg-violet-50 text-violet-600' : item.fileType === 'PDF' ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-600'}`}>
                      {item.fileType.toLowerCase().includes('book') ? <BookOpen size={26} /> : <FileText size={26} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="font-bold text-gray-900 group-hover:text-primary-600 transition leading-snug">{item.title}</h3>
                        <span className="text-[10px] font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-500 flex-shrink-0">{item.fileType}</span>
                      </div>
                      <p className="text-sm text-gray-500 mb-1">{item.description}</p>
                      <p className="text-xs text-gray-400 mb-3">{item.fileSize}</p>
                      <a href={item.downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-bold text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 px-3 py-1.5 rounded-lg transition">
                        <Download size={14} />تحميل الملف
                      </a>
                    </div>
                  </div>
                ))}
                {communityLibraryItems.length === 0 && (
                  <div className="text-center py-12 text-gray-400"><BookOpen size={40} className="mx-auto mb-3 opacity-30" /><p>لا توجد ملفات في المكتبة بعد</p></div>
                )}
              </div>
            )}

            {activeTab === 'videos' && (
              <div className="animate-fade-in space-y-5">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg">ورش ومحاضرات مسجلة</h3>
                    <p className="text-gray-500 text-sm">مكتبة محتوى مجاني لتطوير مهاراتك</p>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">{communityVideos.length} فيديو</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {communityVideos.map(video => (
                    <div key={video.id} className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm group hover:shadow-md hover:border-primary-100 transition">
                      <div className="relative aspect-video bg-gray-100 cursor-pointer" onClick={() => video.videoUrl ? setShowVideoModal(video.videoUrl) : undefined}>
                        {video.thumbnail && <img loading="lazy" decoding="async" src={cdnImg(video.thumbnail, 500)} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" alt={video.title} />}
                        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition flex items-center justify-center">
                          <div className="w-12 h-12 bg-white/30 backdrop-blur rounded-full flex items-center justify-center group-hover:scale-110 transition">
                            <Play fill="white" className="text-white ml-1" size={20} />
                          </div>
                        </div>
                        <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-1 rounded font-medium flex items-center gap-1"><Clock size={10} />{video.duration}</span>
                        {!video.videoUrl && <span className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded font-bold">قريباً</span>}
                      </div>
                      <div className="p-4">
                        <h4 className="font-bold text-gray-900 mb-1.5 group-hover:text-primary-600 transition leading-snug">{video.title}</h4>
                        {video.description && <p className="text-xs text-gray-500 mb-2 line-clamp-2">{video.description}</p>}
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span className="flex items-center gap-1"><Eye size={12} />{video.viewsLabel} مشاهدة</span>
                          {video.videoUrl && <button onClick={() => setShowVideoModal(video.videoUrl!)} className="text-primary-600 font-bold flex items-center gap-1 hover:underline">مشاهدة <ChevronRight size={12} className="rtl:rotate-180" /></button>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {communityVideos.length === 0 && (
                  <div className="text-center py-12 text-gray-400"><Video size={40} className="mx-auto mb-3 opacity-30" /><p>لا توجد فيديوهات بعد</p></div>
                )}
              </div>
            )}

            {activeTab === 'events' && (
              <div className="animate-fade-in space-y-4">
                {/* Calendar */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                  <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <button onClick={() => { const d = new Date(calendarYear, calendarMonth - 1); setCalendarYear(d.getFullYear()); setCalendarMonth(d.getMonth()); }} aria-label="الشهر السابق" className="p-2 hover:bg-gray-100 rounded-xl transition"><ChevronRight size={18} /></button>
                    <div className="text-center">
                      <h3 className="font-extrabold text-gray-900 text-lg">{ARABIC_MONTHS[calendarMonth]} {calendarYear}</h3>
                      <p className="text-xs text-gray-400">{communityEvents.filter(e => e.eventDate && e.eventDate.startsWith(`${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}`)).length} فعالية هذا الشهر</p>
                    </div>
                    <button onClick={() => { const d = new Date(calendarYear, calendarMonth + 1); setCalendarYear(d.getFullYear()); setCalendarMonth(d.getMonth()); }} aria-label="الشهر التالي" className="p-2 hover:bg-gray-100 rounded-xl transition"><ChevronLeft size={18} /></button>
                  </div>
                  <div className="grid grid-cols-7 border-b border-gray-100">
                    {ARABIC_DAYS_SHORT.map(d => (
                      <div key={d} className="text-center py-2 text-xs font-bold text-gray-500">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {Array.from({ length: firstDayCol }).map((_, i) => (
                      <div key={`e-${i}`} className="min-h-[72px] border-b border-r border-gray-50" />
                    ))}
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1;
                      const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const dayEvents = communityEvents.filter(e => e.eventDate === dateStr);
                      const isToday = dateStr === todayStr;
                      const col = (firstDayCol + i) % 7;
                      return (
                        <div
                          key={day}
                          className={`min-h-[72px] p-1.5 border-b border-gray-100 transition ${col === 6 ? '' : 'border-r border-gray-100'}`}
                        >
                          <div className={`text-xs font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-primary-600 text-white' : 'text-gray-600'}`}>{day}</div>
                          {dayEvents.slice(0, 2).map(e => (
                            <div key={e.id} className="text-[10px] bg-primary-100 text-primary-700 rounded px-1 py-0.5 mb-0.5 truncate font-medium leading-tight">{e.title}</div>
                          ))}
                          {dayEvents.length > 2 && <div className="text-[9px] text-gray-400">+{dayEvents.length - 2}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Events list for current month */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2"><Flame size={16} className="text-orange-500" />فعاليات {ARABIC_MONTHS[calendarMonth]}</h3>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {communityEvents
                      .filter(e => !e.eventDate || e.eventDate.startsWith(`${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}`))
                      .sort((a, b) => (a.eventDate || '').localeCompare(b.eventDate || ''))
                      .map(event => (
                      <div key={event.id} className="flex items-center gap-4 p-4 hover:bg-primary-50/50 transition group">
                        <div className="bg-primary-100 w-14 h-14 rounded-xl flex flex-col items-center justify-center font-bold text-primary-700 leading-none flex-shrink-0 text-center group-hover:bg-primary-200 transition">
                          {event.eventDate ? (
                            <>
                              <span className="text-lg font-extrabold leading-none">{new Date(event.eventDate + 'T00:00:00').getDate()}</span>
                              <span className="text-[10px] mt-0.5">{ARABIC_MONTHS[new Date(event.eventDate + 'T00:00:00').getMonth()]}</span>
                            </>
                          ) : (
                            <span className="text-xs font-extrabold text-center px-1">{event.dateLabel}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-gray-900 text-sm mb-1 group-hover:text-primary-700 transition">{event.title}</h4>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs bg-primary-50 text-primary-700 border border-primary-100 px-2 py-0.5 rounded-full font-medium">{event.eventType}</span>
                            {event.speaker && <span className="text-xs text-gray-500">{event.speaker}</span>}
                            {event.platform && <span className="text-xs text-gray-400">• {event.platform}</span>}
                          </div>
                          {event.description && <p className="text-xs text-gray-400 mt-1 line-clamp-1">{event.description}</p>}
                        </div>
                        <button className="text-gray-400 hover:text-primary-600 p-2 rounded-lg transition flex-shrink-0"><Bell size={16} /></button>
                      </div>
                    ))}
                    {communityEvents.filter(e => !e.eventDate || e.eventDate.startsWith(`${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}`)).length === 0 && (
                      <div className="text-center py-8 text-gray-400">
                        <Calendar size={32} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm">لا توجد فعاليات هذا الشهر</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Sidebar */}
          <div className="lg:col-span-1 space-y-5">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="font-bold text-gray-900 mb-4 text-sm flex items-center gap-2"><Users size={16} className="text-primary-500" />أعضاء نشطون الآن</h3>
              <div className="flex -space-x-2 rtl:space-x-reverse mb-3 py-1">
                {['أ','ب','ج','د','ه'].map((letter, i) => {
                  const colors = ['bg-violet-500','bg-emerald-500','bg-sky-500','bg-amber-500','bg-rose-500'];
                  return <div key={i} className={`w-9 h-9 rounded-full border-2 border-white shadow-sm ${colors[i]} flex items-center justify-center text-white text-xs font-bold`}>{letter}</div>;
                })}
                <div className="w-9 h-9 rounded-full border-2 border-white bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-700">+{totalMembers - 5}</div>
              </div>
              <div className="text-xs text-gray-500">{totalMembers.toLocaleString('ar-EG-u-nu-latn')} عضو • {Math.floor(totalMembers * 0.07)} متصل الآن</div>
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="font-bold text-gray-900 mb-4 text-sm flex items-center gap-2"><TrendingUp size={16} className="text-emerald-500" />إحصائيات المجتمع</h3>
              <div className="space-y-3">
                {[
                  { label: 'نقاشات هذا الأسبوع', value: communityPosts.length, color: 'text-blue-600' },
                  { label: 'ملفات في المكتبة', value: communityLibraryItems.length, color: 'text-violet-600' },
                  { label: 'محاضرات مسجلة', value: communityVideos.length, color: 'text-amber-600' },
                  { label: 'فعاليات قادمة', value: communityEvents.length, color: 'text-emerald-600' },
                ].map(s => (
                  <div key={s.label} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                    <span className="text-xs text-gray-600">{s.label}</span>
                    <span className={`font-bold text-sm ${s.color}`}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="font-bold text-gray-900 mb-4 text-sm flex items-center gap-2"><Flame size={16} className="text-orange-500" />أكثر النقاشات تفاعلاً</h3>
              <div className="space-y-3">
                {[...communityPosts].sort((a, b) => b.likes - a.likes).slice(0, 4).map((p, i) => (
                  <div key={p.id} className="flex items-start gap-3 cursor-pointer group" onClick={() => { setActiveTab('discussions'); setTagFilter('الكل'); }}>
                    <span className={`text-xs font-extrabold w-5 flex-shrink-0 mt-0.5 ${i === 0 ? 'text-amber-500' : 'text-gray-400'}`}>#{i + 1}</span>
                    <p className="text-xs text-gray-700 group-hover:text-primary-600 transition leading-snug line-clamp-2">{p.title}</p>
                  </div>
                ))}
                {communityPosts.length === 0 && <p className="text-xs text-gray-400">لا توجد نقاشات بعد</p>}
              </div>
            </div>

            <div className="bg-gradient-to-br from-primary-600 to-primary-800 p-5 rounded-2xl text-white">
              <Award size={28} className="mb-3 text-yellow-300" />
              <h3 className="font-bold text-lg mb-2">المجتمع المتميز</h3>
              <p className="text-primary-200 text-xs mb-4 leading-relaxed">انضم لأكثر من {totalMembers.toLocaleString('ar-EG-u-nu-latn')} متخصص واحصل على وصول كامل لجميع المحتوى والورش</p>
              <button className="w-full bg-white text-primary-700 font-bold py-2.5 rounded-xl text-sm hover:bg-primary-50 transition">انضم الآن</button>
            </div>
          </div>
        </div>
      </div>

      {/* New Post / Edit Modal */}
      {showNewPostModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => { setShowNewPostModal(false); setEditingPostId(null); setPostSubmitted(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
              <h3 className="font-bold text-gray-900 text-lg">
                {editingPostId ? 'تعديل المشاركة' : 'مشاركة في ساحة النقاش'}
              </h3>
              <button onClick={() => { setShowNewPostModal(false); setEditingPostId(null); setPostSubmitted(false); }} className="text-gray-400 hover:text-gray-600 transition p-1.5 rounded-lg hover:bg-gray-100"><X size={20} /></button>
            </div>

            <div className="overflow-y-auto flex-1">
              {actionError && <div role="alert" className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}
              {postSubmitted ? (
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle size={32} className="text-emerald-500" /></div>
                  <h3 className="font-bold text-gray-900 text-xl mb-2">{editingPostId ? 'تم التحديث بنجاح!' : '📬 تم استلام منشورك!'}</h3>
                  <p className="text-gray-500 text-sm">{editingPostId ? 'ستظهر التعديلات فوراً' : 'سيتم مراجعته من قِبل الإدارة قبل نشره للجميع'}</p>
                </div>
              ) : (
                <div className="p-5 space-y-4">
                  <>
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1.5">تصنيف المشاركة</label>
                        <div className="flex flex-wrap gap-2">
                          {ALL_TAGS.slice(1).map(tag => (
                            <button key={tag} type="button" onClick={() => editingPostId ? setEditPostDraft(p => ({ ...p, tag })) : setNewPost(p => ({ ...p, tag }))}
                              className={`text-xs px-3 py-1.5 rounded-full border font-medium transition ${(editingPostId ? editPostDraft.tag : newPost.tag) === tag ? 'bg-primary-600 text-white border-primary-600' : getTagColor(tag)}`}>{tag}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1.5">عنوان المشاركة <span className="text-red-500">*</span></label>
                        <input value={editingPostId ? editPostDraft.title : newPost.title} onChange={e => editingPostId ? setEditPostDraft(p => ({ ...p, title: e.target.value })) : setNewPost(p => ({ ...p, title: e.target.value }))} className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary-400" placeholder="عنوان يلخص مشاركتك" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1.5">تفاصيل المشاركة <span className="text-red-500">*</span></label>
                        <textarea value={editingPostId ? editPostDraft.body : newPost.body} onChange={e => editingPostId ? setEditPostDraft(p => ({ ...p, body: e.target.value })) : setNewPost(p => ({ ...p, body: e.target.value }))} rows={5} className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary-400 resize-none" placeholder="شارك أفكارك أو أسئلتك بالتفصيل..." />
                      </div>
                      <button onClick={editingPostId ? handleUpdatePost : handleSubmitPost} disabled={actionPending || (editingPostId ? (!editPostDraft.title.trim() || !editPostDraft.body.trim()) : (!newPost.title.trim() || !newPost.body.trim()))} className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2">
                        <Send size={16} />{actionPending ? 'جارٍ الحفظ...' : editingPostId ? 'تحديث المشاركة' : 'نشر المشاركة'}
                      </button>
                  </>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Video Modal */}
      {showVideoModal && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setShowVideoModal(null)}>
          <button onClick={() => setShowVideoModal(null)} className="absolute top-4 right-4 text-white bg-white/10 rounded-full p-2 hover:bg-white/20 transition"><X size={22} /></button>
          <div className="w-full max-w-4xl" onClick={e => e.stopPropagation()}>
            <div className="relative aspect-video rounded-2xl overflow-hidden shadow-2xl">
              <iframe src={getEmbedUrl(showVideoModal)} className="w-full h-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title="فيديو المجتمع" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Community;
