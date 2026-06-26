import React, { useState } from 'react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { FacebookLeadAdsConfig, LeadItem, LeadStatus, BranchType } from '../../../types';
import type { NotifyFn } from './CrmSettingsModal';

/**
 * Lead import feature (CSV file + Facebook Lead Ads). Owns its own state + handlers,
 * extracted verbatim from LeadsTab to slim the god-component. Returns everything with
 * the SAME names so the render JSX is unchanged. Pulls leads/addLead/staff/fb-config
 * from context directly (same context the component consumes).
 */
export function useLeadsImport(notify: NotifyFn) {
  const { leads, addLead, staffMembers, fbLeadAdsConfig, setFbLeadAdsConfig } = useSiteData();

  const [bulkUploadNotice, setBulkUploadNotice] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [fbDraft, setFbDraft] = useState<FacebookLeadAdsConfig>(() => fbLeadAdsConfig ?? ({
    enabled: false, pageId: '', pageAccessToken: '', appId: '', webhookVerifyToken: '',
    adForms: [], defaultLeadType: 'course' as LeadItem['leadType'],
    defaultStatus: 'new' as LeadStatus,
    defaultInterestedCourseId: '', defaultAssignedSalesId: '',
    autoSyncEnabled: false, totalImported: 0, updatedAt: '',
  }));
  const [fbIntegOpen, setFbIntegOpen] = useState(false);
  const [fbSyncLoading, setFbSyncLoading] = useState(false);
  const [fbSyncNotice, setFbSyncNotice] = useState('');
  const [fbFormsLoading, setFbFormsLoading] = useState(false);
  const [fbAvailableForms, setFbAvailableForms] = useState<{ id: string; name: string; status: string }[]>([]);

  const handleBulkFbUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').filter(Boolean);
      if (lines.length < 2) { setBulkUploadNotice('الملف فارغ أو غير صحيح.'); return; }
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
      const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('full_name'));
      const phoneIdx = headers.findIndex(h => h.includes('phone'));
      const emailIdx = headers.findIndex(h => h.includes('email'));
      let added = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
        const name = nameIdx >= 0 ? cols[nameIdx] : '';
        const phone = phoneIdx >= 0 ? cols[phoneIdx] : '';
        const email = emailIdx >= 0 ? cols[emailIdx] : '';
        if (!name && !phone && !email) continue;
        // Dedup: skip if phone or email already exists in leads
        const isDup = leads.some(l =>
          (phone && l.phone === phone) ||
          (email && email.length > 3 && l.email.toLowerCase() === email.toLowerCase())
        );
        if (isDup) continue;
        addLead({
          id: `fb-${Date.now()}-${i}`,
          name: name || 'عميل فيسبوك',
          email: email || '',
          phone: phone || '',
          source: 'عميل فيسبوك',
          status: 'new',
          leadType: 'course',
          enrolledCourseId: '',
          branch: 'other',
          interestLevel: 'medium',
          assignedSalesId: '',
          assignedSalesName: '',
          communications: [],
          notes: '',
          createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        });
        added++;
      }
      setBulkUploadNotice(`تم إضافة ${added} عميل من فيسبوك.`);
      setTimeout(() => setBulkUploadNotice(''), 4000);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  // ── General CSV Import ────────────────────────────────────────────────────
  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) || '';
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { notify('error', 'الملف فارغ أو لا يحتوي صفوف بيانات.'); return; }
      // Parse CSV (simple — handles quoted values)
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
      // Auto-detect column mapping
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
  };
  const handleCsvImport = () => {
    if (!csvRows.length) return;
    setCsvImporting(true);
    let added = 0;
    const now = new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    for (const row of csvRows) {
      const get = (field: string) => {
        const col = Object.entries(csvMapping).find(([, v]) => v === field)?.[0];
        return col ? (row[col] || '') : '';
      };
      const name = get('name') || '';
      const phone = get('phone') || '';
      const email = get('email') || '';
      if (!name && !phone && !email) continue;
      // Dedup
      const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '');
      const normalizedPhone = normalizePhone(phone);
      const isDup = leads.some(l =>
        (normalizedPhone && normalizePhone(l.phone) === normalizedPhone) ||
        (email && email.length > 3 && (l.email || '').toLowerCase() === email.toLowerCase())
      );
      if (isDup) continue;
      const rawTags = get('tags');
      const tags = rawTags ? rawTags.split(/[,،|]/).map(t => t.trim()).filter(Boolean) : [];
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
      });
      added++;
    }
    setCsvImporting(false);
    setCsvImportOpen(false);
    setCsvRows([]);
    setCsvHeaders([]);
    setCsvMapping({});
    notify('success', `تم استيراد ${added} عميل بنجاح.`);
  };

  // ── Facebook Lead Ads: Fetch available forms from Graph API ───────────────
  const handleFetchFbForms = async () => {
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
  };

  // ── Facebook Lead Ads: Sync leads from Graph API ──────────────────────────
  const handleFbApiSync = async () => {
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
            // Dedup by fbLeadId or phone or email
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
              branch: ((form.branch || fbDraft.defaultBranch) || undefined) as BranchType | undefined,
              interestLevel: 'medium',
              assignedSalesId: fbDraft.defaultAssignedSalesId || '',
              assignedSalesName: staffMembers.find(s => s.id === fbDraft.defaultAssignedSalesId)?.name || '',
              communications: [],
              notes: `مصدر: Facebook Lead Form "${form.formName}"${fields['city'] ? `\nالمدينة: ${fields['city']}` : ''}${fields['job_title'] ? `\nالمهنة: ${fields['job_title']}` : ''}`,
              fbLeadId: entry.id,
              fbFormId: form.formId,
              fbFormName: form.formName,
              createdAt: new Date(entry.created_time).toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
            });
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
      setFbLeadAdsConfig(newConfig);
      setFbDraft(newConfig);
      setFbSyncNotice(`✅ تم: إضافة ${totalAdded} عميل جديد (تخطي ${totalSkipped} مكرر).`);
    } catch {
      setFbSyncNotice('فشل الاتصال. تحقق من الإنترنت والإعدادات.');
    } finally {
      setFbSyncLoading(false);
    }
  };

  const handleSaveFbConfig = () => {
    setFbLeadAdsConfig({ ...fbDraft, updatedAt: new Date().toISOString() });
    setFbSyncNotice('✅ تم حفظ الإعدادات.');
    setTimeout(() => setFbSyncNotice(''), 3000);
  };

  return {
    bulkUploadNotice, setBulkUploadNotice,
    csvHeaders, setCsvHeaders, csvRows, setCsvRows, csvMapping, setCsvMapping,
    csvImportOpen, setCsvImportOpen, csvImporting, setCsvImporting,
    fbDraft, setFbDraft, fbIntegOpen, setFbIntegOpen,
    fbSyncLoading, setFbSyncLoading, fbSyncNotice, setFbSyncNotice,
    fbFormsLoading, setFbFormsLoading, fbAvailableForms, setFbAvailableForms,
    handleBulkFbUpload, handleCsvFileChange, handleCsvImport,
    handleFetchFbForms, handleFbApiSync, handleSaveFbConfig,
  };
}
