import React from 'react';
import { X } from 'lucide-react';
import type { DaqqiRound, DaqqiRoundAttendee, SubscriberItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type HousingInfo = { roundId: string; roundCode: string; receptionId: string; receptionName: string };

interface Props {
  daqqiHousingModal: SubscriberItem | null;
  isDaqqiClientsTab: boolean;
  setDaqqiHousingModal: (row: SubscriberItem | null) => void;
  daqqiHousingRoundId: string;
  setDaqqiHousingRoundId: (id: string) => void;
  salesOwnDaqqiRounds: DaqqiRound[];
  setSalesOwnDaqqiRounds: React.Dispatch<React.SetStateAction<DaqqiRound[] | null>>;
  housingMap: Map<string, HousingInfo>;
  notify: NotifyFn;
}

export function DaqqiHousingModal({
  daqqiHousingModal, isDaqqiClientsTab, setDaqqiHousingModal, daqqiHousingRoundId,
  setDaqqiHousingRoundId, salesOwnDaqqiRounds, setSalesOwnDaqqiRounds, housingMap, notify,
}: Props) {
  if (!daqqiHousingModal || !isDaqqiClientsTab) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" dir="rtl" onClick={e=>{if(e.target===e.currentTarget)setDaqqiHousingModal(null);}}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-800">🏠 تسكين العميل في روند</h3>
          <button onClick={()=>setDaqqiHousingModal(null)} className="text-gray-400 hover:text-gray-700"><X size={18}/></button>
        </div>
        <p className="text-sm text-gray-600 mb-4">العميل: <strong>{daqqiHousingModal.name}</strong></p>
        <select value={daqqiHousingRoundId} onChange={e=>setDaqqiHousingRoundId(e.target.value)}
          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="">— اختر الروند —</option>
          {(salesOwnDaqqiRounds??[]).map((r:DaqqiRound)=>(
            <option key={r.id} value={r.id}>{r.code} — {r.receptionName} — {r.dayOfWeek} {r.timeSlot}</option>
          ))}
        </select>
        {daqqiHousingRoundId && housingMap.has(daqqiHousingModal.id) && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">⚠️ هذا العميل مسكن بالفعل — سيتم تغيير الروند.</p>
        )}
        <div className="flex gap-3 justify-end">
          <button onClick={()=>setDaqqiHousingModal(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">إلغاء</button>
          <button disabled={!daqqiHousingRoundId} onClick={async()=>{
            const round=(salesOwnDaqqiRounds??[]).find((r:DaqqiRound)=>r.id===daqqiHousingRoundId);
            if(!round||!daqqiHousingModal)return;
            const newAttendee:DaqqiRoundAttendee={
              subscriberId:daqqiHousingModal.id,
              name:daqqiHousingModal.name,
              phone:daqqiHousingModal.phone||'',
              bookedAt:new Date().toISOString(),
              amountPaid:0,
            };
            // Remove from old round if already housed
            let updatedRounds=(salesOwnDaqqiRounds??[]).map((r:DaqqiRound)=>{
              if(r.id===round.id){
                const filtered=(r.attendees??[]).filter((a:DaqqiRoundAttendee)=>a.subscriberId!==daqqiHousingModal.id);
                return{...r,attendees:[...filtered,newAttendee]};
              }
              // Remove from other rounds
              return{...r,attendees:(r.attendees??[]).filter((a:DaqqiRoundAttendee)=>a.subscriberId!==daqqiHousingModal.id)};
            });
            await mysqlAdmin.saveDaqqiRound(updatedRounds.find((r:DaqqiRound)=>r.id===round.id) as unknown as Record<string,unknown>);
            setSalesOwnDaqqiRounds(updatedRounds);
            notify('success',`✅ تم تسكين ${daqqiHousingModal.name} في روند ${round.code}`);
            setDaqqiHousingModal(null);
            setDaqqiHousingRoundId('');
          }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-40">تأكيد التسكين</button>
        </div>
      </div>
    </div>
  );
}
