import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Clock, Lock, ShieldCheck, Video } from 'lucide-react';
import type { Currency, Therapist } from '../../types';
import { cdnImg } from '../../lib/img';
import { expressPrice } from '../../lib/consultations';
import { Reveal } from './Reveal';

type Content = Record<string, string>;

/**
 * «متاح الآن — جلسة فورية» — the express session, with the therapist who takes
 * it (express.therapistId) and its price in the visitor's currency.
 * «اعرض قسم الاستشارة في الرئيسية» switches the whole slide off.
 */
const ConsultationSection: React.FC<{ content: Content; therapists: Therapist[]; currency: Currency }> = ({ content, therapists, currency }) => {
  const therapist = therapists.find(t => t.id === content['express.therapistId'] && t.image) || therapists.find(t => t.showOnHome && t.image) || null;
  const price = expressPrice(content, currency);
  const sym = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';

  return (
    <section className="cv-auto bg-paper px-4 py-16 sm:py-24">
      <Reveal className="container mx-auto">
        <div className="grid overflow-hidden rounded-[36px] bg-white shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] ring-1 ring-line lg:grid-cols-[.75fr_1.25fr]">
          <div className="relative flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-primary-700 to-[#4c0519] px-6 py-10 text-center text-white sm:py-12">
            <div aria-hidden="true" className="absolute inset-0 opacity-[.12]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.7) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
            <span className="relative inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[13px] font-extrabold text-ink shadow-lg">
              <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-70 motion-safe:animate-ping" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" /></span>
              متاح الآن — جلسة فورية
            </span>
            {therapist && (
              <>
                <span className="relative mt-7 block rounded-full bg-gradient-to-br from-gold-pale to-gold p-1.5 shadow-2xl">
                  <img src={cdnImg(therapist.image, 320)} alt={therapist.name} loading="lazy" className="h-36 w-36 rounded-full border-4 border-[#4c0519] object-cover object-top sm:h-40 sm:w-40" />
                  <span aria-hidden="true" className="absolute bottom-3 right-3 h-5 w-5 rounded-full border-4 border-[#4c0519] bg-green-500" />
                </span>
                <b className="relative mt-4 block text-xl font-black">{therapist.name}</b>
                <span className="relative text-sm text-white/75">{therapist.title || therapist.specialty}</span>
              </>
            )}
            <span className="relative mt-6 flex flex-wrap justify-center gap-2">
              {['جلسة فردية', 'سرية تامة', 'أونلاين'].map(tag => <span key={tag} className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold ring-1 ring-white/20">{tag}</span>)}
            </span>
          </div>

          <div className="flex flex-col justify-center p-6 text-center sm:p-10 lg:p-12 lg:text-right">
            <span className="text-sm font-extrabold text-gold-deep">استشارة نفسية أونلاين</span>
            <h2 className="mt-2 text-3xl font-black leading-tight text-ink sm:text-4xl">{content['home.express.title'] || 'تحدث مع معالج نفسي متخصص الآن'}</h2>
            <p className="mt-3 text-base leading-relaxed text-muted-body sm:text-lg">{content['home.express.subtitle'] || 'جلسة خاصة عبر الإنترنت. احجز في دقائق واحصل على دعم فوري.'}</p>

            <ul className="mx-auto mt-6 grid max-w-md gap-2.5 text-right sm:grid-cols-2 lg:mx-0 lg:max-w-none">
              {[
                { icon: Lock, text: 'خصوصية تامة وسرية كاملة' },
                { icon: Clock, text: 'استجابة خلال ساعات' },
                { icon: ShieldCheck, text: 'معالجون معتمدون ومتخصصون' },
                { icon: Video, text: 'فيديو أو صوت — اختيارك' },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2.5 text-[15px] font-bold text-[#3d2f2b]">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary-50 text-primary-700"><Icon size={17} /></span>
                  {text}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center lg:justify-start">
              <div className="text-center lg:text-right">
                <span className="block text-[13px] text-muted-soft">سعر الجلسة</span>
                {price > 0
                  ? <span className="text-4xl font-black tabular-nums text-ink">{price.toLocaleString('ar-EG-u-nu-latn')} <span className="text-xl text-primary-700">{sym}</span></span>
                  : <span className="text-xl font-black text-ink">احجز ونبلغك بالسعر</span>}
              </div>
              <Link to="/consultations" className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-8 text-lg font-black text-white shadow-[0_16px_30px_-12px_rgba(159,18,57,.8)] transition hover:bg-primary-800 sm:w-auto">
                احجز جلستك الآن
                <ArrowLeft size={20} />
              </Link>
            </div>
            <p className="mt-3 text-[13px] text-muted-soft">{content['home.express.note'] || 'سيتواصل معك المعالج خلال ساعات'}</p>
          </div>
        </div>
      </Reveal>
    </section>
  );
};

export default ConsultationSection;
