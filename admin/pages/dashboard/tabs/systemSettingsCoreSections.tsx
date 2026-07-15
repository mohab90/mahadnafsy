import React, { useRef, useState } from 'react';
import { ImageUp, Loader2 } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { type Financial, type General } from './systemSettingsSchema';
import { Card, Field, TextInput } from './systemSettingsUi';

const WORKING_DAYS = [
  { key: 'Sunday', label: 'الأحد' }, { key: 'Monday', label: 'الاثنين' },
  { key: 'Tuesday', label: 'الثلاثاء' }, { key: 'Wednesday', label: 'الأربعاء' },
  { key: 'Thursday', label: 'الخميس' }, { key: 'Friday', label: 'الجمعة' },
  { key: 'Saturday', label: 'السبت' },
];

const MAX_BRAND_UPLOAD_BYTES = 1024 * 1024;

type BrandUploadResult = { ok: boolean; url: string; size: number; kind: 'logo' | 'favicon' };
type EditableSection = Record<string, string | number | string[] | undefined>;

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('File read failed'));
  reader.readAsDataURL(file);
});

const BrandImageUpload = ({
  kind,
  currentUrl,
  onUploaded,
}: {
  kind: 'logo' | 'favicon';
  currentUrl?: string;
  onUploaded: (url: string) => void;
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const handleFile = async (file?: File) => {
    if (!file) return;
    setMessage('');
    if (file.size > MAX_BRAND_UPLOAD_BYTES) {
      setMessage('الحد الأقصى 1MB');
      return;
    }

    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const result = await mysqlAdmin.adminPost<BrandUploadResult>('/admin/sys-config/general/logo', {
        kind,
        filename: file.name,
        mime: file.type,
        dataUrl,
      });
      onUploaded(result.url);
      setMessage('تم الرفع بنجاح');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'فشل الرفع');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="mt-2 flex items-center gap-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3">
      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white">
        {currentUrl ? (
          <img src={currentUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <ImageUp size={18} className="text-gray-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ImageUp size={14} />}
          رفع ملف
        </button>
        <p className="mt-1 text-xs text-gray-400">PNG/JPG/WEBP/ICO - حتى 1MB</p>
        {message && <p className="mt-1 truncate text-xs text-gray-500">{message}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon"
        className="hidden"
        onChange={event => handleFile(event.target.files?.[0])}
      />
    </div>
  );
};

export const GeneralSection: React.FC<{ data: General; mutateField: (f: string, v: string | number | string[]) => void }> = ({ data, mutateField }) => {
  const g = data || {} as General;

  return (
    <div className="space-y-4">
      <Card title="معلومات المؤسسة">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="الاسم (عربي)"><TextInput value={g.institute_name||''} onChange={v=>mutateField('institute_name',v)} placeholder="معهد الدراسات النفسية"/></Field>
          <Field label="الاسم (إنجليزي)"><TextInput value={g.institute_name_en||''} onChange={v=>mutateField('institute_name_en',v)} placeholder="Institute of Psychological Studies"/></Field>
          <Field label="الموقع الإلكتروني"><TextInput value={g.website_url||''} onChange={v=>mutateField('website_url',v)} type="url" placeholder="https://mahadnafsy.com"/></Field>
          <Field label="إيميل الدعم"><TextInput value={g.support_email||''} onChange={v=>mutateField('support_email',v)} type="email" placeholder="info@mahadnafsy.com"/></Field>
          <Field label="هاتف الدعم"><TextInput value={g.support_phone||''} onChange={v=>mutateField('support_phone',v)} type="tel" placeholder="+20 10 xxxx xxxx"/></Field>
          <Field label="واتساب الدعم"><TextInput value={g.support_whatsapp||''} onChange={v=>mutateField('support_whatsapp',v)} type="tel" placeholder="+20 10 xxxx xxxx"/></Field>
          <Field label="عنوان الدعم"><TextInput value={g.support_address||''} onChange={v=>mutateField('support_address',v)} placeholder="العنوان أو رابط الخريطة"/></Field>
        </div>
      </Card>

      <Card title="الهوية البصرية" hint="تُستخدم في طبقة البراند للإيميلات والفواتير والواجهة العامة">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="رابط اللوجو">
            <TextInput value={g.brand_logo_url||''} onChange={v=>mutateField('brand_logo_url',v)} type="url" placeholder="https://h.top4top.io/p_3734xfq501.png"/>
            <BrandImageUpload kind="logo" currentUrl={g.brand_logo_url||''} onUploaded={url=>mutateField('brand_logo_url',url)} />
          </Field>
          <Field label="رابط الأيقونة">
            <TextInput value={g.brand_favicon_url||''} onChange={v=>mutateField('brand_favicon_url',v)} type="url" placeholder="https://mahadnafsy.com/favicon.ico"/>
            <BrandImageUpload kind="favicon" currentUrl={g.brand_favicon_url||''} onUploaded={url=>mutateField('brand_favicon_url',url)} />
          </Field>
          {[
            ['brand_primary_color', 'اللون الأساسي', '#4f46e5'],
            ['brand_secondary_color', 'اللون الثانوي', '#0f766e'],
            ['brand_accent_color', 'لون التمييز', '#f59e0b'],
          ].map(([field, label, fallback]) => {
            const value = String((g as EditableSection)[field] || fallback);
            return (
              <Field key={field} label={label}>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback}
                    onChange={e=>mutateField(field,e.target.value)}
                    className="h-10 w-12 rounded-lg border border-gray-200 bg-white p-1"
                  />
                  <TextInput value={value} onChange={v=>mutateField(field,v)} placeholder={fallback}/>
                </div>
              </Field>
            );
          })}
        </div>
      </Card>

      <Card title="الإعدادات الإقليمية">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="العملة الافتراضية">
            <select value={g.default_currency||'EGP'} onChange={e=>mutateField('default_currency',e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              {['EGP','SAR','USD','EUR','AED','KWD'].map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="المنطقة الزمنية">
            <select value={g.default_timezone||'Africa/Cairo'} onChange={e=>mutateField('default_timezone',e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              {['Africa/Cairo','Asia/Riyadh','Asia/Dubai','Asia/Kuwait','Europe/London','America/New_York'].map(tz=><option key={tz} value={tz}>{tz}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="أيام العمل">
        <div className="flex flex-wrap gap-2 mt-1">
          {WORKING_DAYS.map(day => {
            const wd: string[] = g.working_days || [];
            const checked = wd.includes(day.key);
            return (
              <button key={day.key}
                onClick={() => mutateField('working_days', checked ? wd.filter(d=>d!==day.key) : [...wd, day.key])}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition ${checked ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}>
                {day.label}
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

export const FinancialSection: React.FC<{ data: Financial; mutateField: (f: string, v: string | number | string[]) => void }> = ({ data, mutateField }) => {
  const f = data || {} as Financial;
  const fields = [
    { key: 'consultation_price',       label: 'سعر جلسة الاستشارة',          suffix: 'ج.م',   type: 'number' },
    { key: 'installment_down_pct',     label: 'نسبة الدفعة الأولى للتقسيط',  suffix: '%',     type: 'number' },
    { key: 'max_installment_months',   label: 'أقصى مدة تقسيط',              suffix: 'شهر',   type: 'number' },
    { key: 'default_lead_sla_hours',   label: 'مهلة التواصل مع الليد',       suffix: 'ساعة',  type: 'number' },
    { key: 'lead_auto_archive_days',   label: 'أرشفة الليدات الخاملة بعد',   suffix: 'يوم',   type: 'number' },
    { key: 'vat_percent',              label: 'نسبة ضريبة القيمة المضافة',    suffix: '%',     type: 'number' },
    { key: 'invoice_prefix',           label: 'بادئة رقم الفاتورة',           suffix: '',      type: 'text'   },
    { key: 'session_duration_default', label: 'مدة الجلسة الافتراضية',        suffix: 'دقيقة', type: 'number' },
  ];

  return (
    <Card title="الإعدادات المالية والتشغيلية">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {fields.map(fld => (
          <Field key={fld.key} label={fld.label}>
            <TextInput value={(f as EditableSection)[fld.key]??''} onChange={v=>mutateField(fld.key, fld.type==='number' ? Number(v) : v)} type={fld.type} suffix={fld.suffix}/>
          </Field>
        ))}
      </div>
    </Card>
  );
};
