import React from 'react';
import { DashboardCommunityShell } from './DashboardCommunityShell';
import type { CommunityEventItem, CommunityLibraryItem, CommunityPostItem, CommunityVideoItem } from '../../types';

type CommunityAdminTab = 'pending' | 'posts' | 'library' | 'videos' | 'events' | 'comments';
type CommunityPostDraft = Pick<CommunityPostItem, 'title' | 'body' | 'tag' | 'authorName' | 'authorRole' | 'authorImage'> & { pinned: boolean };
type CommunityLibraryDraft = Omit<CommunityLibraryItem, 'id'>;
type CommunityVideoDraft = Omit<CommunityVideoItem, 'id'> & { videoUrl: string; description: string };
type CommunityEventDraft = Omit<CommunityEventItem, 'id'> & { eventDate: string; description: string };

interface Props {
  activeTab: string;
  communityAdminTab: CommunityAdminTab;
  setCommunityAdminTab: (tab: CommunityAdminTab) => void;
  communityPosts: CommunityPostItem[];
  communityLibraryItems: CommunityLibraryItem[];
  communityVideos: CommunityVideoItem[];
  communityEvents: CommunityEventItem[];
  updateCommunityPost: (post: CommunityPostItem) => Promise<boolean>;
  deleteCommunityPost: (id: string) => Promise<boolean>;
  addCommunityPost: (post: CommunityPostItem) => Promise<boolean>;
  communityPostDraft: CommunityPostDraft;
  setCommunityPostDraft: React.Dispatch<React.SetStateAction<CommunityPostDraft>>;
  isCommunityPostFormOpen: boolean;
  setIsCommunityPostFormOpen: (open: boolean) => void;
  editingCommunityPostId: string;
  setEditingCommunityPostId: (id: string) => void;
  communityLibraryDraft: CommunityLibraryDraft;
  setCommunityLibraryDraft: React.Dispatch<React.SetStateAction<CommunityLibraryDraft>>;
  isCommunityLibraryFormOpen: boolean;
  setIsCommunityLibraryFormOpen: (open: boolean) => void;
  editingCommunityLibraryId: string;
  setEditingCommunityLibraryId: (id: string) => void;
  addCommunityLibraryItem: (item: CommunityLibraryItem) => Promise<boolean>;
  updateCommunityLibraryItem: (item: CommunityLibraryItem) => Promise<boolean>;
  deleteCommunityLibraryItem: (id: string) => Promise<boolean>;
  communityVideoDraft: CommunityVideoDraft;
  setCommunityVideoDraft: React.Dispatch<React.SetStateAction<CommunityVideoDraft>>;
  isCommunityVideoFormOpen: boolean;
  setIsCommunityVideoFormOpen: (open: boolean) => void;
  editingCommunityVideoId: string;
  setEditingCommunityVideoId: (id: string) => void;
  addCommunityVideo: (video: CommunityVideoItem) => Promise<boolean>;
  updateCommunityVideo: (video: CommunityVideoItem) => Promise<boolean>;
  deleteCommunityVideo: (id: string) => Promise<boolean>;
  communityEventDraft: CommunityEventDraft;
  setCommunityEventDraft: React.Dispatch<React.SetStateAction<CommunityEventDraft>>;
  isCommunityEventFormOpen: boolean;
  setIsCommunityEventFormOpen: (open: boolean) => void;
  editingCommunityEventId: string;
  setEditingCommunityEventId: (id: string) => void;
  addCommunityEvent: (event: CommunityEventItem) => Promise<boolean>;
  updateCommunityEvent: (event: CommunityEventItem) => Promise<boolean>;
  deleteCommunityEvent: (id: string) => Promise<boolean>;
}

