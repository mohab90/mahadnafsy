import type { FacebookLeadAdsConfig, LeadItem, LeadStatus, StaffMember } from '../../types';

type Notify = (type: 'success' | 'error' | 'info', msg: string) => void;

// ── handleCsvFileChange ──────────────────────────────────────────────────────

interface HandleCsvFileChangeDeps {
  notify: Notify;
  setCsvHeaders: (h: string[]) => void;
  setCsvRows: (r: Record<string, string>[]) => void;
  setCsvMapping: (m: Record<string, string>) => void;
  setCsvImportOpen: (open: boolean) => void;
}

export function handleCsvFileChangeFn(
  e: React.ChangeEvent<HTMLInputElement>,
  deps: HandleCsvFileChangeDeps,
): void {
  const { notify, setCsvHeaders, setCsvRows, setCsvMapping, setCsvImportOpen } = deps;
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = (ev.target?.result as string) || '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) { notify('error', 'الملف فارغ أو لا يحتوي صفوف بيانات.'); return; }
    const parseLine = (line: string): string[] => {
      const res: string[] = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') { inQ = !inQ; continue; }
        if (line[i] === ',' && !inQ) { res.push(cur.trim()); cur = ''; continue; }
        cur += line[i];
      }
      res.push(cur.trim());
      return res;
    };
    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(l => {
      const vals = parseLine(l);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
      return obj;
    }).filter(r => Object.values(r).some(v => v));
    setCsvHeaders(headers);
    setCsvRows(rows);
    const autoMap: Record<string, string> = {};
    headers.forEach(h => {
      const hl = h.toLowerCase();
      if (hl.includes('name') || hl.includes('اسم')) autoMap[h] = 'name';
      else if (hl.includes('phone') || hl.includes('تليفون') || hl.includes('هاتف') || hl.includes('موبايل')) autoMap[h] = 'phone';
      else if (hl.includes('email') || hl.includes('بريد') || hl.includes('ايميل')) autoMap[h] = 'email';
      else if (hl.includes('source') || hl.includes('مصدر')) autoMap[h] = 'source';
      else if (hl.includes('note') || hl.includes('ملاحظ')) autoMap[h] = 'notes';
      else if (hl.includes('branch') || hl.includes('فرع')) autoMap[h] = 'branch';
      else if (hl.includes('status') || hl.includes('حالة')) autoMap[h] = 'status';
      else if (hl.includes('tag') || hl.includes('وسم')) autoMap[h] = 'tags';
      else autoMap[h] = 'skip';
    });
    setCsvMapping(autoMap);
    setCsvImportOpen(true);
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

// ── handleCsvImport ──────────────────────────────────────────────────────────

interface HandleCsvImportDeps {
  csvRows: Record<string, string>[];
  csvMapping: Record<string, string>;
  leads: LeadItem[];
  addLead: (lead: LeadItem) => void;
  notify: Notify;
  setCsvImporting: (b: boolean) => void;
  setCsvImportOpen: (b: boolean) => void;
  setCsvRows: (r: Record<string, string>[]) => void;
  setCsvHeaders: (h: string[]) => void;
  setCsvMapping: (m: Record<string, string>) => void;
  dateLocale?: string;
  tagSeparator?: RegExp;
}

