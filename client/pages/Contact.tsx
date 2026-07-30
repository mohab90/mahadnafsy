import React, { useState, useEffect } from 'react';
import { Mail, Phone, MapPin, Send, MessageCircle, Facebook, Instagram, Youtube, CheckCircle, Clock } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';

const Contact: React.FC = () => {
  useEffect(() => { document.title = 'تواصل معنا | معهد الدراسات النفسية'; }, []);
  const { content, addContactMessage } = useSiteData();
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: '', message: '' });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const phone = content['footer.phone'] || '+20 100 000 0000';
  const email = content['footer.email'] || 'info@psy-institute.com';
  const address = content['footer.address'] || 'القاهرة، مصر الجديدة';
  const whatsapp = content['footer.whatsapp'] || '';
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
        createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      });
      setSubmitted(true);
    } catch {
      setSubmitError('تعذر إرسال رسالتك حاليًا. لم يتم حفظها، يرجى المحاولة مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen animate-fade-in">
      {/* Hero */}
      <div className="bg-gray-900 text-white py-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-primary-900/20"></div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary-600 rounded-full blur-[100px] opacity-20"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary-500 rounded-full blur-[100px] opacity-20"></div>
        <div className="container mx-auto px-4 relative z-10 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 animate-slide-up">
            {content['contact.heroTitle'] || 'تواصل معنا'}
          </h1>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto animate-slide-up" style={{ animationDelay: '0.1s' }}>
            {content['contact.heroSubtitle'] || 'نحن هنا للإجابة على جميع استفساراتك. لا تتردد في التواصل معنا في أي وقت.'}
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">
          {/* Contact Form */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {content['contact.form.title'] || 'أرسل لنا رسالة'}
              </h2>
              <p className="text-gray-500 mb-8">
                {content['contact.form.subtitle'] || 'سنرد عليك خلال 24 ساعة عمل.'}
              </p>

              {submitted ? (
                <div className="text-center py-16">
                  <CheckCircle size={64} className="mx-auto text-emerald-500 mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">تم استلام رسالتك!</h3>
                  <p className="text-gray-500">سنتواصل معك قريباً. شكراً لثقتك بنا.</p>
                  <button
                    onClick={() => { setSubmitted(false); setForm({ name: '', email: '', phone: '', subject: '', message: '' }); }}
                    className="mt-6 text-primary-600 font-bold hover:underline"
                  >
                    إرسال رسالة أخرى
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">الاسم الكامل *</label>
                      <input
                        required
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="محمد أحمد"
                        className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">رقم الهاتف *</label>
                      <input
                        required
                        type="tel"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        placeholder="مثال: +20 100 000 0000"
                        className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 transition"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">البريد الإلكتروني</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="مثال: name@example.com"
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">موضوع الرسالة</label>
                    <select
                      value={form.subject}
                      onChange={(e) => setForm({ ...form, subject: e.target.value })}
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 transition bg-white"
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
                    <label className="block text-sm font-bold text-gray-700 mb-1">رسالتك *</label>
                    <textarea
                      required
                      rows={5}
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      placeholder="اكتب رسالتك هنا..."
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 transition resize-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-primary-600 hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition"
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
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
              <h3 className="font-bold text-gray-900 text-lg mb-6">معلومات التواصل</h3>
              <div className="space-y-4">
                <a href={`tel:${phone}`} className="flex items-center gap-4 group">
                  <div className="w-12 h-12 rounded-2xl bg-primary-50 flex items-center justify-center text-primary-600 group-hover:bg-primary-100 transition flex-shrink-0">
                    <Phone size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">هاتف</p>
                    <p className="font-bold text-gray-900 group-hover:text-primary-600 transition">{phone}</p>
                  </div>
                </a>
                {whatsapp && (
                  <a href={`https://wa.me/${whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-4 group">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-100 transition flex-shrink-0">
                      <MessageCircle size={20} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">واتساب</p>
                      <p className="font-bold text-gray-900 group-hover:text-emerald-600 transition">{whatsapp}</p>
                    </div>
                  </a>
                )}
                <a href={`mailto:${email}`} className="flex items-center gap-4 group">
                  <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-100 transition flex-shrink-0">
                    <Mail size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">البريد الإلكتروني</p>
                    <p className="font-bold text-gray-900 group-hover:text-blue-600 transition">{email}</p>
                  </div>
                </a>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600 flex-shrink-0">
                    <MapPin size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">العنوان</p>
                    <p className="font-bold text-gray-900">{address}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Business Hours */}
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
              <h3 className="font-bold text-gray-900 text-lg mb-4 flex items-center gap-2">
                <Clock size={18} className="text-primary-500" />
                أوقات العمل
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                  <span className="text-gray-600">السبت – الخميس</span>
                  <span className="font-bold text-gray-900">9:00 ص – 10:00 م</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">الجمعة</span>
                  <span className="text-gray-400 bg-red-50 text-red-500 px-2 py-0.5 rounded-full text-xs font-bold">مغلق</span>
                </div>
              </div>
            </div>

            {/* Social Links */}
            {(facebook || instagram || youtube || whatsapp) && (
              <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
                <h3 className="font-bold text-gray-900 text-lg mb-4">تابعنا على</h3>
                <div className="flex gap-3 flex-wrap">
                  {facebook && (
                    <a href={facebook} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-blue-50 text-blue-700 hover:bg-blue-100 transition rounded-xl px-4 py-2 text-sm font-bold">
                      <Facebook size={16} /> فيسبوك
                    </a>
                  )}
                  {instagram && (
                    <a href={instagram} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-pink-50 text-pink-700 hover:bg-pink-100 transition rounded-xl px-4 py-2 text-sm font-bold">
                      <Instagram size={16} /> إنستجرام
                    </a>
                  )}
                  {youtube && (
                    <a href={youtube} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-red-50 text-red-700 hover:bg-red-100 transition rounded-xl px-4 py-2 text-sm font-bold">
                      <Youtube size={16} /> يوتيوب
                    </a>
                  )}
                  {whatsapp && (
                    <a href={`https://wa.me/${whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition rounded-xl px-4 py-2 text-sm font-bold">
                      <MessageCircle size={16} /> واتساب
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Contact;
