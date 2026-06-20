import React from 'react';
import { Phone, Plus, Activity, MessageSquare, Trash2, CheckCircle, Clock } from 'lucide-react';
import { CommunicationRecord } from '../../types';
import { commTypeMeta } from '../unifiedClient.constants';

type Comm = CommunicationRecord & { _src?: string };

interface Props {
  allComms: Comm[];
  clientName: string;
  clientPhone: string;
  isSub: boolean;
  onAdd: () => void;
  onDelete: (commId: string, src: 'lead' | 'subscriber') => void;
}

// Communications timeline tab — extracted verbatim from UnifiedClientPage (Refactor #1).
const CommunicationsTab: React.FC<Props> = ({ allComms, clientName, clientPhone, isSub, onAdd, onDelete }) => (
  <div id="section-communications" className="space-y-4">
    <div className="flex items-center gap-3 mb-4">
      <div className="w-1 h-5 rounded-full bg-blue-500 flex-shrink-0" />
      <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
        <Phone size={14} className="text-blue-500" /> التواصل
      </h3>
      <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{allComms.length}</span>
    </div>
    <button onClick={onAdd}
      className="w-full py-3 border-2 border-dashed border-blue-200 rounded-xl text-blue-600 hover:border-blue-400 hover:bg-blue-50 text-sm flex items-center justify-center gap-2">
      <Plus size={18} /> تسجيل تواصل جديد
    </button>
    {allComms.length === 0 ? (
      <div className="text-center py-10 text-gray-400">
        <Activity size={40} className="mx-auto mb-2 text-gray-200" />
        <p>لا يوجد تواصل مسجل</p>
      </div>
    ) : (
      <div className="relative">
        <div className="absolute right-5 top-0 bottom-0 w-px bg-gray-100" />
        <div className="space-y-4">
          {allComms.map(comm => {
            const c = comm as Comm;
            const meta = commTypeMeta[c.type] || commTypeMeta.note;
            const waPhone = clientPhone.replace(/\D/g, '');
            const waMsg = encodeURIComponent(`مرحباً ${clientName}،`);
            const waLink = waPhone ? `https://wa.me/${waPhone}?text=${waMsg}` : null;
            return (
              <div key={c.id} className="flex gap-4 group">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0 z-10 ${meta.color}`}>{meta.icon}</div>
                <div className="flex-1 bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center flex-wrap gap-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>
                      <span className="text-xs text-gray-400">{c.date}</span>
                      {waLink && (
                        <a href={waLink} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] font-bold text-green-700 bg-green-50 hover:bg-green-100 px-2 py-0.5 rounded-full border border-green-200 flex items-center gap-1 transition">
                          <MessageSquare size={10} /> رد واتساب
                        </a>
                      )}
                    </div>
                    <button onClick={() => onDelete(c.id, (c._src ?? (isSub ? 'subscriber' : 'lead')) as 'lead' | 'subscriber')}
                      className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                  </div>
                  {c.notes && <p className="text-sm text-gray-700 mt-2 leading-relaxed">{c.notes}</p>}
                  {c.outcome && <div className="mt-2 flex items-center gap-2 text-xs text-green-700 bg-green-50 px-3 py-1.5 rounded-lg"><CheckCircle size={12} />{c.outcome}</div>}
                  {c.nextFollowUp && <div className="mt-1 flex items-center gap-2 text-xs text-orange-700 bg-orange-50 px-3 py-1.5 rounded-lg"><Clock size={12} />موعد المتابعة: {c.nextFollowUp}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}
  </div>
);

export default CommunicationsTab;
