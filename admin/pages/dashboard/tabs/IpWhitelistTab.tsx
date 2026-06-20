import React, { useEffect, useMemo, useState } from 'react';
import { Shield, Plus, Trash2, CheckCircle, XCircle, Globe, AlertCircle, RefreshCw, Save } from 'lucide-react';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;


function isValidIP(ip: string) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export default function IpWhitelistTab({ notify }: { notify: NotifyFn }) {
  const [whitelist, setWhitelist] = useState<{ id: number; ip: string; label: string; created_at: string }[]>([]);
  const [newIp, setNewIp] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [myIp, setMyIp] = useState<string>('');

  // Fetch current IP list from API
  async function loadWhitelist() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/ip-whitelist`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setWhitelist(data.whitelist || []);
      }
    } catch {}
    setLoading(false);
  }

  async function fetchMyIp() {
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const d = await res.json();
      setMyIp(d.ip);
    } catch {}
  }

  useEffect(() => { loadWhitelist(); fetchMyIp(); }, []);

  async function addIp() {
    if (!newIp.trim()) { notify('error', 'أدخل IP صحيح'); return; }
    if (!isValidIP(newIp.trim())) { notify('error', 'صيغة IP غير صحيحة (مثال: 192.168.1.1)'); return; }
    if (whitelist.some(e => e.ip === newIp.trim())) { notify('error', 'هذا الـ IP موجود بالفعل'); return; }
    try {
      const res = await fetch(`/api/admin/ip-whitelist`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: newIp.trim(), label: newLabel.trim() || null }),
      });
      if (res.ok) {
        const data = await res.json();
        setWhitelist(prev => [...prev, data.entry]);
        notify('success', 'تم إضافة الـ IP');
      } else {
        const err = await res.json();
        notify('error', err.error || 'فشل الحفظ');
      }
    } catch { notify('error', 'خطأ في الاتصال'); }
    setNewIp(''); setNewLabel('');
  }

  async function removeIp(id: number) {
    try {
      const res = await fetch(`/api/admin/ip-whitelist/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) { setWhitelist(prev => prev.filter(e => e.id !== id)); notify('success', 'تم حذف الـ IP'); }
      else notify('error', 'فشل الحذف');
    } catch { notify('error', 'خطأ في الحذف'); }
  }

  function addMyIp() {
    if (myIp) { setNewIp(myIp); setNewLabel('IP الخاص بي'); }
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-gray-800 to-slate-700 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><Shield size={22} />قائمة IP البيضاء</h2>
        <p className="text-gray-300 text-sm mt-1">إدارة عناوين IP المسموح لها بالوصول للوحة التحكم</p>
      </div>

      {/* My IP */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center gap-3">
        <Globe size={18} className="text-blue-500 flex-shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-blue-800">عنوان IP الخاص بك الحالي</div>
          <div className="font-mono text-blue-700 font-bold">{myIp || 'جاري التحميل...'}</div>
        </div>
        {myIp && (
          <button onClick={addMyIp} className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition flex items-center gap-1">
            <Plus size={12} />إضافة
          </button>
        )}
      </div>

      {/* Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
        <AlertCircle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="text-amber-800 text-sm">
          <strong>تحذير:</strong> إضافة IP لا يعني تلقائياً تفعيل قيود الوصول. هذه القائمة مرجعية وستُربط بإعدادات الأمان من خلال API لاحقاً.
        </div>
      </div>

      {/* Add form */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Plus size={16} className="text-slate-500" />إضافة IP جديد</h3>
        <div className="flex flex-wrap gap-3">
          <input value={newIp} onChange={e => setNewIp(e.target.value)} placeholder="192.168.1.1"
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono flex-1 min-w-[150px] focus:outline-none focus:ring-2 focus:ring-slate-300"
            onKeyDown={e => e.key === 'Enter' && addIp()} />
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="وصف (اختياري)"
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm flex-1 min-w-[150px] focus:outline-none focus:ring-2 focus:ring-slate-300"
            onKeyDown={e => e.key === 'Enter' && addIp()} />
          <button onClick={addIp} className="px-4 py-2 bg-slate-800 text-white rounded-xl text-sm font-bold hover:bg-slate-900 transition flex items-center gap-1">
            <Plus size={14} />إضافة
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Shield size={16} className="text-slate-500" />الـ IPs المُضافة</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{whitelist.length} عنوان</span>
            <button onClick={loadWhitelist} className="p-1.5 hover:bg-gray-100 rounded-lg transition text-gray-400 hover:text-gray-700">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        {whitelist.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <Shield size={32} className="mx-auto mb-3 text-gray-200" />
            <p>القائمة فارغة — أضف عناوين IP للسماح بوصولها</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {whitelist.map(entry => (
              <div key={entry.id} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition">
                <CheckCircle size={16} className="text-emerald-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-bold text-gray-800 text-sm">{entry.ip}</div>
                  <div className="text-xs text-gray-500">{entry.label || 'بدون وصف'}</div>
                </div>
                <div className="text-xs text-gray-400 hidden md:block">{(entry.created_at || '').slice(0, 10)}</div>
                <button onClick={() => removeIp(entry.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition flex-shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
