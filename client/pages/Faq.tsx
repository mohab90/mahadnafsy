import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, HelpCircle, Plus } from 'lucide-react';
import { setCanonical } from '../lib/useSeo';
import PageHeader from '../components/PageHeader';

type Faq = { id: string; question: string; answer: string; category: string };

const Faq: React.FC = () => {
  const [list, setList] = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'الأسئلة الشائعة | معهد الدراسات النفسية';
    // Without this the canonical stays on whichever page loaded first.
    setCanonical('/faq');
    fetch('/api/faq')
      .then(r => (r.ok ? r.json() : []))
      .then(rows => setList(Array.isArray(rows) ? rows : []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, []);

  const byCat = list.reduce<Record<string, Faq[]>>((acc, f) => { (acc[f.category] ||= []).push(f); return acc; }, {});

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5"><HelpCircle size={15} />قبل ما تحجز</span>}
        title="الأسئلة الشائعة"
        subtitle="إجابات على أكثر الأسئلة تكراراً — لو لم تجد ما تبحث عنه، تواصل معنا."
      />

      <section className="bg-white py-14 sm:py-20">
        <div className="container mx-auto max-w-3xl px-4">
          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="h-8 w-8 rounded-full border-2 border-line border-t-primary-700 motion-safe:animate-spin" /></div>
          ) : list.length === 0 ? (
            <p className="rounded-[24px] border border-line bg-paper px-5 py-14 text-center text-muted">لا توجد أسئلة متاحة حالياً.</p>
          ) : (
            <div className="space-y-10">
              {Object.entries(byCat).map(([cat, items]) => (
                <div key={cat}>
                  <h2 className="text-2xl font-black leading-tight text-ink sm:text-[28px]">{cat}</h2>
                  <div className="mt-4 divide-y divide-line rounded-[26px] border border-line bg-white">
                    {items.map(f => {
                      const isOpen = open === f.id;
                      return (
                        <div key={f.id}>
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => setOpen(isOpen ? null : f.id)}
                            className="flex min-h-[60px] w-full items-center justify-between gap-4 px-5 py-4 text-right text-base font-extrabold text-ink sm:text-[17px]"
                          >
                            <span className="min-w-0">{f.question}</span>
                            <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-full transition ${isOpen ? 'rotate-45 bg-primary-700 text-white' : 'bg-paper text-muted-strong'}`}><Plus size={18} /></span>
                          </button>
                          <div className={`grid transition-all duration-300 motion-reduce:transition-none ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                            <div className="overflow-hidden px-5 text-[15px] leading-[1.9] text-muted-body">
                              <span className="block whitespace-pre-line pb-5">{f.answer}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-12 flex flex-col items-center gap-4 rounded-[28px] bg-ink px-5 py-8 text-center text-white sm:flex-row sm:justify-between sm:px-8 sm:text-right">
            <p className="text-lg font-black">لم تجد إجابتك؟</p>
            <Link to="/contact" className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-gold-light px-7 font-black text-ink transition hover:brightness-105 sm:w-auto">
              تواصل معنا
              <ArrowLeft size={18} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Faq;
