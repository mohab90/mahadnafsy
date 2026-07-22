import React, { useEffect, useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

type Faq = { id: string; question: string; answer: string; category: string };

const Faq: React.FC = () => {
  const [list, setList] = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'الأسئلة الشائعة | معهد الدراسات النفسية';
    fetch('/api/faq')
      .then(r => (r.ok ? r.json() : []))
      .then(rows => setList(Array.isArray(rows) ? rows : []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, []);

  const byCat = list.reduce<Record<string, Faq[]>>((acc, f) => { (acc[f.category] ||= []).push(f); return acc; }, {});

  return (
    <div className="bg-gray-50 min-h-screen py-16 animate-fade-in" dir="rtl">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-100 text-primary-600 mb-3"><HelpCircle size={26} /></div>
          <h1 className="text-3xl font-extrabold text-gray-900">الأسئلة الشائعة</h1>
          <p className="text-gray-500 mt-2">إجابات على أكثر الأسئلة تكراراً — لو لم تجد ما تبحث عنه، تواصل معنا.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
        ) : list.length === 0 ? (
          <p className="text-center text-gray-400 py-16">لا توجد أسئلة متاحة حالياً.</p>
        ) : (
          <div className="space-y-8">
            {Object.entries(byCat).map(([cat, items]) => (
              <div key={cat}>
                <h2 className="text-lg font-bold text-primary-700 mb-3">{cat}</h2>
                <div className="space-y-2">
                  {items.map(f => {
                    const isOpen = open === f.id;
                    return (
                      <div key={f.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                        <button onClick={() => setOpen(isOpen ? null : f.id)}
                          className="w-full flex items-center justify-between gap-3 px-5 py-4 text-right hover:bg-gray-50 transition">
                          <span className="font-semibold text-gray-800">{f.question}</span>
                          <ChevronDown size={18} className={`text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isOpen && (
                          <div className="px-5 pb-4 text-gray-600 text-sm leading-relaxed whitespace-pre-line border-t border-gray-50 pt-3">{f.answer}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Faq;
