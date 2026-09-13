import type { FacebookLeadAdsConfig, LeadItem, LeadStatus, BranchType } from '../../../../types';
import { parseCsvRows } from '../../../../../shared/csv';

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
  autoMap: Record<string, string>;
};

/** One line, for the callers that already have the file split into lines. */
export const parseCsvLine = (line: string): string[] => parseCsvRows(line)[0] ?? [];

export const detectCsvMapping = (headers: string[]): Record<string, string> => {
  const autoMap: Record<string, string> = {};
  headers.forEach((header) => {
    const normalized = header.toLowerCase();
    if (normalized.includes('name') || normalized.includes('اسم')) autoMap[header] = 'name';
    else if (normalized.includes('phone') || normalized.includes('تليفون') || normalized.includes('هاتف') || normalized.includes('موبايل')) autoMap[header] = 'phone';
    else if (normalized.includes('email') || normalized.includes('بريد') || normalized.includes('ايميل')) autoMap[header] = 'email';
    else if (normalized.includes('source') || normalized.includes('مصدر')) autoMap[header] = 'source';
    else if (normalized.includes('note') || normalized.includes('ملاحظ')) autoMap[header] = 'notes';
    else if (normalized.includes('branch') || normalized.includes('فرع')) autoMap[header] = 'branch';
    else if (normalized.includes('status') || normalized.includes('حالة')) autoMap[header] = 'status';
    else if (normalized.includes('tag') || normalized.includes('وسم')) autoMap[header] = 'tags';
    else autoMap[header] = 'skip';
  });
  return autoMap;
};

export const parseCsvText = (text: string): ParsedCsv | null => {
  const [headers, ...body] = parseCsvRows(text);
  if (!headers || body.length === 0) return null;

  const rows = body.map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = values[index] || ''; });
    return row;
  });

  return { headers, rows, autoMap: detectCsvMapping(headers) };
};

const csvField = (row: Record<string, string>, mapping: Record<string, string>, field: string) => {
  const column = Object.entries(mapping).find(([, value]) => value === field)?.[0];
  return column ? (row[column] || '') : '';
};

const normalizeCsvPhone = (value?: string | null) => (value || '').replace(/\D/g, '');

export const leadFromCsvRow = (
  row: Record<string, string>,
  mapping: Record<string, string>,
  existingLeads: LeadItem[],
  createdAt: string,
): LeadItem | null => {
  const name = csvField(row, mapping, 'name') || '';
  const phone = csvField(row, mapping, 'phone') || '';
  const email = csvField(row, mapping, 'email') || '';
  if (!name && !phone && !email) return null;

  const normalizedPhone = normalizeCsvPhone(phone);
  const isDuplicate = existingLeads.some((lead) =>
    (normalizedPhone && normalizeCsvPhone(lead.phone) === normalizedPhone) ||
    (email && email.length > 3 && (lead.email || '').toLowerCase() === email.toLowerCase())
  );
  if (isDuplicate) return null;

  const rawTags = csvField(row, mapping, 'tags');
  const tags = rawTags ? rawTags.split(/[,،|]/).map((tag) => tag.trim()).filter(Boolean) : [];
  const rawStatus = csvField(row, mapping, 'status');
  const status = (['new', 'contacted', 'interested', 'not_interested', 'no_answer', 'closed', 'converted', 'lost'].includes(rawStatus) ? rawStatus : 'new') as LeadStatus;

  return {
    id: `csv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || 'عميل مستورد',
    email,
    phone,
    source: csvField(row, mapping, 'source') || 'استيراد CSV',
    status,
    leadType: 'course',
    enrolledCourseId: '',
    branch: 'other',
    interestLevel: 'medium',
    assignedSalesId: '',
    assignedSalesName: '',
    communications: [],
    notes: csvField(row, mapping, 'notes') || '',
    tags: tags.length ? tags : undefined,
    createdAt,
  };
};

export const parseFacebookCsvLeads = (
  text: string,
  existingLeads: LeadItem[],
  createdAt: string,
): LeadItem[] | null => {
  const [headerRow, ...body] = parseCsvRows(text);
  if (!headerRow || body.length === 0) return null;

  const headers = headerRow.map(h => h.trim().toLowerCase());
  const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('full_name'));
  const phoneIdx = headers.findIndex(h => h.includes('phone'));
  const emailIdx = headers.findIndex(h => h.includes('email'));
  const importedLeads: LeadItem[] = [];

  for (let i = 0; i < body.length; i++) {
    const cols = body[i];
    const name = nameIdx >= 0 ? cols[nameIdx] : '';
    const phone = phoneIdx >= 0 ? cols[phoneIdx] : '';
    const email = emailIdx >= 0 ? cols[emailIdx] : '';
    if (!name && !phone && !email) continue;

    const isDuplicate = existingLeads.some(l =>
      (phone && l.phone === phone) ||
      (email && email.length > 3 && l.email.toLowerCase() === email.toLowerCase())
    );
    if (isDuplicate) continue;

    importedLeads.push({
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
      createdAt,
    });
  }

  return importedLeads;
};

export type FacebookGraphLeadEntry = {
  id: string;
  created_time: string;
  field_data: { name: string; values: string[] }[];
};

export const leadFromFacebookGraphEntry = (
  entry: FacebookGraphLeadEntry,
  form: FacebookLeadAdsConfig['adForms'][number],
  config: FacebookLeadAdsConfig,
  existingLeads: LeadItem[],
  assignedSalesName: string,
): LeadItem | null => {
  const fields = Object.fromEntries((entry.field_data || []).map(f => [f.name.toLowerCase(), f.values?.[0] || '']));
  const name = fields['full_name'] || fields['name'] || fields['first_name'] + ' ' + (fields['last_name'] || '') || 'عميل فيسبوك';
  const phone = fields['phone_number'] || fields['phone'] || '';
  const email = fields['email'] || '';

  const isDuplicate = existingLeads.some(l =>
    l.fbLeadId === entry.id ||
    (phone && l.phone === phone) ||
    (email && email.length > 3 && l.email.toLowerCase() === email.toLowerCase())
  );
  if (isDuplicate) return null;

  return {
    id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || 'عميل فيسبوك',
    email: email || '',
    phone: phone || '',
    source: `Facebook Lead Ads — ${form.formName}`,
    status: config.defaultStatus,
    leadType: config.defaultLeadType,
    enrolledCourseId: '',
    interestedCourseIds: (form.courseId || config.defaultInterestedCourseId) ? [(form.courseId || config.defaultInterestedCourseId)!] : [],
    branch: ((form.branch || config.defaultBranch) || undefined) as BranchType | undefined,
    interestLevel: 'medium',
    assignedSalesId: config.defaultAssignedSalesId || '',
    assignedSalesName,
    communications: [],
    notes: `مصدر: Facebook Lead Form "${form.formName}"${fields['city'] ? `\nالمدينة: ${fields['city']}` : ''}${fields['job_title'] ? `\nالمهنة: ${fields['job_title']}` : ''}`,
    fbLeadId: entry.id,
    fbFormId: form.formId,
    fbFormName: form.formName,
    createdAt: new Date(entry.created_time).toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
  };
};
