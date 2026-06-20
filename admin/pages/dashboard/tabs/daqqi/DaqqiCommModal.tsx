import React, { useState } from 'react';
import { MessageCircle, Phone, X } from 'lucide-react';
import type { CommunicationRecord } from '../../../../types';

interface CommModalData {
  subscriberId: string;
  subscriberName: string;
  phone: string;
}

interface Props {
  modal: CommModalData;
  onClose: () => void;
  onSave: (type: CommunicationRecord['type'], note: string) => void;
}

export function DaqqiCommModal({ modal, onClose, onSave }: Props) {
  const [commType, setCommType] = useState<CommunicationRecord['type']>('call');
  const [commNote, setCommNote] = useState('');

  const handleSave = () => {
    if (!commNote.trim()) return;
    onSave(commType, commNote.trim());
    setCommType('call');
    setCommNote('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="font-extrabold text-gray-900 text-lg flex items-center gap-2">
              <Phone size={18} className="text-purple-600" /> تسجيل تواصل
            </h4>
            <p className="text-xs text-gray-500 mt-0.5">{modal.subscriberName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-2">نوع التواصل</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['call', 'whatsapp', 'email', 'meeting', 'note', 'payment_followup'] as CommunicationRecord['type'][]).map(t => {
                const typeLabels: Record<string, string> = { call: '📞 مكالمة', whatsapp: '💬 واتساب', email: '📧 إيميل', meeting: '🤝 اجتماع', note: '📝 ملاحظة', payment_followup: '💰 متابعة دفع' };
                return (
                  <button key={t} onClick={() => setCommType(t)}
                    className={`py-2 rounded-xl text-xs font-bold border-2 transition ${commType === t ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    {typeLabels[t]}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5">ملاحظات <span className="text-red-500">*</span></label>
            <textarea value={commNote} onChange={e => setCommNote(e.target.value)}
              placeholder="تفاصيل التواصل..." rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-purple-400" />
          </div>
          <div className="flex items-center gap-2">
            <a href={`tel:${modal.phone}`} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition">
              <Phone size={12} /> {modal.phone}
            </a>
            <button
              onClick={() => { const wNum = modal.phone.replace(/\D/g, ''); const waNum = wNum.startsWith('0') ? '2' + wNum : wNum; window.open(`https://wa.me/${waNum}`, '_blank'); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-teal-200 bg-teal-50 text-xs text-teal-700 hover:bg-teal-100 transition">
              <MessageCircle size={12} /> واتساب
            </button>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={handleSave} disabled={!commNote.trim()}
            className="flex-1 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 disabled:opacity-40 transition">
            تسجيل التواصل
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
