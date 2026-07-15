import React from 'react';
import { ChevronRight, ExternalLink, MessageSquare, Star, ThumbsUp, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CommunityPostItem } from '../../types';

interface StudentCommunityTabProps {
  approvedPosts: CommunityPostItem[];
}

export const StudentCommunityTab: React.FC<StudentCommunityTabProps> = ({ approvedPosts }) => (
  <div className="max-w-3xl space-y-5">
    <div className="bg-gradient-to-l from-primary-700 to-primary-900 rounded-2xl p-5 text-white flex items-center justify-between gap-4">
      <div>
        <h3 className="font-extrabold text-lg mb-1">مجتمع معهد الدراسات النفسية</h3>
        <p className="text-primary-200 text-sm">شارك أفكارك وتجاربك مع زملائك في المعهد</p>
      </div>
      <Link to="/community" className="flex items-center gap-2 bg-white/15 hover:bg-white/25 border border-white/20 text-white font-bold px-4 py-2.5 rounded-xl transition text-sm">
        <Users size={15} /> انضم للمجتمع
      </Link>
    </div>

    {approvedPosts.length === 0 ? (
      <div className="rounded-2xl border border-white/50 p-10 text-center glass-card-premium shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-primary-500/20 transition-all duration-300 hover:-translate-y-2 backdrop-blur-xl bg-white/70">
        <Users size={36} className="text-gray-200 mx-auto mb-3" />
        <p className="text-gray-500 font-bold mb-1">لا توجد منشورات بعد</p>
        <p className="text-xs text-gray-400">كن أول من يشارك في مجتمع المعهد</p>
      </div>
    ) : (
      <>
        {approvedPosts.slice(0, 8).map((post) => (
          <div key={post.id} className="rounded-2xl border border-white/50 p-5 glass-card-premium shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-primary-500/20 transition-all duration-300 hover:-translate-y-2 backdrop-blur-xl bg-white/70">
            {post.pinned && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600 font-bold mb-3 bg-amber-50 px-3 py-1.5 rounded-lg w-fit">
                <Star size={12} /> منشور مثبت
              </div>
            )}
            <div className="flex items-center gap-3 mb-3">
              {post.authorImage ? (
                <img src={post.authorImage} alt={post.authorName} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {post.authorName.charAt(0)}
                </div>
              )}
              <div>
                <p className="font-bold text-gray-900 text-sm">{post.authorName}</p>
                <p className="text-xs text-gray-400">{post.authorRole} - {post.createdAt}</p>
              </div>
              {post.tag && (
                <span className="mr-auto text-[11px] bg-primary-50 text-primary-700 font-bold px-2.5 py-1 rounded-full">{post.tag}</span>
              )}
            </div>
            <h4 className="font-bold text-gray-900 mb-2">{post.title}</h4>
            <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">{post.body}</p>
            <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-50 text-xs text-gray-400">
              <span className="flex items-center gap-1.5"><ThumbsUp size={13} /> {post.likes} إعجاب</span>
              <span className="flex items-center gap-1.5"><MessageSquare size={13} /> {post.comments} تعليق</span>
              <Link to="/community" className="mr-auto flex items-center gap-1 text-primary-600 hover:text-primary-700 font-bold">
                <ExternalLink size={12} /> قراءة المزيد
              </Link>
            </div>
          </div>
        ))}
        {approvedPosts.length > 8 && (
          <div className="text-center">
            <Link to="/community" className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-bold px-6 py-3 rounded-xl transition">
              عرض كل المنشورات ({approvedPosts.length}) <ChevronRight size={16} className="rtl:rotate-180" />
            </Link>
          </div>
        )}
      </>
    )}
  </div>
);
