import React, { useState } from 'react';
import { useSiteData } from '../../../context/SiteDataContext';

const ContactsTab: React.FC = () => {
  const { contactMessages, updateContactMessage, deleteContactMessage } = useSiteData();

  const [cSearch, setCSearch] = useState('');
  const [cStatusFilter, setCStatusFilter] = useState<'all' | 'new' | 'read' | 'replied'>('all');

  const filtered = contactMessages.filter(m =>
    (cStatusFilter === 'all' || m.status === cStatusFilter) &&
    (m.name.includes(cSearch) || (m.phone || '').includes(cSearch) || (m.email || '').includes(cSearch) || m.message.includes(cSearch))
  );
  const counts = {
    new: contactMessages.filter(m => m.status === 'new').length,
    read: contactMessages.filter(m => m.status === 'read').length,
    replied: contactMessages.filter(m => m.status === 'replied').length,
  };
  const statusLabels: Record<string, string> = { new: 'جديد', read: 'تمت القراءة', replied: 'تم الرد' };
  const statusColors: Record<string, string> = { new: 'bg-blue-100 text-blue-700', read: 'bg-amber-100 text-amber-700', replied: 'bg-emerald-100 text-emerald-700' };

  // Normalise an Egyptian phone for a wa.me link (digits only, 0xxxx → 20xxxx).
  const waNum = (p?: string) => {
    let d = (p || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0')) d = '2' + d;
    return d;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-gray-900">رسائل التواصل</h2>
        <div className="flex flex-wrap gap-2">
          {(['all', 'new', 'read', 'replied'] as const).map(s => (
            <button key={s} onClick={() => setCStatusFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${cStatusFilter === s ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {s === 'all' ? `الكل (${contactMessages.length})` : `${statusLabels[s]} (${counts[s as keyof typeof counts]})`}
            </button>
          ))}
        </div>
      </div>
      <input value={cSearch} onChange={e => setCSearch(e.target.value)} placeholder="بحث بالاسم أو الهاتف أو الرسالة..."
        className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">لا توجد رسائل تواصل بعد.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(msg => (
            <div key={msg.id} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-gray-900 text-base">{msg.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{msg.createdAt}</p>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${statusColors[msg.status]}`}>{statusLabels[msg.status]}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div><span className="text-gray-400 text-xs">الهاتف:</span> <a href={`tel:${msg.phone}`} className="font-medium text-blue-600 hover:underline">{msg.phone}</a></div>
                {msg.email && <div><span className="text-gray-400 text-xs">البريد:</span> <a href={`mailto:${msg.email}`} className="font-medium text-blue-600 hover:underline break-all text-xs">{msg.email}</a></div>}
                {msg.subject && <div className="col-span-2"><span className="text-gray-400 text-xs">الموضوع:</span> <span className="font-medium text-gray-700">{msg.subject}</span></div>}
              </div>
              <p className="text-sm text-gray-600 bg-gray-50 rounded-xl px-3 py-2 leading-relaxed"><span className="font-bold text-gray-700 block mb-0.5">الرسالة:</span>{msg.message}</p>
              {/* Quick reply — turns the log into an actionable inbox; marks replied */}
              <div className="flex gap-2">
                <a href={`https://wa.me/${waNum(msg.phone)}?text=${encodeURIComponent(`مرحباً ${msg.name}، بخصوص رسالتك لمعهد الدراسات النفسية:`)}`}
                  target="_blank" rel="noopener noreferrer"
                  onClick={() => { if (msg.status !== 'replied') updateContactMessage({ ...msg, status: 'replied' }); }}
                  className="flex-1 text-center py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition">💬 رد واتساب</a>
                {msg.email && (
                  <a href={`mailto:${msg.email}?subject=${encodeURIComponent('رد على رسالتك — معهد الدراسات النفسية')}`}
                    onClick={() => { if (msg.status !== 'replied') updateContactMessage({ ...msg, status: 'replied' }); }}
                    className="flex-1 text-center py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition">✉️ رد إيميل</a>
                )}
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">الحالة</label>
                <select value={msg.status} onChange={e => updateContactMessage({ ...msg, status: e.target.value as typeof msg.status })}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400">
                  <option value="new">جديد</option>
                  <option value="read">تمت القراءة</option>
                  <option value="replied">تم الرد</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">ملاحظة الإدارة</label>
                <textarea rows={2} value={msg.adminNote || ''} onChange={e => updateContactMessage({ ...msg, adminNote: e.target.value })}
                  placeholder="أضف ملاحظة داخلية..."
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none" />
              </div>
              <button onClick={() => { if (window.confirm('حذف هذه الرسالة؟')) deleteContactMessage(msg.id); }}
                className="w-full py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl text-sm font-bold transition">حذف الرسالة</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ContactsTab;
