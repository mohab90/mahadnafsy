import { useMemo } from 'react';
import { Monitor, Users, BookOpen, Video, CheckCircle } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';


const ROLE_LABEL: Record<string, string> = {
  online_manager: 'مدير أونلاين', sales: 'سيلز', collection: 'تحصيل',
  support: 'خدمة عملاء', consultant: 'استشاري', lecturer: 'محاضر',
};

function getLast6Months() {
  const ms: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    ms.push(d.toISOString().slice(0, 7));
  }
  return ms;
}

export default function OnlineTeamMgmtTab() {
  const { staffMembers, subscribers, leads, courses } = useSiteData();
  const months = getLast6Months();

  const onlineTeam = useMemo(() =>
    staffMembers.filter(s => s.status === 'active' &&
      ['online_manager', 'support', 'consultant'].includes(s.role)),
    [staffMembers]
  );

  // Monthly new online subscribers (non-sales)
  const monthlyData = useMemo(() =>
    months.map(m => ({
      month: m.slice(5),
      مشتركين: subscribers.filter(s => (s.createdAt || '').slice(0, 7) === m).length,
      ليدات: leads.filter(l => (l.createdAt || '').slice(0, 7) === m).length,
    })),
    [subscribers, leads, months]
  );

  const activeSubs = useMemo(() => subscribers.filter(s =>
    !['finished','paused','refunded','leads'].includes(s.clientStatus || '')), [subscribers]);

  const totalCourses = courses.length;
  const totalSubs = subscribers.length;

  // Team workload - consultations assigned
  const teamStats = useMemo(() => onlineTeam.map(s => {
    const mySubs = subscribers.filter(sub =>
      sub.assignedStaffId === s.id || sub.consultantId === s.id
    );
    const myLeads = leads.filter(l => l.assignedSalesId === s.id);
    return { ...s, subsCount: mySubs.length, leadsCount: myLeads.length };
  }), [onlineTeam, subscribers, leads]);

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-cyan-600 to-teal-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><Monitor size={22} />إدارة فريق الأونلاين</h2>
        <p className="text-cyan-100 text-sm mt-1">نظرة شاملة على الفريق الرقمي، الاشتراكات، والمتابعة</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'فريق الأونلاين', val: onlineTeam.length, icon: Users, color: 'cyan' },
          { label: 'إجمالي المشتركين', val: totalSubs, icon: BookOpen, color: 'blue' },
          { label: 'المشتركون النشطون', val: activeSubs.length, icon: CheckCircle, color: 'emerald' },
          { label: 'الكورسات المتاحة', val: totalCourses, icon: Video, color: 'violet' },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4 flex items-center gap-3`}>
              <div className={`w-10 h-10 rounded-xl bg-${k.color}-100 flex items-center justify-center flex-shrink-0`}>
                <Icon size={18} className={`text-${k.color}-600`} />
              </div>
              <div>
                <div className="text-xl font-extrabold text-gray-900">{k.val}</div>
                <div className="text-xs text-gray-500">{k.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Monthly trend */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="font-bold text-gray-800 mb-4">📈 الاشتراكات والليدات — آخر 6 أشهر</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="مشتركين" fill="#06b6d4" radius={[4,4,0,0]} />
            <Bar dataKey="ليدات" fill="#8b5cf6" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Team cards */}
      <div>
        <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Users size={16} className="text-cyan-500" />أعضاء الفريق الرقمي</h3>
        {teamStats.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400">
            لا يوجد موظفون في فريق الأونلاين حالياً
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {teamStats.map(s => (
              <div key={s.id} className="bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-md transition">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-100 to-teal-100 flex items-center justify-center font-bold text-cyan-700 text-lg flex-shrink-0">
                    {s.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 text-sm">{s.name}</div>
                    <div className="text-xs text-gray-500">{ROLE_LABEL[s.role] || s.role}</div>
                  </div>
                  <div className="mr-auto">
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold">نشط</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center bg-gray-50 rounded-xl p-3">
                  <div>
                    <div className="text-lg font-extrabold text-cyan-700">{s.subsCount}</div>
                    <div className="text-[10px] text-gray-500">مشتركين مسؤول عنهم</div>
                  </div>
                  <div>
                    <div className="text-lg font-extrabold text-violet-700">{s.leadsCount}</div>
                    <div className="text-[10px] text-gray-500">ليدات مسندة</div>
                  </div>
                </div>
                {s.email && <div className="text-xs text-gray-400 mt-2 truncate">{s.email}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Courses overview */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100"><h3 className="font-bold text-gray-800">🎓 الكورسات النشطة</h3></div>
        <div className="divide-y divide-gray-50">
          {courses.filter(c => c.status === 'active' || !c.status).slice(0, 8).map(c => {
            const enrolledCount = subscribers.filter(s => {
              const ids = s.enrolledCourseIds || (s.enrolledCourseId ? [s.enrolledCourseId] : []);
              return ids.includes(c.id);
            }).length;
            return (
              <div key={c.id} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition">
                <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center flex-shrink-0"><Video size={14} /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{c.title}</div>
                  <div className="text-xs text-gray-400">{enrolledCount} مشترك</div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${c.status === 'active' || !c.status ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {c.status === 'active' || !c.status ? 'نشط' : c.status}
                </span>
              </div>
            );
          })}
          {courses.length === 0 && <div className="px-4 py-8 text-center text-gray-400">لا توجد كورسات</div>}
        </div>
      </div>
    </div>
  );
}
