import React from 'react';
import { Users, Search, ChevronRight } from 'lucide-react';
import type { StaffMember, StaffRole } from '../../../../types';
import { ROLE_LABELS, ROLE_COLORS, getMonthsOfService, fmtMoney } from './shared';

interface Props {
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  roleFilter: string;
  setRoleFilter: React.Dispatch<React.SetStateAction<string>>;
  statusFilter: string;
  setStatusFilter: React.Dispatch<React.SetStateAction<string>>;
  uniqueRoles: StaffRole[];
  filtered: StaffMember[];
  safeOrders: any[];
  safeLeads: any[];
  onSelect: (member: StaffMember) => void;
}

const DirectoryTab: React.FC<Props> = ({ search, setSearch, roleFilter, setRoleFilter, statusFilter, setStatusFilter, uniqueRoles, filtered, safeOrders, safeLeads, onSelect }) => (
  <div className="space-y-4">
    <div className="flex flex-wrap gap-3">
      <div className="relative flex-1 min-w-[180px]">
        <Search size={14} className="absolute right-3 top-2.5 text-gray-400"/>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو الإيميل..." className="w-full pr-8 pl-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"/>
      </div>
      <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm">
        <option value="all">كل الأدوار</option>
        {uniqueRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
      </select>
      <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm">
        <option value="all">كل الحالات</option>
        <option value="active">نشط</option>
        <option value="inactive">غير نشط</option>
      </select>
      <span className="text-sm text-gray-400 self-center">{filtered.length} موظف</span>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {filtered.length === 0 ? (
        <div className="col-span-3 text-center py-16 text-gray-400"><Users size={40} className="mx-auto mb-3 opacity-20"/><p>لا نتائج</p></div>
      ) : filtered.map(member => {
        const myRev = safeOrders.filter((o: any) => o.staffId === member.id && o.status === 'paid').reduce((s: number, o: any) => s + (o.amount || 0), 0);
        const myLeads = safeLeads.filter((l: any) => l.assignedSalesId === member.id).length;
        const myConverted = safeLeads.filter((l: any) => l.assignedSalesId === member.id && l.status === 'converted').length;
        const tType = member.monthlyTargetType || 'egp';
        const prog = tType === 'egp' ? myRev : myConverted;
        const tPct = (member.monthlyTarget || 0) > 0 ? Math.min(100, Math.round(prog / member.monthlyTarget! * 100)) : 0;
        return (
          <button key={member.id} onClick={() => onSelect(member)} className="bg-white border border-gray-200 rounded-2xl p-4 text-right hover:shadow-md hover:border-slate-400 transition-all group">
            <div className="flex items-start gap-3 mb-3">
              <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-black text-base shrink-0 ${member.status === 'active' ? 'bg-slate-600' : 'bg-gray-400'}`}>{member.name.charAt(0)}</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-800 truncate group-hover:text-slate-700">{member.name}</p>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-600'}`}>{ROLE_LABELS[member.role] || member.role}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${member.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{member.status === 'active' ? '● نشط' : '● غير نشط'}</span>
                </div>
              </div>
              <ChevronRight size={14} className="text-gray-300 group-hover:text-slate-500 transition-colors shrink-0 mt-1"/>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-gray-50 rounded-lg py-1.5"><div className="text-xs font-bold text-gray-700">{getMonthsOfService(member.joinedAt || new Date().toISOString())}</div><div className="text-[10px] text-gray-400">مدة الخدمة</div></div>
              <div className="bg-gray-50 rounded-lg py-1.5"><div className="text-xs font-bold text-gray-700">{myLeads}</div><div className="text-[10px] text-gray-400">ليدات</div></div>
              <div className="bg-gray-50 rounded-lg py-1.5"><div className={`text-xs font-bold ${myRev > 0 ? 'text-green-700' : 'text-gray-400'}`}>{myRev > 0 ? `${Math.round(myRev / 1000)}k` : '—'}</div><div className="text-[10px] text-gray-400">مبيعات</div></div>
            </div>
            {(member.monthlyTarget || 0) > 0 && (
              <div className="mt-2">
                <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                  <span>التارجت</span>
                  <span>{tType === 'clients' ? `${member.monthlyTarget} عميل` : fmtMoney(member.monthlyTarget!)}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${tPct >= 100 ? 'bg-emerald-500' : 'bg-slate-500'}`} style={{ width: `${tPct}%` }}/></div>
              </div>
            )}
          </button>
        );
      })}
    </div>
  </div>
);

export default DirectoryTab;
