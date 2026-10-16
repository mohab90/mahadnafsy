import React, { useState, useEffect } from 'react';
import { Mail, Phone, MapPin, Send, MessageCircle, Facebook, Instagram, Youtube, CheckCircle, Clock } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { instituteWhatsApp } from '../lib/whatsappLink';
import { CAIRO_TIME_ZONE } from '../../shared/cairoDate';
import { useSeo } from '../lib/useSeo';
import PageHeader from '../components/PageHeader';

const Contact: React.FC = () => {
  useSeo({ title: 'تواصل معنا | معهد الدراسات النفسية', path: '/contact', description: 'تواصل مع معهد الدراسات النفسية — هاتف، واتساب، بريد إلكتروني ونموذج مراسلة.' });
  const { content, addContactMessage } = useSiteData();
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: '', message: '' });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const phone = content['footer.phone'] || '+20 100 000 0000';
  const email = content['footer.email'] || 'info@psy-institute.com';
  const address = content['footer.address'] || 'القاهرة، مصر الجديدة';
  const whatsapp = instituteWhatsApp(content);
  const facebook = content['footer.facebook'] || '';
  const instagram = content['footer.instagram'] || '';
  const youtube = content['footer.youtube'] || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError('');
    try {
      await addContactMessage({
        id: `cm-${Date.now()}`,
        name: form.name,
        email: form.email || undefined,
        phone: form.phone,
        subject: form.subject || undefined,
        message: form.message,
        status: 'new',
        createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: CAIRO_TIME_ZONE }),
      });
      setSubmitted(true);
    } catch {
      setSubmitError('تعذر إرسال رسالتك حاليًا. لم يتم حفظها، يرجى المحاولة مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';
  const labelCls = 'mb-1 block text-[13px] font-bold text-muted-strong';
  const socialCls = 'inline-flex min-h-[44px] items-center gap-2 rounded-full bg-paper px-4 text-sm font-extrabold text-muted-strong ring-1 ring-line transition hover:text-ink hover:ring-line-deep';

  return (
    <div className="min-h-screen bg-white">
      <PageHeader
        eyebrow="نحن هنا لمساعدتك"
        title={content['contact.heroTitle'] || 'تواصل معنا'}
        subtitle={content['contact.heroSubtitle'] || 'نحن هنا للإجابة على جميع استفساراتك. لا تتردد في التواصل معنا في أي وقت.'}
      />

      <section className="bg-white py-14 sm:py-20">
        <div className="container mx-auto grid grid-cols-1 gap-6 px-4 lg:grid-cols-5 lg:gap-8">
          {/* Contact Form */}
          <div className="lg:col-span-3">
            <div className="rounded-[28px] border border-line bg-white p-5 shadow-[0_40px_80px_-55px_rgba(26,15,18,.45)] sm:p-8">
              <h2 className="text-2xl font-black text-ink sm:text-3xl">
                {content['contact.form.title'] || 'أرسل لنا رسالة'}
              </h2>
              <p className="mt-2 text-base text-muted-body">
                {content['contact.form.subtitle'] || 'سنرد عليك خلال 24 ساعة عمل.'}
              </p>

              {submitted ? (
                <div className="py-14 text-center">
                  <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-50 text-green-600">
                    <CheckCircle size={44} />
                  </span>
                  <h3 className="mt-5 text-2xl font-black text-ink">تم استلام رسالتك!</h3>
                  <p className="mt-2 text-muted-body">سنتواصل معك قريباً. شكراً لثقتك بنا.</p>
                  <button
                    onClick={() => { setSubmitted(false); setForm({ name: '', email: '', phone: '', subject: '', message: '' }); }}
                    className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-2xl border-[1.5px] border-ink/15 bg-white px-6 font-extrabold text-ink transition hover:border-ink/40"
                  >
                    إرسال رسالة أخرى
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="mt-7 space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className={labelCls}>الاسم الكامل *</label>
                      <input
                        required
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="محمد أحمد"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>رقم الهاتف *</label>
                      <input
                        required
                        type="tel"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        placeholder="مثال: +20 100 000 0000"
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>البريد الإلكتروني</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="مثال: name@example.com"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>موضوع الرسالة</label>
                    <select
                      value={form.subject}
                      onChange={(e) => setForm({ ...form, subject: e.target.value })}
                      className={inputCls}
                    >
                      <option value="">اختر الموضوع</option>
                      <option value="courses">استفسار عن الدبلومات والبرامج</option>
                      <option value="consultations">حجز استشارة نفسية</option>
                      <option value="technical">مشكلة تقنية</option>
                      <option value="payment">استفسار عن الدفع والأسعار</option>
                      <option value="partnership">طلب شراكة أو تعاون</option>
                      <option value="join">الانضمام كمحاضر أو مستشار</option>
                      <option value="other">أخرى</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>رسالتك *</label>
                    <textarea
                      required
                      rows={5}
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      placeholder="اكتب رسالتك هنا..."
                      className={`${inputCls} resize-none py-3`}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Send size={18} />
                    {submitting ? 'جارٍ الإرسال...' : 'إرسال الرسالة'}
                  </button>
                  {submitError && (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</p>
                  )}
                </form>
              )}
            </div>
          </div>

          {/* Contact Info Sidebar */}
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-[28px] bg-ink p-5 text-white sm:p-7">
              <h3 className="text-lg font-black">معلومات التواصل</h3>
              <div className="mt-5 space-y-2">
                <a href={`tel:${phone}`} className="group flex min-h-[56px] items-center gap-4 rounded-2xl p-2 transition hover:bg-white/[.06]">
                  <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10 text-gold-light">
                    <Phone size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-white/65">هاتف</p>
                    <p dir="ltr" className="break-words text-right font-bold tabular-nums">{phone}</p>
                  </div>
                </a>
                {whatsapp && (
                  <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className="group flex min-h-[56px] items-center gap-4 rounded-2xl p-2 transition hover:bg-white/[.06]">
                    <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10 text-green-400">
                      <MessageCircle size={20} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-white/65">واتساب</p>
                      <p dir="ltr" className="break-words text-right font-bold tabular-nums">{whatsapp}</p>
                    </div>
                  </a>
                )}
                <a href={`mailto:${email}`} className="group flex min-h-[56px] items-center gap-4 rounded-2xl p-2 transition hover:bg-white/[.06]">
                  <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10 text-gold-light">
                    <Mail size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-white/65">البريد الإلكتروني</p>
                    <p className="break-all font-bold">{email}</p>
                  </div>
                </a>
                <div className="flex min-h-[56px] items-center gap-4 p-2">
                  <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10 text-gold-light">
                    <MapPin size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-white/65">العنوان</p>
                    <p className="font-bold">{address}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Business Hours */}
            <div className="rounded-[24px] border border-line bg-white p-5 sm:p-6">
              <h3 className="flex items-center gap-2 text-lg font-black text-ink">
                <Clock size={18} className="text-primary-700" />
                أوقات العمل
              </h3>
              <div className="mt-4 divide-y divide-line text-sm">
                <div className="flex items-center justify-between gap-3 pb-3">
                  <span className="text-muted-body">السبت – الخميس</span>
                  <span className="font-black tabular-nums text-ink">9:00 ص – 10:00 م</span>
                </div>
                <div className="flex items-center justify-between gap-3 pt-3">
                  <span className="text-muted-body">الجمعة</span>
                  <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-extrabold text-primary-700">مغلق</span>
                </div>
              </div>
            </div>

            {/* Social Links */}
            {(facebook || instagram || youtube || whatsapp) && (
              <div className="rounded-[24px] border border-line bg-white p-5 sm:p-6">
                <h3 className="text-lg font-black text-ink">تابعنا على</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {facebook && (
                    <a href={facebook} target="_blank" rel="noreferrer" className={socialCls}>
                      <Facebook size={16} /> فيسبوك
                    </a>
                  )}
                  {instagram && (
                    <a href={instagram} target="_blank" rel="noreferrer" className={socialCls}>
                      <Instagram size={16} /> إنستجرام
                    </a>
                  )}
                  {youtube && (
                    <a href={youtube} target="_blank" rel="noreferrer" className={socialCls}>
                      <Youtube size={16} /> يوتيوب
                    </a>
                  )}
                  {whatsapp && (
                    <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className={socialCls}>
                      <MessageCircle size={16} className="text-green-600" /> واتساب
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Contact;
