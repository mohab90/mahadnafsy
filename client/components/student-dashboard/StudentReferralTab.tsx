import { CheckCircle, Copy, Gift, Share2 } from 'lucide-react';

type ReferralStats = {
  uses: number;
  earnings: number;
};

type StudentReferralTabProps = {
  referralCode: string | null;
  referralStats: ReferralStats | null;
  referralCopied: boolean;
  onCopied: () => void;
};

function copyText(text: string) {
  return navigator.clipboard.writeText(text).catch(() => {});
}

export function StudentReferralTab({
  referralCode,
  referralStats,
  referralCopied,
  onCopied,
}: StudentReferralTabProps) {
  const referralLink = referralCode ? `${window.location.origin}/auth?ref=${referralCode}` : '';
  const shareMessage = referralCode
    ? `اتعلمت في معهد الدراسات النفسية وأنصحك بيه.\nسجل من الرابط ده واحصل على مكافأة:\n${referralLink}`
    : '';

  const handleCopy = (text: string) => {
    copyText(text);
    onCopied();
  };

  const handleNativeShare = () => {
    if (navigator.share) {
      navigator.share({
        title: 'معهد الدراسات النفسية',
        text: shareMessage,
        url: referralLink,
      }).catch(() => {});
      return;
    }
    handleCopy(shareMessage);
  };

  return (
    <div className="max-w-xl space-y-5">
      <div className="rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50 to-indigo-50 p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-purple-600 text-white">
            <Gift size={18} />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-gray-900">نظام الإحالة</h3>
            <p className="text-xs text-gray-500">ادع أصدقاءك واكسب مكافآت</p>
          </div>
        </div>

        {referralCode ? (
          <div className="space-y-4">
            <div className="glass-card-premium relative rounded-xl border-2 border-white/50 bg-white/70 p-4 text-center shadow-xl shadow-gray-200/50 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary-500/20">
              <p className="mb-1 text-xs text-gray-400">كود الإحالة الخاص بك</p>
              <p className="font-mono text-2xl font-extrabold tracking-widest text-purple-700">{referralCode}</p>
              <button
                onClick={() => handleCopy(referralCode)}
                className="absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-lg bg-purple-100 text-purple-700 transition hover:bg-purple-200"
              >
                {referralCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="glass-card-premium rounded-xl border border-white/50 bg-white/70 p-4 text-center shadow-xl shadow-gray-200/50 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary-500/20">
                <p className="text-2xl font-extrabold text-gray-900">{referralStats?.uses ?? 0}</p>
                <p className="mt-1 text-xs text-gray-500">عدد الإحالات</p>
              </div>
              <div className="glass-card-premium rounded-xl border border-white/50 bg-white/70 p-4 text-center shadow-xl shadow-gray-200/50 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary-500/20">
                <p className="text-2xl font-extrabold text-emerald-600">
                  {referralStats?.earnings ?? 0} <span className="text-sm">EGP</span>
                </p>
                <p className="mt-1 text-xs text-gray-500">الأرباح المحتملة</p>
              </div>
            </div>

            <div className="glass-card-premium rounded-xl border border-white/50 bg-white/70 p-4 shadow-xl shadow-gray-200/50 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary-500/20">
              <p className="mb-2 text-xs text-gray-500">رابط الإحالة، شاركه مع أصدقائك:</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={referralLink}
                  className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600"
                />
                <button
                  onClick={() => handleCopy(referralLink)}
                  className="flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-2 text-xs text-white hover:bg-purple-700"
                >
                  <Share2 size={12} /> نسخ
                </button>
              </div>

              <div className="mt-3 flex gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareMessage)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  <Share2 size={13} /> شارك على واتساب
                </a>
                <button
                  onClick={handleNativeShare}
                  className="rounded-lg bg-gray-100 px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-200"
                >
                  مشاركة أخرى
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-gray-400">
            <Share2 size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">نظام الإحالة متاح للمشتركين المسجلين فقط</p>
          </div>
        )}
      </div>
    </div>
  );
}
