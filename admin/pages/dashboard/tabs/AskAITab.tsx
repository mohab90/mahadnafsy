import React, { useState, useRef, useMemo, useCallback } from 'react';
import { AlertCircle, Bot, RefreshCw, Send, Trash2, Users, Zap, Copy, Check, ChevronDown, ChevronUp, Sparkles, TrendingUp, DollarSign } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export default function AskAITab({ notify: _notify }: { notify: NotifyFn }) {
  const {
    leads, subscribers, orders, courses, bundles, therapists, consultations,
    adminAiConfig,
  } = useSiteData();

  // Session-only by design: operational prompts and AI responses may contain
  // sensitive business data and must not survive in browser storage.
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiChatEndRef = useRef<HTMLDivElement>(null);

  // ── Pre-computed AI analysis data ──────────────────────────────────────────
  const _aiBranchLabels: Record<string, string> = {
    daqqi: 'الدقي', tagamoa: 'التجمع', 'online-egypt': 'أون لاين - مصر',
    'online-saudi': 'أون لاين - السعودية', 'online-abroad': 'خارج مصر', other: 'أخرى',
  };
  const _aiToEGP = (amt: number, cur: string) => cur === 'EGP' ? amt : cur === 'SAR' ? amt * 13 : amt * 50;

  const _aiAllManual = useMemo(() =>
    subscribers.flatMap(s =>
      (s.paymentHistory || []).map(p => ({
        ...p,
        branchCode: s.branch || 'other',
        branchLabel: _aiBranchLabels[s.branch || 'other'] || s.branch || '—',
      }))
    ),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [subscribers]);

  const _aiAllManualForBranch = _aiAllManual;
  const _aiBranchStats = useMemo(() => {
    const now = new Date(); const tM = now.getMonth(), tY = now.getFullYear();
    const isToday = (d: string) => !!d && new Date(d).toDateString() === now.toDateString();
    const isThisMonth = (d: string) => { if (!d) return false; const x = new Date(d); return x.getMonth() === tM && x.getFullYear() === tY; };
    const toEGP = _aiToEGP;
    const branchCodes = [...new Set(subscribers.map(s => s.branch || 'other'))] as string[];
    return branchCodes.map(code => {
      const bSubs = subscribers.filter(s => (s.branch || 'other') === code);
      const bPayments = _aiAllManualForBranch.filter(p => p.branchCode === code);
      return {
        code, label: _aiBranchLabels[code] || code, subs: bSubs.length,
        todayNew: bSubs.filter(s => isToday(s.createdAt || '')).length,
        todayRev: Math.round(bPayments.filter(p => isToday(p.at || '')).reduce((s, p) => s + toEGP(p.amount, p.currency), 0)),
        monthRev: Math.round(bPayments.filter(p => isThisMonth(p.at || '')).reduce((s, p) => s + toEGP(p.amount, p.currency), 0)),
        allRev: Math.round(bPayments.reduce((s, p) => s + toEGP(p.amount, p.currency), 0)),
      };
    }).sort((a, b) => b.subs - a.subs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribers, _aiAllManualForBranch]);

  // Use saved AI config (adminAiConfig from MySQL, alias as adminAiDraft for body code compatibility)
  const adminAiDraft = adminAiConfig || { provider: 'gemini', apiKey: '', model: 'gemini-2.0-flash-lite', temperature: 0.7, maxTokens: 1500, systemPrompt: '' };

  // ═══ PRE-COMPUTE everything once at IIFE top ═══════════════════
  const _now = new Date();
  const _todayISO = _now.toISOString().slice(0, 10);
  // Date filters
  const _isToday    = (d: string) => !!d && (d.startsWith(_todayISO) || new Date(d).toDateString() === _now.toDateString());
  const _toEGP = (amt: number, cur: string) => cur==='EGP'?amt:cur==='SAR'?amt*13:amt*50;

  // ── All manual payments (pre-memoized above for performance) ──────────────────
  const _allManual = _aiAllManual;

  // ── Daily stats ────────────────────────────────────────────────
  const _todayLeads   = leads.filter(l => _isToday(l.createdAt||''));
  const _todaySubs    = subscribers.filter(s => _isToday(s.createdAt||''));
  const _todayOrders  = orders.filter(o => o.status==='paid' && _isToday(o.paidAt||o.createdAt||''));
  const _todayManual  = _allManual.filter(p => _isToday(p.at||''));
  const _todayOnlineRev = _todayOrders.reduce((s,o)=>s+_toEGP(o.amount,o.currency),0);
  const _todayManualRev = _todayManual.reduce((s,p)=>s+_toEGP(p.amount,p.currency),0);

  // ── Branch stats (pre-memoized above) ─────────────────────────
  const _branchStats = _aiBranchStats;

  // Total revenue
  const _totalRevEGP = orders.filter(o=>o.status==='paid').reduce((s,o)=>s+_toEGP(o.amount,o.currency),0)
    + _allManual.reduce((s,p)=>s+_toEGP(p.amount,p.currency),0);

  // Only aggregate, non-identifying data crosses the third-party AI boundary.
  // Customer names, phones, messages, health details and payment notes stay local.
  const buildSystemContext = () => {
    const totalRevEGP = _totalRevEGP;
    const convRate = leads.length > 0 ? ((leads.filter(l => l.status === 'converted').length / leads.length) * 100).toFixed(1) : '0';
    const todayStr = _now.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const leadSources = Object.entries(leads.reduce((result: Record<string, number>, lead) => {
      const source = lead.source || 'غير محدد';
      result[source] = (result[source] || 0) + 1;
      return result;
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return `## دورك
أنت مساعد إداري لمعهد الدراسات النفسية. أجب بالعربية المصرية المهنية وبالأرقام المرفقة فقط.
لا تستنتج هوية أي شخص، ولا تطلب أو تعرض أسماء أو هواتف أو بريدًا أو رسائل أو بيانات صحية أو ملاحظات دفع.
إذا طُلبت بيانات فردية، وضّح أن سياق AI آمن ومجمّع ووجّه المستخدم للشاشة التشغيلية المختصة.

## التاريخ
اليوم: ${todayStr} (${_todayISO})

## اليوم
Leads جدد: ${_todayLeads.length}
مشتركون جدد: ${_todaySubs.length}
طلبات أونلاين مدفوعة: ${_todayOrders.length}
دفعات يدوية: ${_todayManual.length}
إيراد أونلاين: ${Math.round(_todayOnlineRev).toLocaleString()} ج.م
إيراد يدوي: ${Math.round(_todayManualRev).toLocaleString()} ج.م

## الإجماليات
المشتركون: ${subscribers.length} (نشط ${subscribers.filter(s => s.status === 'active').length}، موقوف ${subscribers.filter(s => s.status === 'paused').length})
Leads: ${leads.length} (جديد ${leads.filter(l => l.status === 'new').length}، تواصل ${leads.filter(l => l.status === 'contacted').length}، تحوّل ${leads.filter(l => l.status === 'converted').length}، ضائع ${leads.filter(l => l.status === 'lost').length})
معدل التحويل: ${convRate}%
الاستشارات: ${consultations.length} (انتظار ${consultations.filter(c => c.status === 'pending').length}، مؤكد ${consultations.filter(c => c.status === 'confirmed').length}، مكتمل ${consultations.filter(c => c.status === 'completed').length})
الكورسات: ${courses.length} | المعالجون: ${therapists.length} | المسارات: ${bundles.length}
الطلبات المدفوعة: ${orders.filter(o => o.status === 'paid').length} | المعلقة: ${orders.filter(o => o.status === 'pending').length}
إجمالي الإيراد التقريبي: ${Math.round(totalRevEGP).toLocaleString()} ج.م

## الفروع (بيانات مجمعة)
${_branchStats.map(branch => `${branch.label}: مشتركون ${branch.subs} | جديد اليوم ${branch.todayNew} | إيراد اليوم ${branch.todayRev.toLocaleString()} | الشهر ${branch.monthRev.toLocaleString()} ج.م`).join('\n') || 'لا توجد بيانات'}

## مصادر Leads
${leadSources.map(([source, count]) => `${source}: ${count}`).join('\n') || 'لا توجد بيانات'}

## أكثر الكورسات تسجيلًا
${[...courses].sort((a, b) => (b.students || 0) - (a.students || 0)).slice(0, 10).map(course => `${course.title}: ${course.students || 0} طالب`).join('\n') || 'لا توجد بيانات'}`;
  };

  const handleAiSend = async () => {
    if (!aiInput.trim() || aiLoading) return;
    const userMsg = aiInput.trim();
    setAiInput('');
    setAiMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setAiLoading(true);
    // Scroll to bottom
    setTimeout(() => { aiChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, 100);

    try {
      const customPrompt = adminAiDraft.systemPrompt?.trim();
      // Always include full data context; custom prompt is prepended as extra instructions
      const dataCtx = buildSystemContext();
      const systemCtx = customPrompt
        ? `## تعليمات الأدمن (أولوية عليا)
${customPrompt}

` + dataCtx
        : dataCtx;

      // Keep last 8 turns of history for context
      const history = aiMessages.slice(-16);

      const { text } = await mysqlAdmin.generateAdminAi({
        systemPrompt: systemCtx,
        messages: [...history, { role: 'user' as const, text: userMsg }]
          .map(message => ({ role: message.role, content: message.text })),
      });
      setAiMessages(prev => [...prev, {
        role: 'assistant',
        text: text || 'لم أتمكن من الحصول على إجابة. حاول مجدداً.',
      }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setAiMessages(prev => [...prev, { role: 'assistant', text: `⚠️ خطأ: ${msg}` }]);
    } finally {
      setAiLoading(false);
      setTimeout(() => { aiChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, 150);
    }
  };

  // ── Simple markdown rendering ─────────────────────────────────────────────
  const renderMsg = useCallback((text: string) => {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      // Bold: **text**
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      const formatted = parts.map((p, j) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={j} className="font-bold text-gray-900">{p.slice(2, -2)}</strong>
          : <span key={j}>{p}</span>
      );
      // Heading-like lines (━━━ or ##)
      if (line.startsWith('##') || line.startsWith('━')) {
        return <div key={i} className="text-xs font-bold text-gray-500 uppercase tracking-wide mt-3 mb-1 border-b border-gray-100 pb-0.5">{line.replace(/^#+\s*/, '').replace(/━+/g, '').trim()}</div>;
      }
      // Bullet-like: starts with ▸ or • or -
      if (/^[▸•\-]\s/.test(line)) {
        return <div key={i} className="flex gap-1.5 mt-0.5"><span className="text-primary-400 mt-0.5 shrink-0">▸</span><span>{formatted}</span></div>;
      }
      return <div key={i} className={line === '' ? 'h-2' : 'mt-0.5'}>{formatted}</div>;
    });
  }, []);

  // ── Categorized questions ─────────────────────────────────────────────────
  type QCategory = { label: string; icon: React.ElementType; color: string; q: string[] };
  const qCategories: QCategory[] = [
    {
      label: 'اليوم',
      icon: Zap,
      color: 'text-amber-600',
      q: [
        'النهاردة كام عميل محتمل دخل؟',
        'النهاردة دخل فلوس كام؟',
        'ملخص كامل لليوم',
        'مشتركون سجلوا النهاردة',
      ],
    },
    {
      label: 'فريق السيلز',
      icon: Users,
      color: 'text-emerald-600',
      q: [
        'حالة مسار السيلز النهاردة؟',
        'معدل التحويل الحالي؟',
        'وزّع العملاء المحتملين حسب الحالة',
        'كام عميل محتمل غير متابَع؟',
      ],
    },
    {
      label: 'الإيراد والفروع',
      icon: DollarSign,
      color: 'text-violet-600',
      q: [
        'إيراد الشهر ده كله',
        'مقارنة كل الفروع في الإيراد',
        'فرع الدقي الشهر ده دخل كام؟',
        'عدد وقيمة الدفعات اليدوية النهاردة',
      ],
    },
    {
      label: 'تحليلات',
      icon: TrendingUp,
      color: 'text-sky-600',
      q: [
        'معدل تحويل العملاء المحتملين؟',
        'أكثر الكورسات تسجيلاً؟',
        'مصادر العملاء الأكثر فاعلية',
        'ملخص الإيراد الحالي حسب الفروع',
      ],
    },
  ];
  const [activeQCat, setActiveQCat] = useState(0);

  // ── Copied message state ──────────────────────────────────────────────────
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const copyMsg = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  };

  // ── Expand/collapse long messages ─────────────────────────────────────────
  const [expandedMsgs, setExpandedMsgs] = useState<Set<number>>(new Set());
  const toggleExpand = (idx: number) => setExpandedMsgs(prev => { const s = new Set(prev); s.has(idx) ? s.delete(idx) : s.add(idx); return s; });
  const MSG_COLLAPSE_LINES = 18;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-primary-600 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Bot size={22} />
            </div>
            <div>
              <h2 className="text-xl font-extrabold flex items-center gap-2">
                <Sparkles size={18} className="text-amber-300" />
                AI المساعد الإداري
              </h2>
              <p className="text-white/75 text-xs">يعرف كل شيء في السيستم — سأله بالعربي العادي</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-[11px] bg-white/20 px-3 py-1 rounded-full font-bold">
              {adminAiDraft.provider === 'openai' ? `🤖 ${adminAiDraft.model||'gpt-4o-mini'}`
                : adminAiDraft.provider === 'claude' ? `🧠 ${adminAiDraft.model||'claude-3-haiku'}`
                : `✨ ${adminAiDraft.model||'gemini-2.0-flash-lite'}`}
            </div>
            {aiMessages.length > 0 && (
              <button onClick={() => setAiMessages([])} title="مسح المحادثة"
                className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center transition">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
        {/* Live stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'عملاء اليوم', value: _todayLeads.length, accent: 'bg-red-400/30', icon: '📥' },
            { label: 'مشتركون اليوم', value: _todaySubs.length, accent: 'bg-green-400/30', icon: '✅' },
            { label: 'إيراد اليوم', value: `${Math.round(_todayOnlineRev+_todayManualRev).toLocaleString()} ج`, accent: 'bg-yellow-400/30', icon: '💰' },
            { label: 'دفعات يدوية', value: _todayManual.length, accent: 'bg-blue-400/30', icon: '💳' },
          ].map(s => (
            <div key={s.label} className={`${s.accent} rounded-xl px-3 py-2 text-center backdrop-blur-sm`}>
              <div className="text-base font-extrabold leading-tight">{s.icon} {s.value}</div>
              <div className="text-[10px] text-white/80 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Categorized suggested questions */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {qCategories.map((cat, ci) => {
            const Icon = cat.icon;
            return (
              <button key={ci} onClick={() => setActiveQCat(ci)}
                className={`flex items-center gap-2 px-4 py-3 text-xs font-bold whitespace-nowrap flex-shrink-0 border-b-2 transition-all ${activeQCat === ci ? `border-primary-500 text-primary-700 bg-primary-50` : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
                <Icon size={13} className={activeQCat === ci ? 'text-primary-600' : cat.color} />
                {cat.label}
              </button>
            );
          })}
        </div>
        <div className="p-3 flex flex-wrap gap-2">
          {qCategories[activeQCat].q.map(q => (
            <button key={q} onClick={() => { setAiInput(q); }}
              className="text-xs bg-gray-50 text-gray-700 border border-gray-200 px-3 py-2 rounded-xl hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 transition font-medium">
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Window */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col" style={{ minHeight: '480px' }}>
        <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[600px]">
          {aiMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-primary-100 flex items-center justify-center mb-4">
                <Bot size={32} className="text-primary-500 opacity-60" />
              </div>
              <p className="text-sm font-semibold text-gray-600">ابدأ المحادثة</p>
              <p className="text-xs text-gray-400 mt-1">اختر سؤالاً من الأعلى أو اكتب سؤالك</p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center max-w-md">
                {['ملخص اليوم', 'إيراد الشهر', 'أداء السيلز'].map(q => (
                  <button key={q} onClick={() => setAiInput(q)}
                    className="text-xs bg-primary-50 text-primary-700 border border-primary-200 px-3 py-1.5 rounded-full hover:bg-primary-100 transition">{q}</button>
                ))}
              </div>
            </div>
          )}
          {aiMessages.map((msg, i) => {
            const isUser = msg.role === 'user';
            const msgLines = msg.text.split('\n').length;
            const isLong = msgLines > MSG_COLLAPSE_LINES;
            const isExpanded = expandedMsgs.has(i);
            return (
              <div key={i} className={`flex items-start gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-primary-600 flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
                    <Bot size={15} className="text-white" />
                  </div>
                )}
                <div className={`relative group ${isUser ? 'max-w-[75%]' : 'max-w-[85%]'}`}>
                  <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    isUser
                      ? 'bg-primary-600 text-white rounded-tr-sm'
                      : 'bg-gray-50 border border-gray-200 text-gray-800 rounded-tl-sm'
                  } ${isLong && !isExpanded ? 'overflow-hidden' : ''}`} style={isLong && !isExpanded ? { maxHeight: '320px' } : {}}>
                    {isUser
                      ? <span className="whitespace-pre-wrap">{msg.text}</span>
                      : <div className="whitespace-pre-wrap">{renderMsg(msg.text)}</div>
                    }
                  </div>
                  {/* Controls */}
                  <div className={`flex items-center gap-1 mt-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
                    {isLong && (
                      <button onClick={() => toggleExpand(i)}
                        className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 transition">
                        {isExpanded ? <><ChevronUp size={10} /> تصغير</> : <><ChevronDown size={10} /> عرض الكل</>}
                      </button>
                    )}
                    {!isUser && (
                      <button onClick={() => copyMsg(msg.text, i)}
                        className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 transition">
                        {copiedIdx === i ? <><Check size={10} className="text-emerald-500" /> تم النسخ</> : <><Copy size={10} /> نسخ</>}
                      </button>
                    )}
                    <button onClick={() => setAiMessages(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-[10px] text-gray-300 hover:text-red-500 px-1.5 py-0.5 transition opacity-0 group-hover:opacity-100">✕</button>
                  </div>
                </div>
                {isUser && (
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-1">
                    <Users size={14} className="text-gray-600" />
                  </div>
                )}
              </div>
            );
          })}
          {aiLoading && (
            <div className="flex justify-start items-start gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-primary-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                <Bot size={15} className="text-white" />
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex gap-1 items-center h-5">
                  <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={aiChatEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-100 p-4 bg-gray-50/80">
          {aiMessages.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {qCategories[activeQCat].q.slice(0, 4).map(q => (
                <button key={q} onClick={() => setAiInput(q)}
                  className="text-[11px] bg-white border border-gray-200 text-gray-600 px-2.5 py-1 rounded-lg hover:border-primary-400 hover:text-primary-700 transition">{q}</button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={aiInput}
              onChange={e => setAiInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiSend(); } }}
              placeholder='اكتب سؤالك بالعربي... "النهاردة دخل فلوس كام؟"'
              className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none bg-white shadow-sm"
              disabled={aiLoading}
            />
            <button
              onClick={handleAiSend}
              disabled={aiLoading || !aiInput.trim()}
              className="bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white px-5 py-2.5 rounded-xl transition flex items-center gap-2 font-bold text-sm shadow-sm"
            >
              {aiLoading ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
              {aiLoading ? 'جارٍ...' : 'إرسال'}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1">
            <AlertCircle size={10} />
            AI يرى كل بيانات السيستم مباشرة ولحظياً — اسأل بالعربي العادي
          </p>
        </div>
      </div>
    </div>
  );
}
