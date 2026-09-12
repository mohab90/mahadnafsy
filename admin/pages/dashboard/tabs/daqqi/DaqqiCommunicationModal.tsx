import { useEffect, useState } from 'react';
import { MessageCircle, Phone } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import type { CommunicationRecord } from '../../../../types';
import { toDialable } from '../../../../lib/whatsappLink';

export interface DaqqiCommunicationTarget {
  subscriberId: string;
  subscriberName: string;
  phone: string;
}

interface Props {
  target: DaqqiCommunicationTarget | null;
  onClose: () => void;
  onSubmit: (type: CommunicationRecord['type'], note: string) => void;
}

const communicationTypes: Array<{ value: CommunicationRecord['type']; label: string }> = [
  { value: 'call', label: '📞 مكالمة' },
  { value: 'whatsapp', label: '💬 واتساب' },
  { value: 'email', label: '📧 إيميل' },
  { value: 'meeting', label: '🤝 اجتماع' },
  { value: 'note', label: '📝 ملاحظة' },
  { value: 'payment_followup', label: '💰 متابعة دفع' },
];

export function DaqqiCommunicationModal({ target, onClose, onSubmit }: Props) {
  const [type, setType] = useState<CommunicationRecord['type']>('call');
  const [note, setNote] = useState('');

  // Reset when the modal points at a different client. Without this the next
  // client opened with the previous one's half-typed note still in the box.
  useEffect(() => { setType('call'); setNote(''); }, [target?.subscriberId]);

  if (!target) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title="تسجيل تواصل"
      subtitle={target.subscriberName}
      icon={<Phone size={18} className="text-purple-600" />}
      size="sm"
      footer={(
        <>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
          <button onClick={() => onSubmit(type, note)} disabled={!note.trim()}
            className="px-5 py-2 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 disabled:opacity-40 transition">
            تسجيل التواصل
          </button>
        </>
      )}
    >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-2">نوع التواصل</label>
            <div className="grid grid-cols-3 gap-1.5">
              {communicationTypes.map((communicationType) => (
                <button key={communicationType.value} onClick={() => setType(communicationType.value)}
                  className={`py-2 rounded-xl text-xs font-bold border-2 transition ${type === communicationType.value ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  {communicationType.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5">ملاحظات <span className="text-red-500">*</span></label>
            <textarea value={note} onChange={(event) => setNote(event.target.value)}
              placeholder="تفاصيل التواصل..." rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-purple-400" />
          </div>
          <div className="flex items-center gap-2">
            <a href={`tel:${target.phone}`} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition">
              <Phone size={12} /> {target.phone}
            </a>
            <button onClick={() => {
              const digits = target.phone.replace(/\D/g, '');
              const whatsappNumber = toDialable(digits);
              window.open(`https://wa.me/${whatsappNumber}`, '_blank');
            }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-teal-200 bg-teal-50 text-xs text-teal-700 hover:bg-teal-100 transition">
              <MessageCircle size={12} /> واتساب
            </button>
          </div>
        </div>
    </Modal>
  );
}