export function handleCsvImportFn(deps: HandleCsvImportDeps): void {
  const { csvRows, csvMapping, leads, addLead, notify, setCsvImporting, setCsvImportOpen, setCsvRows, setCsvHeaders, setCsvMapping, dateLocale = 'ar-EG-u-nu-latn', tagSeparator = /[,،|]/ } = deps;
  if (!csvRows.length) return;
  setCsvImporting(true);
  let added = 0;
  const now = new Date().toLocaleString(dateLocale, { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  for (const row of csvRows) {
    const get = (field: string) => {
      const col = Object.entries(csvMapping).find(([, v]) => v === field)?.[0];
      return col ? (row[col] || '') : '';
    };
    const name = get('name') || '';
    const phone = get('phone') || '';
    const email = get('email') || '';
    if (!name && !phone && !email) continue;
    const isDup = leads.some(l =>
      (phone && (l.phone || '').replace(/\D/g,'') === phone.replace(/\D/g,'')) ||
      (email && email.length > 3 && (l.email || '').toLowerCase() === email.toLowerCase())
    );
    if (isDup) continue;
    const rawTags = get('tags');
    const tags = rawTags ? rawTags.split(tagSeparator).map(t => t.trim()).filter(Boolean) : [];
    addLead({
      id: `csv-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      name: name || 'عميل مستورد',
      email, phone,
      source: get('source') || 'استيراد CSV',
      status: (['new','contacted','interested','not_interested','no_answer','closed','converted','lost'].includes(get('status')) ? get('status') : 'new') as LeadStatus,
      leadType: 'course',
      enrolledCourseId: '',
      branch: 'other',
      interestLevel: 'medium',
      assignedSalesId: '',
      assignedSalesName: '',
      communications: [],
      notes: get('notes') || '',
      tags: tags.length ? tags : undefined,
      createdAt: now,
    } as LeadItem);
    added++;
  }
  setCsvImporting(false);
  setCsvImportOpen(false);
  setCsvRows([]);
  setCsvHeaders([]);
  setCsvMapping({});
  notify('success', `تم استيراد ${added} عميل بنجاح.`);
}

// ── handleFetchFbForms ───────────────────────────────────────────────────────

interface HandleFetchFbFormsDeps {
  fbDraft: FacebookLeadAdsConfig;
  setFbSyncNotice: (n: string) => void;
  setFbFormsLoading: (b: boolean) => void;
  setFbAvailableForms: (forms: {id:string;name:string;status:string}[]) => void;
}

export async function handleFetchFbFormsFn(deps: HandleFetchFbFormsDeps): Promise<void> {
  const { fbDraft, setFbSyncNotice, setFbFormsLoading, setFbAvailableForms } = deps;
  const token = fbDraft.pageAccessToken.trim();
  const pageId = fbDraft.pageId.trim();
  if (!token || !pageId) { setFbSyncNotice('أدخل Page ID و Access Token أولاً.'); return; }
  setFbFormsLoading(true);
  setFbSyncNotice('');
  try {
    const url = `https://graph.facebook.com/v19.0/${pageId}/leadgen_forms?access_token=${encodeURIComponent(token)}&fields=id,name,status&limit=50`;
    const res = await fetch(url);
    const data = await res.json() as { data?: {id:string;name:string;status:string}[]; error?: {message:string} };
    if (data.error) { setFbSyncNotice(`خطأ: ${data.error.message}`); return; }
    setFbAvailableForms(data.data || []);
    if ((data.data || []).length === 0) setFbSyncNotice('لا توجد نماذج. تأكد من صحة الـ Page ID والـ Access Token.');
  } catch {
    setFbSyncNotice('فشل الاتصال بـ Facebook Graph API. تأكد من الإعدادات والاتصال بالإنترنت.');
  } finally {
    setFbFormsLoading(false);
  }
}

// ── handleFbApiSync ──────────────────────────────────────────────────────────

interface HandleFbApiSyncDeps {
  fbDraft: FacebookLeadAdsConfig;
  leads: LeadItem[];
  addLead: (lead: LeadItem) => void;
  staffMembers: StaffMember[];
  fbLeadAdsConfig: FacebookLeadAdsConfig | null;
  setFbLeadAdsConfig: (cfg: FacebookLeadAdsConfig) => Promise<boolean>;
  setFbDraft: (cfg: FacebookLeadAdsConfig) => void;
  setFbSyncLoading: (b: boolean) => void;
  setFbSyncNotice: (n: string) => void;
  dateLocale?: string;
}

export async function handleFbApiSyncFn(deps: HandleFbApiSyncDeps): Promise<void> {
  const { fbDraft, leads, addLead, staffMembers, fbLeadAdsConfig, setFbLeadAdsConfig, setFbDraft, setFbSyncLoading, setFbSyncNotice, dateLocale = 'ar-EG-u-nu-latn' } = deps;
  const token = fbDraft.pageAccessToken.trim();
  if (!token) { setFbSyncNotice('أدخل Access Token أولاً.'); return; }
  const enabledForms = fbDraft.adForms.filter(f => f.enabled);
  if (enabledForms.length === 0) { setFbSyncNotice('اختر نموذجاً واحداً على الأقل.'); return; }
  setFbSyncLoading(true);
  setFbSyncNotice('');
  let totalAdded = 0;
  let totalSkipped = 0;
  try {
    for (const form of enabledForms) {
      let nextUrl: string | null =
        `https://graph.facebook.com/v19.0/${form.formId}/leads?fields=id,created_time,field_data&access_token=${encodeURIComponent(token)}&limit=100`;
      while (nextUrl) {
        const res = await fetch(nextUrl);
        const data = await res.json() as {
          data?: { id: string; created_time: string; field_data: { name: string; values: string[] }[] }[];
          paging?: { next?: string };
          error?: { message: string };
        };
        if (data.error) { setFbSyncNotice(`خطأ API: ${data.error.message}`); nextUrl = null; break; }
        for (const entry of (data.data || [])) {
          const fields = Object.fromEntries((entry.field_data || []).map(f => [f.name.toLowerCase(), f.values?.[0] || '']));
          const name = fields['full_name'] || fields['name'] || fields['first_name'] + ' ' + (fields['last_name'] || '') || 'عميل فيسبوك';
          const phone = fields['phone_number'] || fields['phone'] || '';
          const email = fields['email'] || '';
          const isDup = leads.some(l =>
            l.fbLeadId === entry.id ||
            (phone && l.phone === phone) ||
            (email && email.length > 3 && l.email.toLowerCase() === email.toLowerCase())
          );
          if (isDup) { totalSkipped++; continue; }
          addLead({
            id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: name.trim() || 'عميل فيسبوك',
            email: email || '',
            phone: phone || '',
            source: `Facebook Lead Ads — ${form.formName}`,
            status: fbDraft.defaultStatus,
            leadType: fbDraft.defaultLeadType,
            enrolledCourseId: '',
            interestedCourseIds: (form.courseId || fbDraft.defaultInterestedCourseId) ? [(form.courseId || fbDraft.defaultInterestedCourseId)!] : [],
            branch: ((form.branch || fbDraft.defaultBranch) || undefined) as LeadItem['branch'],
            interestLevel: 'medium',
            assignedSalesId: fbDraft.defaultAssignedSalesId || '',
            assignedSalesName: staffMembers.find(s => s.id === fbDraft.defaultAssignedSalesId)?.name || '',
            communications: [],
            notes: `مصدر: Facebook Lead Form "${form.formName}"${fields['city'] ? `\nالمدينة: ${fields['city']}` : ''}${fields['job_title'] ? `\nالمهنة: ${fields['job_title']}` : ''}`,
            fbLeadId: entry.id,
            fbFormId: form.formId,
            fbFormName: form.formName,
            createdAt: new Date(entry.created_time).toLocaleString(dateLocale, { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
          } as LeadItem);
          totalAdded++;
        }
        nextUrl = data.paging?.next || null;
      }
    }
    const newConfig: FacebookLeadAdsConfig = {
      ...fbDraft,
      lastSyncAt: new Date().toISOString(),
      totalImported: (fbLeadAdsConfig?.totalImported || 0) + totalAdded,
      updatedAt: new Date().toISOString(),
    };
    if (!await setFbLeadAdsConfig(newConfig)) {
      throw new Error('Failed to persist Facebook Lead Ads sync state');
    }
    setFbDraft(newConfig);
    setFbSyncNotice(`✅ تم: إضافة ${totalAdded} عميل جديد (تخطي ${totalSkipped} مكرر).`);
  } catch {
    setFbSyncNotice('فشل الاتصال. تحقق من الإنترنت والإعدادات.');
  } finally {
    setFbSyncLoading(false);
  }
}
