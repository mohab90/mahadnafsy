import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Server,
  Terminal,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface ServerStatusData {
  ok: boolean;
  time: string;
  pm2: {
    status: string;
    uptime: number | null;
    restarts: number;
    memory: number;
    cpu: number;
    pid: number | null;
  } | null;
  watchdogLog: string[];
  crashHistory: string[];
  stats: { totalCrashes: number; totalStarts: number; autoHeals: number };
  memNow: number;
  dbPool: { connectionLimit: number | null };
}

function formatUptime(ms: number | null): string {
  if (!ms || ms < 0) return '-';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}ث`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}س ${m % 60}د`;
  const d = Math.floor(h / 24);
  return `${d}ي ${h % 24}س`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ServerMonitorTab({ notify }: { notify: NotifyFn }) {
  const [data, setData] = useState<ServerStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const json = await mysqlAdmin.adminGet<ServerStatusData>('/admin/server-status');
      setData(json);
      setLastFetch(new Date());
    } catch (e: unknown) {
      if (!silent) notify('error', 'تعذّر جلب حالة السيرفر: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [notify]);

  // Auto-refresh every 30s
  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(() => fetchStatus(true), 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchStatus]);

  // Scroll to bottom of log when it updates
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.watchdogLog]);

  const handleRestart = async () => {
    if (!restartConfirm) { setRestartConfirm(true); return; }
    setRestartConfirm(false);
    setRestarting(true);
    try {
      await mysqlAdmin.adminPost('/admin/server-restart', {});
      notify('info', 'جاري إعادة التشغيل... سيعود خلال ثوانٍ');
      setTimeout(() => { fetchStatus(); setRestarting(false); }, 5000);
    } catch (e: unknown) {
      notify('error', 'فشل إعادة التشغيل: ' + (e instanceof Error ? e.message : String(e)));
      setRestarting(false);
    }
  };

  const cancelRestart = () => setRestartConfirm(false);

  const isOnline = data?.pm2?.status === 'online';
  const memMB = data?.pm2?.memory ? data.pm2.memory / 1024 / 1024 : 0;
  const memColor = memMB > 180 ? 'text-red-600 bg-red-50' : memMB > 120 ? 'text-amber-600 bg-amber-50' : 'text-emerald-700 bg-emerald-50';
  const cpuColor = (data?.pm2?.cpu ?? 0) > 80 ? 'text-red-600 bg-red-50' : (data?.pm2?.cpu ?? 0) > 50 ? 'text-amber-600 bg-amber-50' : 'text-emerald-700 bg-emerald-50';

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-800 text-white grid place-items-center">
            <Server size={20} />
          </div>
          <div>
            <h2 className="font-extrabold text-gray-900">مراقبة السيرفر</h2>
            {lastFetch && (
              <p className="text-xs text-gray-400">
                آخر تحديث: {lastFetch.toLocaleTimeString('ar-EG')} — يتحدث كل 30 ث
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchStatus()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
          <button
            onClick={handleRestart}
            disabled={restarting || loading}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold transition disabled:opacity-50 ${
              restartConfirm
                ? 'border-red-400 bg-red-600 text-white hover:bg-red-700 animate-pulse'
                : 'border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700'
            }`}
          >
            <RotateCcw size={14} className={restarting ? 'animate-spin' : ''} />
            {restarting ? 'جاري الإعادة...' : restartConfirm ? '⚠️ تأكيد الإعادة! اضغط مرة ثانية' : 'إعادة التشغيل'}
          </button>
          {restartConfirm && (
            <button
              onClick={cancelRestart}
              className="flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm text-gray-500 transition"
            >
              إلغاء
            </button>
          )}
        </div>
      </div>

      {/* ── Status Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Online/Offline */}
        <div className={`rounded-2xl border p-4 flex flex-col gap-1 ${isOnline ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2">
            {isOnline ? <Wifi size={16} className="text-emerald-600" /> : <WifiOff size={16} className="text-red-500" />}
            <span className="text-xs font-bold text-gray-500">الحالة</span>
          </div>
          <p className={`text-xl font-extrabold ${isOnline ? 'text-emerald-700' : 'text-red-600'}`}>
            {data ? (isOnline ? 'متصل ✅' : data.pm2?.status ?? 'غير معروف') : '---'}
          </p>
          {data?.pm2?.pid && <p className="text-[10px] text-gray-400">PID: {data.pm2.pid}</p>}
        </div>

        {/* Uptime */}
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-blue-600" />
            <span className="text-xs font-bold text-gray-500">وقت التشغيل</span>
          </div>
          <p className="text-xl font-extrabold text-blue-700">
            {data?.pm2?.uptime != null ? formatUptime(data.pm2.uptime) : '---'}
          </p>
          <p className="text-[10px] text-gray-400">إعادات: {data?.pm2?.restarts ?? '-'}</p>
        </div>

        {/* Memory */}
        <div className={`rounded-2xl border p-4 flex flex-col gap-1 ${memColor} border-current/20`}>
          <div className="flex items-center gap-2">
            <HardDrive size={16} />
            <span className="text-xs font-bold text-gray-500 text-current">الذاكرة</span>
          </div>
          <p className="text-xl font-extrabold">
            {data?.pm2?.memory != null ? formatBytes(data.pm2.memory) : '---'}
          </p>
          <p className="text-[10px] opacity-60">حد: {data?.dbPool?.connectionLimit ?? '-'} DB conn</p>
        </div>

        {/* CPU */}
        <div className={`rounded-2xl border p-4 flex flex-col gap-1 ${cpuColor} border-current/20`}>
          <div className="flex items-center gap-2">
            <Cpu size={16} />
            <span className="text-xs font-bold text-gray-500">CPU</span>
          </div>
          <p className="text-xl font-extrabold">
            {data?.pm2?.cpu != null ? `${data.pm2.cpu}%` : '---'}
          </p>
          <p className="text-[10px] opacity-60">استخدام المعالج</p>
        </div>
      </div>

      {/* ── Health Indicators ── */}
      {data && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 text-sm mb-3 flex items-center gap-2">
            <CheckCircle2 size={15} className="text-emerald-500" /> صحة الخدمة
          </h3>
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
              {isOnline ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
              API Server
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
              <CheckCircle2 size={11} /> MySQL DB
            </span>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${(data.pm2?.restarts ?? 0) > 5 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {(data.pm2?.restarts ?? 0) > 5 ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
              PM2 ({data.pm2?.restarts ?? 0} restarts هذه الجلسة)
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
              <CheckCircle2 size={11} /> Watchdog (كل دقيقة)
            </span>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${(data.stats?.autoHeals ?? 0) > 0 ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'}`}>
              <CheckCircle2 size={11} /> Auto-Heal ({data.stats?.autoHeals ?? 0} مرة)
            </span>
          </div>
        </div>
      )}

      {/* ── Cumulative Crash Stats ── */}
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className={`rounded-2xl border p-4 text-center ${(data.stats?.totalCrashes ?? 0) > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <p className={`text-3xl font-extrabold ${(data.stats?.totalCrashes ?? 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {data.stats?.totalCrashes ?? 0}
            </p>
            <p className="text-xs font-bold text-gray-500 mt-1">إجمالي الأعطال</p>
            <p className="text-[10px] text-gray-400">(منذ أول تسجيل)</p>
          </div>
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-center">
            <p className="text-3xl font-extrabold text-blue-600">{data.stats?.totalStarts ?? 0}</p>
            <p className="text-xs font-bold text-gray-500 mt-1">إجمالي عمليات التشغيل</p>
            <p className="text-[10px] text-gray-400">(deploys + restarts)</p>
          </div>
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-center">
            <p className="text-3xl font-extrabold text-violet-600">{data.stats?.autoHeals ?? 0}</p>
            <p className="text-xs font-bold text-gray-500 mt-1">Auto-Heal</p>
            <p className="text-[10px] text-gray-400">(restart استباقي قبل الوقوع)</p>
          </div>
        </div>
      )}

      {/* ── Crash History Log ── */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
            <Terminal size={15} className="text-red-500" />
            سجل الأعطال الكامل
            <span className="text-xs text-gray-400 font-normal">({data?.crashHistory?.length ?? 0} سطر — لا يُمسح أبدًا)</span>
          </h3>
          {(data?.stats?.totalCrashes ?? 0) === 0 && (
            <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
              ✅ لم يُسجَّل أي عطل
            </span>
          )}
        </div>
        <div className="bg-gray-950 rounded-b-2xl p-4 max-h-72 overflow-y-auto font-mono text-xs text-gray-300 space-y-0.5 leading-relaxed">
          {!data ? (
            <p className="text-gray-500 text-center py-4">جاري التحميل...</p>
          ) : (data.crashHistory ?? []).length === 0 ? (
            <p className="text-emerald-400 text-center py-4">📗 لا توجد سجلات أعطال — السيرفر يعمل بلا انقطاع</p>
          ) : (
            [...(data.crashHistory ?? [])].reverse().map((line, i) => (
              <div key={i} className={`px-1 rounded ${
                line.includes('[CRASH]') ? 'text-red-400 font-bold' :
                line.includes('[RECOVERED]') ? 'text-emerald-400' :
                line.includes('[AUTO-HEAL]') ? 'text-violet-400' :
                line.includes('[START]') ? 'text-blue-400' :
                'text-gray-400'
              }`}>
                {line}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* ── Watchdog Operational Log ── */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
            <Terminal size={15} className="text-gray-500" />
            سجل الـ Watchdog (آخر 30 سطر)
            <span className="text-xs text-gray-400 font-normal">— يُحافظ على 500 سطر</span>
          </h3>
        </div>
        <div className="bg-gray-950 rounded-b-2xl p-4 max-h-48 overflow-y-auto font-mono text-xs text-gray-300 space-y-0.5 leading-relaxed">
          {!data ? (
            <p className="text-gray-500 text-center py-4">جاري التحميل...</p>
          ) : (data.watchdogLog ?? []).length === 0 ? (
            <p className="text-gray-500 text-center py-4">السجل فارغ — الـ Watchdog لم يُفعَّل بعد</p>
          ) : (
            (data.watchdogLog ?? []).map((line, i) => (
              <div key={i} className={`px-1 rounded ${
                line.includes('down') ? 'text-red-400' :
                line.includes('OK') || line.includes('عاد') ? 'text-emerald-400' :
                'text-gray-400'
              }`}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── WA Alert Config Note ── */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
        <p className="font-bold mb-1 flex items-center gap-2">
          <AlertTriangle size={14} /> إشعارات واتساب عند توقف السيرفر
        </p>
        <p className="text-xs leading-relaxed">
          لتفعيل إشعارات واتساب التلقائية، أضف في ملف <code className="bg-amber-100 px-1 rounded">.env</code>:
          <br />
          <code className="bg-amber-100 px-1 rounded block mt-1 py-0.5">
            WHATSAPP_TOKEN=... &nbsp;&nbsp; WHATSAPP_PHONE_ID=... &nbsp;&nbsp; ADMIN_WHATSAPP_PHONE=201XXXXXXXXX
          </code>
        </p>
      </div>
    </div>
  );
}
