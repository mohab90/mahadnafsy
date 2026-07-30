import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ShieldX, Award } from 'lucide-react';
import { mysqlClient } from '../lib/mysqlapi';

interface VerifiedCertificate {
  certificate_code: string;
  completed_at: string;
  subscriber_name: string;
  course_title: string;
}

// Public certificate verification page (LMS-04) — the real backend endpoint
// (GET /api/completions/verify/:code) already existed and is what the printed
// certificate's QR code links to, but nothing on the client consumed it: the
// QR just led to a 404. No auth required — the certificate code itself is the
// credential, same as any physical certificate serial number.
const CertificateVerify: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const [loading, setLoading] = useState(true);
  const [cert, setCert] = useState<VerifiedCertificate | null>(null);
  const [revoked, setRevoked] = useState(false);

  useEffect(() => {
    document.title = 'التحقق من الشهادة | معهد الدراسات النفسية';
    if (!code) { setLoading(false); return; }
    let cancelled = false;
    mysqlClient.verifyCertificate(code)
      .then((row) => { if (!cancelled) setCert(row as unknown as VerifiedCertificate); })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCert(null);
          setRevoked(error instanceof Error && /revoked/i.test(error.message));
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code]);

  return (
    <div className="bg-gray-50 min-h-screen flex items-center justify-center py-16 px-4" dir="rtl">
      <div className="bg-white border border-gray-200 rounded-3xl shadow-sm p-8 w-full max-w-md text-center">
        {loading ? (
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
        ) : cert ? (
          <>
            <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-3" />
            <h1 className="text-xl font-extrabold text-gray-900">شهادة موثّقة ✅</h1>
            <div className="mt-6 space-y-3 text-right bg-gray-50 border border-gray-100 rounded-2xl p-5">
              <div>
                <p className="text-xs text-gray-400">اسم المتدرب</p>
                <p className="font-bold text-gray-800">{cert.subscriber_name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">الكورس</p>
                <p className="font-bold text-gray-800">{cert.course_title}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">تاريخ الإتمام</p>
                <p className="font-bold text-gray-800">{new Date(cert.completed_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                <Award size={16} className="text-amber-500 flex-shrink-0" />
                <p className="text-xs font-mono text-gray-500">{cert.certificate_code}</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-5">صادرة عن معهد الدراسات النفسية</p>
          </>
        ) : (
          <>
            <ShieldX size={48} className="text-red-400 mx-auto mb-3" />
            <h1 className="text-xl font-extrabold text-gray-900">{revoked ? 'الشهادة ملغاة' : 'الشهادة غير موجودة'}</h1>
            <p className="text-gray-500 mt-2 text-sm">{revoked ? 'تم إلغاء صلاحية هذه الشهادة بواسطة الإدارة، ولم تعد صالحة للتحقق.' : 'تأكد من صحة الرابط أو كود الشهادة، أو أن الشهادة لم تُصدر بعد.'}</p>
          </>
        )}
      </div>
    </div>
  );
};

export default CertificateVerify;
