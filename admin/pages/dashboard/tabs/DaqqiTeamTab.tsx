import React, { useMemo, useState } from 'react';
import { Users, Calendar, BookOpen, Award, TrendingUp, Star, Clock, CheckCircle, XCircle, ChevronDown, User, BarChart3, Layers } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

const ROLE_LABELS: Record<string, string> = {
  reception_daqqi: 'استقبال دقي',
  daqqi_manager: 'مدير دقي',
  instructor: 'مدرب',
  trainer: 'مدرب',
};

const DaqqiTeamTab: React.FC<Props> = ({ notify }) => {
  const { staffMembers, daqqiRounds, courses } = useSiteData();
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<'team' | 'stats' | 'schedule'>('team');

  const daqqiTeam = useMemo(() =>
    staffMembers.filter(s => s.role === 'reception_daqqi' || s.role === 'daqqi_manager'),
    [staffMembers]
  );
  const instructors = useMemo(() =>
    staffMembers.filter(s => s.role === 'instructor' || s.role === 'trainer'),
    [staffMembers]
  );

  const activeRounds = daqqiRounds.filter(r => r.status === 'active');
  const finishedRounds = daqqiRounds.filter(r => r.status === 'finished');
  const newRounds = daqqiRounds.filter(r => r.status === 'new');

  const totalAttendees = daqqiRounds.reduce((s, r) => s + r.attendees.length, 0);
  const totalRevenue = daqqiRounds.reduce((s, r) => s + r.attendees.reduce((a, at) => a + at.amountPaid, 0), 0);

  // Stats per instructor
  const instructorStats = useMemo(() => instructors.map(inst => {
    const rounds = daqqiRounds.filter(r => r.instructorId === inst.id);
    const attendees = rounds.reduce((s, r) => s + r.attendees.length, 0);
    const revenue = rounds.reduce((s, r) => s + r.attendees.reduce((a, at) => a + at.amountPaid, 0), 0);
    const active = rounds.filter(r => r.status === 'active').length;
    return { instructor: inst, rounds, attendees, revenue, active };
  }).sort((a, b) => b.revenue - a.revenue), [instructors, daqqiRounds]);

  // Stats per reception
  const receptionStats = useMemo(() => daqqiTeam.map(member => {
    const assigned = daqqiRounds.filter(r => r.receptionId === member.id);
    const attendees = assigned.reduce((s, r) => s + r.attendees.length, 0);
    const active = assigned.filter(r => r.status === 'active').length;
    return { member, assigned, attendees, active };
  }), [daqqiTeam, daqqiRounds]);

  // Active rounds grouped by day
  const byDay = useMemo(() => {
    const days: Record<string, typeof activeRounds> = {};
    activeRounds.forEach(r => {
      if (!days[r.dayOfWeek]) days[r.dayOfWeek] = [];
      days[r.dayOfWeek].push(r);
    });
    return days;
  }, [activeRounds]);

  const dayOrder = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-teal-700 to-cyan-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><Users size={22} /> فريق دقي</h2>
        <p className="text-teal-200 text-sm mt-0.5">إدارة فريق وأداء مركز دقي</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'فريق الاستقبال', value: daqqiTeam.length },
            { label: 'روندات نشطة', value: activeRounds.length, bg: 'bg-cyan-500/30' },
            { label: 'إجمالي الطلاب', value: totalAttendees },
            { label: 'إجمالي الإيرادات', value: `${totalRevenue.toLocaleString()} ج.م`, small: true },
          ].map(s => (
            <div key={s.label} className={`${s.bg || 'bg-white/15'} rounded-xl p-3 text-center`}>
              <div className={`font-black ${s.small ? 'text-base' : 'text-2xl'}`}>{s.value}</div>
              <div className="text-xs text-teal-200 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Subtabs */}
      <div className="flex gap-2">
        {([['team', '👥 الفريق'], ['stats', '📊 الإحصائيات'], ['schedule', '📅 الجدول']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${subTab === k ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Team tab */}
      {subTab === 'team' && (
        <div className="space-y-4">
          {/* Reception team */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-gray-800 flex items-center gap-2"><User size={15} className="text-teal-500" /> فريق الاستقبال ({daqqiTeam.length})</h3>
            </div>
            {daqqiTeam.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">لا يوجد فريق استقبال</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {receptionStats.map(({ member, assigned, attendees, active }) => (
                  <div key={member.id}>
                    <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-right"
                      onClick={() => setExpandedMember(expandedMember === member.id ? null : member.id)}>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${member.status === 'active' ? 'bg-teal-500' : 'bg-gray-400'}`}>
                        {member.name.charAt(0)}
                      </div>
                      <div className="flex-1 text-right">
                        <p className="font-bold text-gray-800 text-sm">{member.name}</p>
                        <p className="text-xs text-gray-400">{ROLE_LABELS[member.role] || member.role} · {member.phone}</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs shrink-0">
                        <div className="text-center">
                          <div className="font-bold text-teal-600">{active}</div>
                          <div className="text-gray-400">روندات نشطة</div>
                        </div>
                        <div className="text-center">
                          <div className="font-bold text-indigo-600">{attendees}</div>
                          <div className="text-gray-400">طلاب</div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${member.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                          {member.status === 'active' ? '● نشط' : '● غير نشط'}
                        </span>
                        <ChevronDown size={14} className={`text-gray-400 transition-transform ${expandedMember === member.id ? 'rotate-180' : ''}`} />
                      </div>
                    </button>
                    {expandedMember === member.id && (
                      <div className="px-4 pb-4 space-y-2 border-t border-gray-50">
                        <p className="text-xs text-gray-500 mt-2">الروندات المسؤول عنها ({assigned.length})</p>
                        {assigned.length === 0 ? (
                          <p className="text-xs text-gray-400 py-3 text-center">لا روندات</p>
                        ) : assigned.map(r => {
                          const course = courses.find(c => c.id === r.courseId);
                          return (
                            <div key={r.id} className="bg-gray-50 rounded-xl p-3 flex justify-between items-center">
                              <div>
                                <p className="text-sm font-medium text-gray-800">{course?.title || r.code}</p>
                                <p className="text-xs text-gray-400">{r.dayOfWeek} · {r.timeSlot} · {r.attendees.length} طالب</p>
                              </div>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.status === 'active' ? 'bg-green-50 text-green-700' : r.status === 'new' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                {r.status === 'active' ? 'نشط' : r.status === 'new' ? 'جديد' : 'منتهي'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Instructors */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-gray-800 flex items-center gap-2"><BookOpen size={15} className="text-indigo-500" /> المدربون ({instructors.length})</h3>
            </div>
            {instructors.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">لا مدربون</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {instructorStats.map(({ instructor: inst, rounds, attendees, revenue, active }) => (
                  <div key={inst.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm shrink-0">
                      {inst.name.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-gray-800 text-sm">{inst.name}</p>
                      <p className="text-xs text-gray-400">{inst.specialization || 'معالج نفسي'}</p>
                    </div>
                    <div className="flex gap-4 text-xs text-center">
                      <div><div className="font-bold text-indigo-600">{rounds.length}</div><div className="text-gray-400">روندات</div></div>
                      <div><div className="font-bold text-teal-600">{active}</div><div className="text-gray-400">نشطة</div></div>
                      <div><div className="font-bold text-green-600">{attendees}</div><div className="text-gray-400">طلاب</div></div>
                      <div><div className="font-bold text-amber-600 text-[11px]">{revenue.toLocaleString()}</div><div className="text-gray-400">ج.م</div></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats tab */}
      {subTab === 'stats' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Round status */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-gray-800 mb-4">توزيع الروندات</h3>
            <div className="space-y-3">
              {[
                { label: 'نشطة', count: activeRounds.length, total: daqqiRounds.length, color: 'bg-green-500' },
                { label: 'جديدة', count: newRounds.length, total: daqqiRounds.length, color: 'bg-blue-500' },
                { label: 'منتهية', count: finishedRounds.length, total: daqqiRounds.length, color: 'bg-gray-400' },
              ].map(row => (
                <div key={row.label} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-16">{row.label}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${row.color} transition-all`} style={{ width: row.total > 0 ? `${Math.round(row.count / row.total * 100)}%` : '0%' }} />
                  </div>
                  <span className="text-sm font-bold text-gray-700 w-8 text-right">{row.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top instructors */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-gray-800 mb-4">أفضل المدربين (بالإيراد)</h3>
            {instructorStats.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">لا بيانات</p>
            ) : instructorStats.slice(0, 5).map((s, i) => {
              const medals = ['🥇', '🥈', '🥉'];
              const pct = instructorStats[0]?.revenue > 0 ? Math.round(s.revenue / instructorStats[0].revenue * 100) : 0;
              return (
                <div key={s.instructor.id} className="flex items-center gap-3 mb-3">
                  <span className="text-base w-6 text-center">{medals[i] || `${i + 1}`}</span>
                  <div className="flex-1">
                    <div className="flex justify-between mb-0.5">
                      <span className="text-sm font-medium text-gray-800">{s.instructor.name}</span>
                      <span className="text-xs font-bold text-green-600">{s.revenue.toLocaleString()} ج.م</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-teal-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Revenue by time slot */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-gray-800 mb-4">الروندات حسب الوقت</h3>
            {(['صباحاً', 'ظهراً', 'مساءً'] as const).map(slot => {
              const count = daqqiRounds.filter(r => r.timeSlot === slot).length;
              const pct = daqqiRounds.length > 0 ? Math.round(count / daqqiRounds.length * 100) : 0;
              const colors: Record<string, string> = { 'صباحاً': 'bg-amber-400', 'ظهراً': 'bg-orange-400', 'مساءً': 'bg-indigo-500' };
              return (
                <div key={slot} className="flex items-center gap-3 mb-3">
                  <span className="text-sm text-gray-600 w-14">{slot}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${colors[slot]}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-bold w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>

          {/* KPIs */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-gray-800 mb-4">مؤشرات الأداء</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'متوسط طلاب/روند', value: daqqiRounds.length > 0 ? (totalAttendees / daqqiRounds.length).toFixed(1) : 0, color: 'text-teal-600' },
                { label: 'متوسط إيراد/روند', value: daqqiRounds.length > 0 ? `${Math.round(totalRevenue / daqqiRounds.length).toLocaleString()} ج.م` : '0', color: 'text-green-600' },
                { label: 'معدل إكمال الروندات', value: daqqiRounds.length > 0 ? `${Math.round(finishedRounds.length / daqqiRounds.length * 100)}%` : '0%', color: 'text-indigo-600' },
                { label: 'إجمالي الروندات', value: daqqiRounds.length, color: 'text-gray-700' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className={`text-xl font-black ${k.color}`}>{k.value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{k.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Schedule tab */}
      {subTab === 'schedule' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {dayOrder.filter(d => byDay[d]).map(day => (
              <div key={day} className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-2 bg-teal-50 border-b border-teal-100">
                  <h4 className="font-bold text-teal-800 text-sm">{day} ({byDay[day].length} روند)</h4>
                </div>
                <div className="divide-y divide-gray-50">
                  {byDay[day].sort((a, b) => {
                    const order = { 'صباحاً': 0, 'ظهراً': 1, 'مساءً': 2 };
                    return (order[a.timeSlot] ?? 0) - (order[b.timeSlot] ?? 0);
                  }).map(r => {
                    const course = courses.find(c => c.id === r.courseId);
                    const inst = staffMembers.find(s => s.id === r.instructorId);
                    return (
                      <div key={r.id} className="px-4 py-2.5">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{course?.title || r.code}</p>
                            <p className="text-xs text-gray-400">{r.timeSlot} · {r.attendees.length} طالب</p>
                          </div>
                          <span className="text-xs text-indigo-500">{inst?.name.split(' ')[0] || '—'}</span>
                        </div>
                        {r.currentLecture && (
                          <p className="text-xs text-gray-400 mt-0.5">محاضرة {r.currentLecture}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {Object.keys(byDay).length === 0 && (
              <div className="col-span-3 text-center py-16 text-gray-400">
                <Calendar size={40} className="mx-auto mb-3 opacity-20" />
                <p>لا روندات نشطة حالياً</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DaqqiTeamTab;
