import React from 'react';
import { Gift, Share2, Copy, CheckCircle } from 'lucide-react';

interface ReferralTabProps {
  referralCode: string | null;
  referralStats: { uses: number; earnings: number } | null;
  referralCopied: boolean;
  setReferralCopied: React.Dispatch<React.SetStateAction<boolean>>;
}

export const ReferralTab: React.FC<ReferralTabProps> = ({
  referralCode,
  referralStats,
  referralCopied,
  setReferralCopied,
}) => {
  return (
    <div className="max-w-xl space-y-5">
      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl border border-purple-100 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-purple-600 grid place-items-center text-white"><Gift size={18} /></div>
          <div>
            <h3 className="font-extrabold text-gray-900 text-base">نظام الإحالة</h3>
            <p className="text-xs text-gray-500">ادعُ أصدقاءك وكسب مكافآت</p>
          </div>
        </div>
        {referralCode ? (
          <div className="space-y-4">
            {/* Code box */}
            <div className="bg-white rounded-xl border-2 border-purple-200 p-4 text-center relative">
              <p className="text-xs text-gray-400 mb-1">كود الإحالة الخاص بك</p>
              <p className="font-mono font-extrabold text-2xl text-purple-700 tracking-widest">{referralCode}</p>
              <button
                onClick={() => { navigator.clipboard.writeText(referralCode).catch(() => {}); setReferralCopied(true); setTimeout(() => setReferralCopied(false), 2000); }}
                className="absolute top-3 left-3 w-8 h-8 rounded-lg bg-purple-100 hover:bg-purple-200 grid place-items-center text-purple-700 transition"
              >
                {referralCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
              </button>
            </div>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-xl border border-gray-100 p-4 text-center shadow-sm">
                <p className="text-2xl font-extrabold text-gray-900">{referralStats?.uses ?? 0}</p>
                <p className="text-xs text-gray-500 mt-1">عدد الإحالات</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4 text-center shadow-sm">
                <p className="text-2xl font-extrabold text-emerald-600">{referralStats?.earnings ?? 0} <span className="text-sm">EGP</span></p>
                <p className="text-xs text-gray-500 mt-1">الأرباح المحتملة</p>
              </div>
            </div>
            {/* Share link */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-500 mb-2">رابط الإحالة — شاركه مع أصدقائك:</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={`${window.location.origin}/auth?ref=${referralCode}`}
                  className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono text-gray-600"
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/auth?ref=${referralCode}`).catch(() => {}); setReferralCopied(true); setTimeout(() => setReferralCopied(false), 2000); }}
                  className="bg-purple-600 text-white text-xs rounded-lg px-3 py-2 hover:bg-purple-700 flex items-center gap-1"
                >
                  <Share2 size={12} /> نسخ
                </button>
              </div>
              {/* One-tap share — the viral loop */}
              {(() => {
                const link = `${window.location.origin}/auth?ref=${referralCode}`;
                const msg = `اتعلّمت في معهد الدراسات النفسية وأنصحك بيه! 🌿\nسجّل من اللينك ده واحصل على مكافأة:\n${link}`;
                return (
                  <div className="flex gap-2 mt-3">
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(msg)}`}
                      target="_blank" rel="noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg py-2.5"
                    >
                      <Share2 size={13} /> شارك على واتساب
                    </a>
                    <button
                      onClick={() => {
                        if (navigator.share) navigator.share({ title: 'معهد الدراسات النفسية', text: msg, url: link }).catch(() => {});
                        else { navigator.clipboard.writeText(msg).catch(() => {}); setReferralCopied(true); setTimeout(() => setReferralCopied(false), 2000); }
                      }}
                      className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg py-2.5"
                    >
                      مشاركة أخرى
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <Share2 size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">نظام الإحالة متاح للمشتركين المسجلين فقط</p>
          </div>
        )}
      </div>
    </div>
  );
};
