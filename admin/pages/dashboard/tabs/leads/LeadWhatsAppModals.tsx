// The two WhatsApp send flows: a bulk blast, and one rep’s own list.
//
// Moved out of LeadSubcomponents.tsx, which had grown to 1,277 lines across
// seventeen unrelated exports. It still re-exports this, so the ten files that
// import from it are untouched.

import React, { useEffect, useState } from 'react';
import { Modal } from '../../../../../shared/ui/Modal';
import { Inbox, Link2, MessageSquare, X } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { LeadItem, LeadStatus, CommunicationRecord, Course, Bundle } from '../../../../types';
import type { NotifyFn } from '../CrmSettingsModal';
import { courseBadgeLabel, isRawCourse } from './leadCourseLabel';
import {
  BRANCH_ENUM_LABELS,
  COMM_ICON,
  COMM_LABEL,
  IL_LABEL,
  PRESET_TAGS,
  ROTTEN_CFG,
  STATUS_CFG,
  calcLeadScore,
  getLeadBranchRaw,
  getRottenLevel,
} from '../leadUtils';


export function BulkWhatsAppModal({ selectedLeads, onClose, notify }: {
  selectedLeads: LeadItem[];
  onClose: () => void;
  notify: NotifyFn;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const phones = selectedLeads.map(l => l.phone).filter(Boolean);
      const r = await mysqlAdmin.sendWhatsAppBulk(phones, message.trim());
      setResult({ sent: r.sent, failed: r.failed });
      notify('success', `تم إرسال ${r.sent} رسالة بنجاح`);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'فشل الإرسال');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`💬 إرسال واتساب جماعي (${selectedLeads.length} عميل)`}
      size="sm"
    >
        <div className="p-5 space-y-4">
          {result ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-2">✅</div>
              <p className="font-bold text-gray-900">تم الإرسال!</p>
              <p className="text-sm text-gray-500 mt-1">مُرسَل: {result.sent} · فشل: {result.failed}</p>
              <button onClick={onClose} className="mt-4 bg-primary-600 text-white px-6 py-2 rounded-xl font-bold">إغلاق</button>
            </div>
          ) : (
            <>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm text-gray-600 max-h-24 overflow-y-auto">
                {selectedLeads.slice(0, 5).map(l => (
                  <span key={l.id} className="inline-block bg-white border border-gray-200 rounded-full px-2 py-0.5 text-xs mr-1 mb-1">{l.name} ({l.phone})</span>
                ))}
                {selectedLeads.length > 5 && <span className="text-xs text-gray-400">+{selectedLeads.length - 5} آخرين</span>}
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">نص الرسالة *</label>
                <textarea value={message} onChange={e => setMessage(e.target.value)}
                  rows={5} placeholder="اكتب الرسالة هنا..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" />
                <p className="text-xs text-gray-400 mt-1">{message.length} حرف</p>
              </div>
              <div className="flex gap-3">
                <button onClick={handleSend} disabled={sending || !message.trim()}
                  className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-60 flex items-center justify-center gap-2">
                  {sending ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : '💬'}
                  {sending ? 'جاري الإرسال...' : 'إرسال'}
                </button>
                <button onClick={onClose} className="px-4 bg-gray-100 text-gray-700 rounded-xl">إلغاء</button>
              </div>
            </>
          )}
        </div>
    </Modal>
  );
}

// ── WhatsApp Per-Rep Modal ───────────────────────────────────────────────────