export function DashboardCommunityAdminPanel({
  activeTab,
  communityAdminTab,
  setCommunityAdminTab,
  communityPosts,
  communityLibraryItems,
  communityVideos,
  communityEvents,
  updateCommunityPost,
  deleteCommunityPost,
  addCommunityPost,
  communityPostDraft,
  setCommunityPostDraft,
  isCommunityPostFormOpen,
  setIsCommunityPostFormOpen,
  editingCommunityPostId,
  setEditingCommunityPostId,
  communityLibraryDraft,
  setCommunityLibraryDraft,
  isCommunityLibraryFormOpen,
  setIsCommunityLibraryFormOpen,
  editingCommunityLibraryId,
  setEditingCommunityLibraryId,
  addCommunityLibraryItem,
  updateCommunityLibraryItem,
  deleteCommunityLibraryItem,
  communityVideoDraft,
  setCommunityVideoDraft,
  isCommunityVideoFormOpen,
  setIsCommunityVideoFormOpen,
  editingCommunityVideoId,
  setEditingCommunityVideoId,
  addCommunityVideo,
  updateCommunityVideo,
  deleteCommunityVideo,
  communityEventDraft,
  setCommunityEventDraft,
  isCommunityEventFormOpen,
  setIsCommunityEventFormOpen,
  editingCommunityEventId,
  setEditingCommunityEventId,
  addCommunityEvent,
  updateCommunityEvent,
  deleteCommunityEvent,
}: Props) {
  return (
<DashboardCommunityShell
              active={activeTab === 'community'}
              tab={communityAdminTab}
              setTab={setCommunityAdminTab}
              counts={{
                posts: communityPosts.length,
                pending: communityPosts.filter(p => p.status === 'pending').length,
                library: communityLibraryItems.length,
                videos: communityVideos.length,
                events: communityEvents.length,
              }}
            >

                {/* -- Pending moderation -- */}
                {communityAdminTab === 'pending' && (() => {
                  const pending = communityPosts.filter(p => p.status === 'pending');
                  return (
                    <div className="space-y-3">
                      {pending.length === 0 ? (
                        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400">
                          <p className="text-4xl mb-2">✅</p><p className="font-medium">لا يوجد منشورات معلقة للمراجعة</p>
                        </div>
                      ) : pending.map(post => (
                        <div key={post.id} className="bg-white border border-amber-200 rounded-2xl p-5 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg font-bold">بانتظار الموافقة</span>
                                <span className="text-xs text-gray-400">{post.tag}</span>
                                <span className="text-xs text-gray-400">{post.createdAt?.slice(0,10)}</span>
                              </div>
                              <p className="font-bold text-gray-800">{post.title}</p>
                              <p className="text-sm text-gray-600 mt-1 line-clamp-2">{post.body}</p>
                              <p className="text-xs text-gray-500 mt-1">بقلم: {post.authorName} ({post.authorRole === 'Admin' ? 'الإدارة' : post.authorRole})</p>
                            </div>
                            <div className="flex gap-2 flex-shrink-0">
                              <button onClick={() => updateCommunityPost({ ...post, status: 'approved' })}
                                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700">موافقة</button>
                              <button onClick={() => updateCommunityPost({ ...post, status: 'rejected' })}
                                className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-bold hover:bg-red-100">رفض</button>
                              <button onClick={() => { if (window.confirm('حذف هذا المنشور؟')) deleteCommunityPost(post.id); }}
                                className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-200">حذف</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* -- Posts management -- */}
                {communityAdminTab === 'posts' && (
                  <div className="space-y-4">
                    <div className="flex justify-end">
                      <button onClick={() => { setEditingCommunityPostId(''); setCommunityPostDraft({ title: '', body: '', tag: 'نقاش عام', authorName: 'إدارة المنصة', authorRole: 'الإدارة', authorImage: '', pinned: false }); setIsCommunityPostFormOpen(true); }}
                        className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-teal-700 flex items-center gap-2">
                        <span>+</span> منشور جديد
                      </button>
                    </div>
                    {communityPosts.length === 0 ? (
                      <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400"><p className="text-4xl mb-2">📝</p><p>لا توجد منشورات</p></div>
                    ) : (
                      <div className="space-y-3">
                        {[...communityPosts].sort((a,b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt)).map(post => (
                          <div key={post.id} className={`bg-white border rounded-2xl p-4 shadow-sm flex items-start justify-between gap-3 ${post.pinned ? 'border-teal-300' : 'border-gray-200'}`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                {post.pinned && <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-lg font-bold">📌 مثبت</span>}
                                <span className={`text-xs px-2 py-0.5 rounded-lg font-bold ${post.status === 'rejected' ? 'bg-red-100 text-red-700' : post.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{post.status === 'rejected' ? 'مرفوض' : post.status === 'pending' ? 'معلق' : 'منشور'}</span>
                                <span className="text-xs text-gray-400">{post.tag}</span>
                                <span className="text-xs text-gray-400">{post.createdAt?.slice(0,10)}</span>
                              </div>
                              <p className="font-bold text-gray-800 truncate">{post.title}</p>
                              <p className="text-sm text-gray-500 mt-0.5">{post.authorName} · {post.likes} إعجاب · {post.comments} تعليق</p>
                            </div>
                            <div className="flex gap-2 flex-shrink-0">
                              <button onClick={() => updateCommunityPost({ ...post, pinned: !post.pinned })}
                                className="px-2.5 py-1.5 bg-teal-50 text-teal-700 rounded-lg text-xs font-bold hover:bg-teal-100">{post.pinned ? 'فك التثبيت' : 'تثبيت'}</button>
                              <button onClick={() => { setEditingCommunityPostId(post.id); setCommunityPostDraft({ title: post.title, body: post.body, tag: post.tag, authorName: post.authorName, authorRole: post.authorRole, authorImage: post.authorImage, pinned: post.pinned ?? false }); setIsCommunityPostFormOpen(true); }}
                                className="px-2.5 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-100">تعديل</button>
                              <button onClick={() => { if (window.confirm('حذف هذا المنشور؟')) deleteCommunityPost(post.id); }}
                                className="px-2.5 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100">حذف</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Post form modal */}
                    {isCommunityPostFormOpen && (
                      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setIsCommunityPostFormOpen(false)}>
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
                          <h3 className="text-lg font-bold mb-4">{editingCommunityPostId ? 'تعديل المنشور' : 'إضافة منشور'}</h3>
                          <div className="space-y-3">
                            <div><label className="text-xs text-gray-600 mb-1 block">العنوان *</label><input value={communityPostDraft.title} onChange={e => setCommunityPostDraft(d => ({ ...d, title: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                            <div><label className="text-xs text-gray-600 mb-1 block">المحتوى *</label><textarea rows={4} value={communityPostDraft.body} onChange={e => setCommunityPostDraft(d => ({ ...d, body: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" /></div>
                            <div className="grid grid-cols-2 gap-3">
                              <div><label className="text-xs text-gray-600 mb-1 block">التصنيف</label><input value={communityPostDraft.tag} onChange={e => setCommunityPostDraft(d => ({ ...d, tag: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                              <div><label className="text-xs text-gray-600 mb-1 block">اسم الكاتب</label><input value={communityPostDraft.authorName} onChange={e => setCommunityPostDraft(d => ({ ...d, authorName: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                            </div>
                            <div><label className="text-xs text-gray-600 mb-1 block">دور الكاتب</label><input value={communityPostDraft.authorRole} onChange={e => setCommunityPostDraft(d => ({ ...d, authorRole: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={communityPostDraft.pinned} onChange={e => setCommunityPostDraft(d => ({ ...d, pinned: e.target.checked }))} className="w-4 h-4 accent-teal-600" /><span className="text-sm">تثبيت المنشور</span></label>
                          </div>
                          <div className="flex gap-3 mt-4">
                            <button onClick={async () => {
                              if (!communityPostDraft.title.trim() || !communityPostDraft.body.trim()) return;
                              let saved: boolean;
                              if (editingCommunityPostId) {
                                const existing = communityPosts.find(p => p.id === editingCommunityPostId);
                                saved = await updateCommunityPost({ ...existing!, ...communityPostDraft });
                              } else {
                                saved = await addCommunityPost({ id: `post-${Date.now()}`, ...communityPostDraft, likes: 0, comments: 0, createdAt: new Date().toISOString().slice(0,10), status: 'approved' });
                              }
                              if (saved) setIsCommunityPostFormOpen(false);
                            }} disabled={!communityPostDraft.title.trim() || !communityPostDraft.body.trim()}
                              className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-bold hover:bg-teal-700 disabled:opacity-50">حفظ</button>
                            <button onClick={() => setIsCommunityPostFormOpen(false)} className="px-5 bg-gray-200 text-gray-700 rounded-xl">إلغاء</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* -- Library management -- */}
                {communityAdminTab === 'library' && (
                  <div className="space-y-4">
                    <div className="flex justify-end">
                      <button onClick={() => { setEditingCommunityLibraryId(''); setCommunityLibraryDraft({ title: '', description: '', fileType: 'PDF', fileSize: '', downloadUrl: '' }); setIsCommunityLibraryFormOpen(true); }}
                        className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-teal-700">+ ملف جديد</button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {communityLibraryItems.length === 0 ? (
                        <div className="sm:col-span-2 bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400"><p className="text-4xl mb-2">📚</p><p>لا توجد ملفات</p></div>
                      ) : communityLibraryItems.map(item => (
                        <div key={item.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-sm flex-shrink-0">{item.fileType}</div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-800 truncate">{item.title}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{item.fileSize}</p>
                          </div>
                          <div className="flex gap-1.5 flex-shrink-0">
                            <button onClick={() => { setEditingCommunityLibraryId(item.id); setCommunityLibraryDraft({ title: item.title, description: item.description, fileType: item.fileType, fileSize: item.fileSize, downloadUrl: item.downloadUrl }); setIsCommunityLibraryFormOpen(true); }}
                              className="px-2.5 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold">تعديل</button>
                            <button onClick={() => { if (window.confirm('حذف هذا الملف؟')) deleteCommunityLibraryItem(item.id); }}
                              className="px-2.5 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold">حذف</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {isCommunityLibraryFormOpen && (
                      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setIsCommunityLibraryFormOpen(false)}>
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" dir="rtl" onClick={e => e.stopPropagation()}>
                          <h3 className="text-lg font-bold mb-4">{editingCommunityLibraryId ? 'تعديل الملف' : 'إضافة ملف'}</h3>
                          <div className="space-y-3">
                            <div><label className="text-xs text-gray-600 mb-1 block">الاسم *</label><input value={communityLibraryDraft.title} onChange={e => setCommunityLibraryDraft(d => ({ ...d, title: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                            <div><label className="text-xs text-gray-600 mb-1 block">الوصف</label><input value={communityLibraryDraft.description} onChange={e => setCommunityLibraryDraft(d => ({ ...d, description: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                            <div className="grid grid-cols-2 gap-3">
                              <div><label className="text-xs text-gray-600 mb-1 block">النوع</label><input value={communityLibraryDraft.fileType} onChange={e => setCommunityLibraryDraft(d => ({ ...d, fileType: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                              <div><label className="text-xs text-gray-600 mb-1 block">الحجم</label><input value={communityLibraryDraft.fileSize} onChange={e => setCommunityLibraryDraft(d => ({ ...d, fileSize: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                            </div>
                            <div><label className="text-xs text-gray-600 mb-1 block">رابط التحميل</label><input value={communityLibraryDraft.downloadUrl} onChange={e => setCommunityLibraryDraft(d => ({ ...d, downloadUrl: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" dir="ltr" /></div>
                          </div>
                          <div className="flex gap-3 mt-4">
                            <button onClick={async () => {
                              if (!communityLibraryDraft.title.trim()) return;
                              const saved = editingCommunityLibraryId
                                ? await updateCommunityLibraryItem({ id: editingCommunityLibraryId, ...communityLibraryDraft })
                                : await addCommunityLibraryItem({ id: `lib-${Date.now()}`, ...communityLibraryDraft });
                              if (saved) setIsCommunityLibraryFormOpen(false);
                            }} className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-bold hover:bg-teal-700">حفظ</button>
                            <button onClick={() => setIsCommunityLibraryFormOpen(false)} className="px-5 bg-gray-200 text-gray-700 rounded-xl">إلغاء</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* -- Videos management -- */}
                {communityAdminTab === 'videos' && (
                  <div className="space-y-4">
                    <div className="flex justify-end">
                      <button onClick={() => { setEditingCommunityVideoId(''); setCommunityVideoDraft({ title: '', duration: '', viewsLabel: '', thumbnail: '', videoUrl: '', description: '' }); setIsCommunityVideoFormOpen(true); }}
                        className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-teal-700">+ فيديو جديد</button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {communityVideos.length === 0 ? (
                        <div className="sm:col-span-2 bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400"><p className="text-4xl mb-2">🎬</p><p>لا توجد فيديوهات</p></div>
                      ) : communityVideos.map(v => (
                        <div key={v.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex items-start gap-3">
                          {v.thumbnail ? <img src={v.thumbnail} alt="" className="w-16 h-12 rounded-lg object-cover flex-shrink-0" /> : <div className="w-16 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-2xl flex-shrink-0">??</div>}
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-800 truncate">{v.title}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{v.duration} · {v.viewsLabel}</p>
                          </div>
                          <div className="flex gap-1.5 flex-shrink-0">
                            <button onClick={() => { setEditingCommunityVideoId(v.id); setCommunityVideoDraft({ title: v.title, duration: v.duration, viewsLabel: v.viewsLabel, thumbnail: v.thumbnail, videoUrl: v.videoUrl || '', description: v.description || '' }); setIsCommunityVideoFormOpen(true); }}
                              className="px-2.5 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold">تعديل</button>
                            <button onClick={() => { if (window.confirm('حذف هذا الفيديو؟')) deleteCommunityVideo(v.id); }}
                              className="px-2.5 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold">حذف</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {isCommunityVideoFormOpen && (
                      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setIsCommunityVideoFormOpen(false)}>
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" dir="rtl" onClick={e => e.stopPropagation()}>
                          <h3 className="text-lg font-bold mb-4">{editingCommunityVideoId ? 'تعديل الفيديو' : 'إضافة فيديو'}</h3>
                          <div className="space-y-3">
                            <div><label className="text-xs text-gray-600 mb-1 block">العنوان *</label><input value={communityVideoDraft.title} onChange={e => setCommunityVideoDraft(d => ({ ...d, title: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                            <div className="grid grid-cols-2 gap-3">
                              <div><label className="text-xs text-gray-600 mb-1 block">المدة</label><input value={communityVideoDraft.duration} onChange={e => setCommunityVideoDraft(d => ({ ...d, duration: e.target.value }))} placeholder="مثال: 45:00" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                              <div><label className="text-xs text-gray-600 mb-1 block">المشاهدات</label><input value={communityVideoDraft.viewsLabel} onChange={e => setCommunityVideoDraft(d => ({ ...d, viewsLabel: e.target.value }))} placeholder="مثال: 1.2k" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                            </div>
                            <div><label className="text-xs text-gray-600 mb-1 block">رابط الفيديو</label><input value={communityVideoDraft.videoUrl} onChange={e => setCommunityVideoDraft(d => ({ ...d, videoUrl: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" dir="ltr" /></div>
                            <div><label className="text-xs text-gray-600 mb-1 block">الصورة المصغرة</label><input value={communityVideoDraft.thumbnail} onChange={e => setCommunityVideoDraft(d => ({ ...d, thumbnail: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" dir="ltr" /></div>
                          </div>
                          <div className="flex gap-3 mt-4">
                            <button onClick={async () => {
                              if (!communityVideoDraft.title.trim()) return;
                              const saved = editingCommunityVideoId
                                ? await updateCommunityVideo({ id: editingCommunityVideoId, ...communityVideoDraft })
                                : await addCommunityVideo({ id: `vid-${Date.now()}`, ...communityVideoDraft });
                              if (saved) setIsCommunityVideoFormOpen(false);
                            }} className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-bold hover:bg-teal-700">حفظ</button>
                            <button onClick={() => setIsCommunityVideoFormOpen(false)} className="px-5 bg-gray-200 text-gray-700 rounded-xl">إلغاء</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* -- Events management -- */}
                {communityAdminTab === 'events' && (
                  <div className="space-y-4">
                    <div className="flex justify-end">
                      <button onClick={() => { setEditingCommunityEventId(''); setCommunityEventDraft({ dateLabel: '', title: '', eventType: 'ندوة', speaker: '', platform: 'Zoom', eventDate: '', description: '' }); setIsCommunityEventFormOpen(true); }}
                        className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-teal-700">+ فعالية جديدة</button>
                    </div>
                    <div className="space-y-3">
                      {communityEvents.length === 0 ? (
                        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400"><p className="text-4xl mb-2">📅</p><p>لا توجد فعاليات</p></div>
                      ) : communityEvents.map(ev => (
                        <div key={ev.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg font-bold">{ev.eventType}</span>
                              <span className="text-xs text-gray-400">{ev.dateLabel}</span>
                              <span className="text-xs text-gray-400">{ev.platform}</span>
                            </div>
                            <p className="font-bold text-gray-800">{ev.title}</p>
                            <p className="text-xs text-gray-500 mt-0.5">المتحدث: {ev.speaker}</p>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <button onClick={() => { setEditingCommunityEventId(ev.id); setCommunityEventDraft({ dateLabel: ev.dateLabel, title: ev.title, eventType: ev.eventType, speaker: ev.speaker, platform: ev.platform, eventDate: ev.eventDate || '', description: ev.description || '' }); setIsCommunityEventFormOpen(true); }}
                              className="px-2.5 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold">تعديل</button>
                            <button onClick={() => { if (window.confirm('حذف هذه الفعالية؟')) deleteCommunityEvent(ev.id); }}
                              className="px-2.5 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold">حذف</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {isCommunityEventFormOpen && (
                      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setIsCommunityEventFormOpen(false)}>
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" dir="rtl" onClick={e => e.stopPropagation()}>
                          <h3 className="text-lg font-bold mb-4">{editingCommunityEventId ? 'تعديل الفعالية' : 'إضافة فعالية'}</h3>
                          <div className="space-y-3">
                            <div><label className="text-xs text-gray-600 mb-1 block">عنوان الفعالية *</label><input value={communityEventDraft.title} onChange={e => setCommunityEventDraft(d => ({ ...d, title: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                            <div className="grid grid-cols-2 gap-3">
                              <div><label className="text-xs text-gray-600 mb-1 block">نوع الفعالية</label><input value={communityEventDraft.eventType} onChange={e => setCommunityEventDraft(d => ({ ...d, eventType: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                              <div><label className="text-xs text-gray-600 mb-1 block">المنصة</label><input value={communityEventDraft.platform} onChange={e => setCommunityEventDraft(d => ({ ...d, platform: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                            </div>
                            <div><label className="text-xs text-gray-600 mb-1 block">المتحدث</label><input value={communityEventDraft.speaker} onChange={e => setCommunityEventDraft(d => ({ ...d, speaker: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                            <div><label className="text-xs text-gray-600 mb-1 block">تاريخ الفعالية</label><input type="date" value={communityEventDraft.eventDate} onChange={e => setCommunityEventDraft(d => ({ ...d, eventDate: e.target.value, dateLabel: new Date(e.target.value).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' }) }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" /></div>
                            <div><label className="text-xs text-gray-600 mb-1 block">وصف الفعالية</label><textarea value={communityEventDraft.description} onChange={e => setCommunityEventDraft(d => ({ ...d, description: e.target.value }))} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" /></div>
                          </div>
                          <div className="flex gap-3 mt-4">
                            <button onClick={async () => {
                              if (!communityEventDraft.title.trim()) return;
                              const saved = editingCommunityEventId
                                ? await updateCommunityEvent({ id: editingCommunityEventId, ...communityEventDraft })
                                : await addCommunityEvent({ id: `ev-${Date.now()}`, ...communityEventDraft });
                              if (saved) setIsCommunityEventFormOpen(false);
                            }} className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-bold hover:bg-teal-700">حفظ</button>
                            <button onClick={() => setIsCommunityEventFormOpen(false)} className="px-5 bg-gray-200 text-gray-700 rounded-xl">إلغاء</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
            </DashboardCommunityShell>
  );
}
