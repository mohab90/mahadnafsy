import React, { useEffect, useState } from 'react';
import { Download, FileText, Lock } from 'lucide-react';
import { mysqlCatalog, type CourseDocumentView } from '../../lib/mysqlapi';
import { useSiteData } from '../../context/SiteDataContext';

const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} ميجا` : `${Math.max(1, Math.round(bytes / 1024))} ك.ب`);

/**
 * «ملفات الدبلومة»: up to three PDFs per course — one free, one after the booking and a first payment, the full one after 80% of the price. The server says, for the
 * person looking, which are open (api/routes/course-documents.js); it never sends where a file is, and refuses a file that has not been earned. Nothing is drawn
 * for a course that has none.
 */
export const CourseDocumentsSection: React.FC<{ courseId: string; compact?: boolean; heading?: string }> = ({ courseId, compact = false, heading }) => {
  const { authUser } = useSiteData();
  const [documents, setDocuments] = useState<CourseDocumentView[]>([]);

  // asked again when the person signs in or out: the answer is theirs
  useEffect(() => {
    let alive = true;
    mysqlCatalog.getCourseDocuments(courseId).then(result => { if (alive) setDocuments(result.documents || []); }).catch(() => { if (alive) setDocuments([]); });
    return () => { alive = false; };
  }, [courseId, authUser?.uid]);

  if (documents.length === 0) return null;

  return (
    <section id={compact ? undefined : 'course-documents'} aria-labelledby={`course-documents-title-${courseId}`} className={compact ? '' : 'scroll-mt-40'}>
      <h2 id={`course-documents-title-${courseId}`} className={compact ? 'mb-2 text-sm font-bold text-gray-800' : 'mb-4 text-2xl font-extrabold text-gray-900'}>{heading || 'ملفات الدبلومة'}</h2>
      <ul className="space-y-3">
        {documents.map(item => (
          <li key={item.tier} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${item.open ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-gray-50'}`}>
            <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${item.open ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-400'}`}>
              {item.open ? <FileText size={20} /> : <Lock size={18} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-gray-900">{item.title}</p>
              <p className="text-xs text-gray-500">
                PDF · {sizeLabel(item.size)}
                {!item.open && <> · <span className="font-semibold text-amber-700">{item.requirement}</span></>}
              </p>
            </div>
            {item.open ? (
              <a
                href={`/api/courses/${encodeURIComponent(courseId)}/documents/${item.tier}/file`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-primary-700"
              >
                <Download size={15} />فتح الملف
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-gray-200 px-4 py-2 text-sm font-bold text-gray-500">
                <Lock size={14} />{authUser?.uid ? 'مقفول' : 'سجّل دخولك'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};