export function WhatsAppRepModal({ rep, leads, onClose, notify }: {
  rep: { id: string; name: string };
  leads: LeadItem[];
  onClose: () => void;
  notify: NotifyFn;
}) {
  const [view, setView] = useState<'setup' | 'inbox' | 'send'>('setup');
  const [chats, setChats] = useState<Array<{ id: string; name?: string; lastMessage?: { textMessage?: string } }>>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ type: string; textMessage?: string; timestamp?: number }>>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [sendPhone, setSendPhone] = useState('');
  const [sendMsg, setSendMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    mysqlAdmin.getWhatsAppConfig()
      .then((cfg) => setSaved(cfg.provider === 'green-api' ? !!(cfg.instanceId && cfg.hasToken) : !!(cfg.metaPhoneId && cfg.hasMetaToken)))
      .catch(() => setSaved(false));
  }, []);

  const loadChats = async () => {
    if (!saved) { notify('error', 'يجب إعداد واتساب مركزيًا أولاً'); return; }
    setChatLoading(true);
    try {
      const data = await mysqlAdmin.waProxyChats();
      setChats(Array.isArray(data) ? (data as typeof chats).slice(0, 40) : []);
    } catch { notify('error', 'فشل — تأكد من صحة بيانات الاتصال'); }
    finally { setChatLoading(false); }
  };

  const loadHistory = async (chatId: string) => {
    setHistLoading(true);
    try {
      const data = await mysqlAdmin.waProxyChatHistory(chatId, 30);
      setHistory(Array.isArray(data) ? (data as typeof history) : []);
      setSelectedChatId(chatId);
    } catch { notify('error', 'فشل تحميل الرسائل'); }
    finally { setHistLoading(false); }
  };

  const handleSend = async () => {
    if (!sendPhone.trim() || !sendMsg.trim()) return;
    if (!saved) { notify('error', 'يجب إعداد واتساب مركزيًا أولاً'); return; }
    setSending(true);
    try {
      await mysqlAdmin.waProxySend(sendPhone.trim(), sendMsg.trim());
      notify('success', 'تم إرسال الرسالة بنجاح');
      setSendMsg('');
    } catch (e) { notify('error', e instanceof Error ? e.message : 'فشل الإرسال'); }
    finally { setSending(false); }
  };

  const VIEWS: Array<['setup' | 'inbox' | 'send', string, React.ElementType]> = [
    ['setup', 'الإعداد', Link2],
    ['inbox', 'البريد الوارد', Inbox],
    ['send', 'إرسال رسالة', MessageSquare],
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title="واتساب شخصي"
      subtitle="إرسال واستقبال الرسائل"
      icon={<div className="w-9 h-9 bg-emerald-100 rounded-full flex items-center justify-center"><MessageSquare size={18} className="text-emerald-600" /></div>}
      size="lg"
    >

        {/* Sub-tabs */}
        <div className="flex border-b border-gray-100 flex-shrink-0">
          {VIEWS.map(([v, lbl, Ic]) => (
            <button key={v}
              onClick={() => { setView(v); if (v === 'inbox' && chats.length === 0) loadChats(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-bold transition border-b-2 ${
                view === v ? 'border-emerald-500 text-emerald-700 bg-emerald-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              <Ic size={14} /> {lbl}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* SETUP */}
          {view === 'setup' && (
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs font-bold text-amber-800 mb-2">🔐 إعداد مركزي آمن</p>
                <p className="text-xs text-amber-700">بيانات الاتصال تُدار من إعدادات الأتمتة ولا تُحفظ داخل المتصفح أو حساب الموظف.</p>
              </div>
              <p className={`text-center text-xs px-3 py-2 rounded-xl border ${saved
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : 'text-red-700 bg-red-50 border-red-200'}`}>
                {saved ? '✅ بيانات الاتصال موجودة على السيرفر' : '❌ واتساب غير مُعدّ؛ أكمل الإعداد المركزي أولًا'}
              </p>
            </div>
          )}

          {/* INBOX */}
          {view === 'inbox' && (
            <div className="flex-1 flex overflow-hidden" style={{ minHeight: 0 }}>
              {/* Chats list */}
              <div className="w-64 flex-shrink-0 border-l border-gray-100 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                  <span className="text-xs font-bold text-gray-600">{chats.length} محادثة</span>
                  <button onClick={loadChats} className="text-xs text-primary-600 hover:text-primary-800 font-bold">تحديث</button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {chatLoading && <div className="flex justify-center py-10"><span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>}
                  {!chatLoading && chats.length === 0 && (
                    <div className="text-center py-10">
                      <Inbox size={28} className="text-gray-300 mx-auto mb-2" />
                      <p className="text-xs text-gray-400">لا توجد محادثات</p>
                      <button onClick={loadChats} className="mt-2 text-xs text-primary-600 font-bold">تحميل</button>
                    </div>
                  )}
                  {chats.map(chat => (
                    <button key={chat.id} onClick={() => loadHistory(chat.id)}
                      className={`w-full text-right px-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition ${
                        selectedChatId === chat.id ? 'bg-emerald-50 border-r-2 border-r-emerald-500' : ''
                      }`}>
                      <p className="text-xs font-bold text-gray-900 truncate">{chat.name || chat.id.replace('@c.us', '').replace('@g.us', ' (مجموعة)')}</p>
                      {chat.lastMessage?.textMessage && (
                        <p className="text-[10px] text-gray-400 truncate mt-0.5">{chat.lastMessage.textMessage}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              {/* Message history */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {!selectedChatId ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2">
                    <MessageSquare size={32} className="text-gray-200" />
                    <p className="text-sm text-gray-400">اختر محادثة من القائمة</p>
                  </div>
                ) : histLoading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
                    {history.length === 0 && <p className="text-center text-xs text-gray-400 py-10">لا توجد رسائل</p>}
                    {history.map((msg, i) => (
                      <div key={i} className={`flex ${msg.type === 'outgoing' ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-xs px-3 py-2 rounded-2xl text-xs shadow-sm ${
                          msg.type === 'outgoing' ? 'bg-emerald-500 text-white' : 'bg-white text-gray-800 border border-gray-200'
                        }`}>
                          <p className="leading-relaxed">{msg.textMessage || '[رسالة غير نصية]'}</p>
                          {msg.timestamp && (
                            <p className={`text-[10px] mt-1 ${msg.type === 'outgoing' ? 'text-emerald-100' : 'text-gray-400'}`}>
                              {new Date(msg.timestamp * 1000).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SEND */}
          {view === 'send' && (
            <div className="p-5 space-y-4 overflow-y-auto">
              {!saved && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 text-center font-bold">
                  ⚠️ قم بإعداد بيانات الاتصال في تبويب "الإعداد" أولاً
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">رقم الهاتف</label>
                <div className="flex gap-2">
                  <input value={sendPhone} onChange={e => setSendPhone(e.target.value)}
                    placeholder="01XXXXXXXXX" dir="ltr"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm" />
                  <select onChange={e => e.target.value && setSendPhone(e.target.value)}
                    className="border border-gray-200 rounded-xl px-2 py-2 text-xs bg-white">
                    <option value="">— اختر ليد</option>
                    {leads.filter(l => l.assignedSalesId === rep.id && l.phone).slice(0, 80).map(l => (
                      <option key={l.id} value={l.phone}>{l.name} ({l.phone})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">نص الرسالة</label>
                <textarea value={sendMsg} onChange={e => setSendMsg(e.target.value)}
                  rows={5} placeholder="اكتب رسالتك هنا..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" />
              </div>
              <button onClick={handleSend} disabled={sending || !sendPhone.trim() || !sendMsg.trim()}
                className="w-full bg-emerald-600 text-white py-2.5 rounded-xl font-bold hover:bg-emerald-700 transition disabled:opacity-60 flex items-center justify-center gap-2">
                {sending ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <MessageSquare size={16} />}
                {sending ? 'جارٍ الإرسال...' : 'إرسال عبر واتسابك الشخصي'}
              </button>
            </div>
          )}
        </div>
    </Modal>
  );
}

