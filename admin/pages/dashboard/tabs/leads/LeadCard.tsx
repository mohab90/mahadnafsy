import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertCircle, Archive, Award, BarChart2, Bell, BookOpen, CalendarPlus, CheckCheck, CheckCircle,
  ChevronDown, Clock, Columns, CreditCard, Download, ExternalLink, EyeOff, Eye,
  FolderKanban, Globe, Inbox, Link2, MapPin, MessageCircle, MessageSquare, MessageSquareText,
  Phone, Plus, RefreshCw, Search, Settings, Share2, Star, Tag, Trash2, TrendingUp,
  Upload, UserPlus, Users, Wallet, X,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { useSiteData } from '../../../../context/SiteDataContext';
import { useBranches } from '../../../../hooks/useBranches';
import { mysqlAdmin, mysqlClient } from '../../../../lib/mysqlapi';
import { useResizableCols } from '../../../../components/useResizableCols';
import type {
  LeadItem, LeadStatus, CommunicationRecord, SalesTarget, Course, Bundle,
  BranchType, FacebookLeadAdsConfig, PaymentHistoryEntry, PaymentItemType,
  SubscriberItem, StaffMember, AccessMode, CourseAccessSetting,
} from '../../../../types';
import { CrmSettingsModal, DEFAULT_CRM_SETTINGS } from '../CrmSettingsModal';
import PaymentModal, { PaymentDraft, blankPaymentDraft } from '../../../../components/PaymentModal';
import type { CrmSettings, NotifyFn } from '../CrmSettingsModal';
import { DEFAULT_SOURCES, ONLINE_EXCLUDED_SOURCES, isOnlineSource, EMPTY_LEAD_DRAFT } from '../crmConstants';
import { LeadTable } from '../LeadTable';
import {
  BRANCH_ENUM_LABELS,
  COMM_ICON,
  COMM_LABEL,
  IL_LABEL,
  PIE_COLORS,
  PIPELINE_COLS,
  PRESET_TAGS,
  ROTTEN_CFG,
  STATUS_CFG,
  calcLeadScore,
  getLeadBranchRaw,
  getRottenLevel,
  // getScoreBreakdown intentionally NOT imported — this file defines a richer local version
} from '../leadUtils';


import { ScoreBadge } from './leadShared';

export function LeadCard({ lead, score, onSelect, onStatusChange, onBook, onContact, instituteBranches, courses, bundles }: {
  lead: LeadItem;
  score: number;
  onSelect: () => void;
  onStatusChange: (status: LeadStatus) => void;
  onBook?: (lead: LeadItem) => void;
  onContact?: (lead: LeadItem) => void;
  instituteBranches: { id: string; label: string }[];
  courses: Course[];
  bundles: Bundle[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = !!(lead.nextFollowUpDate && lead.nextFollowUpDate < today);
  const daysOverdue = isOverdue
    ? Math.floor((Date.now() - new Date(lead.nextFollowUpDate!).getTime()) / 86_400_000)
    : 0;
  const lastComm = (lead.communications && lead.communications.length > 0)
    ? [...lead.communications].sort((a, b) => b.date.localeCompare(a.date))[0]
    : null;
  const waPhone = `https://wa.me/2${(lead.phone || '').replace(/^0/, '')}`;

  const rotLevel = getRottenLevel(lead);
  const rotCfg = ROTTEN_CFG[rotLevel];

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition cursor-pointer group overflow-hidden"
      onClick={onSelect}
      dir="rtl"
    >
      {/* Rotting decay strip at top */}
      {rotLevel > 0 && <div className={`h-1.5 w-full ${rotCfg.bar} rounded-t-xl`} />}
      <div className="p-3">
      {/* Name + Score */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="font-bold text-gray-900 text-sm leading-tight flex-1 min-w-0 truncate">{lead.name}</p>
        <div className="flex items-center gap-1 flex-shrink-0">
          {rotLevel > 0 && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${rotCfg.badge}`}>{rotCfg.label}</span>
          )}
          <ScoreBadge score={score} />
        </div>
      </div>

      {/* Phone */}
      <p className="text-xs text-gray-500 mb-1.5 font-mono" dir="ltr">{lead.phone}</p>

      {/* Sales + Branch + Interest row */}
      <div className="flex flex-wrap gap-1 mb-1.5">
        {lead.assignedSalesName && (
          <span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full">
            <span className="w-3 h-3 bg-blue-200 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0">
              {lead.assignedSalesName.charAt(0)}
            </span>
            <span className="truncate max-w-[64px]">{lead.assignedSalesName}</span>
          </span>
        )}
        {getLeadBranchRaw(lead) && (
          <span className="inline-flex items-center text-[10px] bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded-full">
            {(() => {
              const bn = (lead.branch || '').toUpperCase().replace(/[-\s]/g, '_');
              return instituteBranches.find(b => b.id.toUpperCase().replace(/[-\s]/g, '_') === bn)?.label
                || BRANCH_ENUM_LABELS[bn]
                || getLeadBranchRaw(lead);
            })()}
          </span>
        )}
        {lead.interestLevel && (
          <span className="text-[10px] text-gray-500">{IL_LABEL[lead.interestLevel]}</span>
        )}
      </div>

      {/* Interested courses */}
      {(lead.interestedCourseIds?.length || 0) > 0 && (
        <div className="flex flex-wrap gap-0.5 mb-1.5">
          {(lead.interestedCourseIds || []).slice(0, 2).map(id => {
            const resolvedId = id.startsWith('bundle:') ? id.replace('bundle:', '') : id;
            const cTitle = courses.find(c => c.id === id)?.title
              || bundles.find(b => b.id === resolvedId)?.title
              || bundles.find(b => b.id === id)?.title;
            if (!cTitle) return null;
            return (
              <span key={id} className="inline-flex items-center text-[9px] bg-primary-50 text-primary-700 border border-primary-200 px-1.5 py-0.5 rounded-full">
                🎓 {cTitle.length > 16 ? cTitle.slice(0, 16) + '…' : cTitle}
              </span>
            );
          })}
          {(lead.interestedCourseIds?.length || 0) > 2 && (
            <span className="text-[9px] text-gray-400">+{(lead.interestedCourseIds!.length) - 2}</span>
          )}
        </div>
      )}

      {/* Follow-up reminder */}
      {lead.nextFollowUpDate && (
        <div className={`inline-flex items-center gap-1 text-[10px] rounded-lg px-2 py-0.5 mb-1.5 ${
          isOverdue ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
        }`}>
          <Clock size={9} />
          {isOverdue ? `متأخر ${daysOverdue} يوم` : `متابعة: ${lead.nextFollowUpDate}`}
        </div>
      )}

      {/* Last communication block */}
      {lastComm ? (
        <div className="bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 mb-1.5">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[11px]">{COMM_ICON[lastComm.type] || '📋'}</span>
            <span className="text-[10px] font-bold text-gray-700">{COMM_LABEL[lastComm.type] || lastComm.type}</span>
            <span className="mr-auto text-[9px] text-gray-400" dir="ltr">{lastComm.date?.slice(0, 10)}</span>
          </div>
          {lastComm.notes && (
            <p className="text-[10px] text-gray-600 leading-tight line-clamp-2">{lastComm.notes}</p>
          )}
          {lastComm.outcome && (
            <p className="text-[10px] text-emerald-600 mt-0.5">↩ {lastComm.outcome}</p>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-gray-300 italic mb-1.5">لا يوجد تواصل مسجل</p>
      )}

      {/* Tags */}
      {(lead.tags?.length || 0) > 0 && (
        <div className="flex flex-wrap gap-0.5 mb-1.5">
          {(lead.tags || []).slice(0, 3).map(tag => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-bold">{tag}</span>
          ))}
          {(lead.tags?.length || 0) > 3 && <span className="text-[9px] text-gray-400">+{(lead.tags?.length || 0) - 3}</span>}
        </div>
      )}

      {/* Meta row: comms count + source + date */}
      <div className="flex items-center gap-1.5 mb-2 text-[9px] text-gray-400">
        {(lead.communications?.length || 0) > 0 && (
          <span className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">
            {lead.communications!.length} تواصل
          </span>
        )}
        {lead.source && (
          <span className="bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded-full">{lead.source}</span>
        )}
        {lead.createdAt && (
          <span className="mr-auto">
            {new Date(lead.createdAt).toLocaleDateString('ar-EG-u-nu-latn', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-1" onClick={e => e.stopPropagation()}>
        <select
          value={lead.status}
          onChange={e => onStatusChange(e.target.value as LeadStatus)}
          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 bg-gray-50">
          {(Object.keys(STATUS_CFG) as LeadStatus[]).filter(s => s !== 'converted').map(s => (
            <option key={s} value={s}>{STATUS_CFG[s].label}</option>
          ))}
        </select>
        <div className="grid grid-cols-4 gap-0.5">
          <a href={waPhone} target="_blank" rel="noreferrer" title="واتساب"
            className="h-7 rounded-lg bg-gray-50 text-gray-400 hover:bg-green-50 hover:text-green-600 flex items-center justify-center transition">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
          </a>
          <button
            onClick={e => { e.stopPropagation(); if (onContact) onContact(lead); else window.location.href = `tel:${lead.phone}`; }}
            title="تسجيل اتصال"
            className="h-7 rounded-lg bg-gray-50 text-gray-400 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition">
            <Phone size={13}/>
          </button>
          <button onClick={onSelect} title="تعديل / تفاصيل"
            className="h-7 rounded-lg bg-gray-50 text-gray-500 hover:bg-primary-50 hover:text-primary-600 flex items-center justify-center transition">
            <ExternalLink size={11}/>
          </button>
          {onBook && (
            <button onClick={() => onBook(lead)} title="حجز ودفع"
              className="h-7 rounded-lg bg-gray-50 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600 flex items-center justify-center transition">
              <Wallet size={11}/>
            </button>
          )}
        </div>
      </div>
      </div>{/* end p-3 */}
    </div>
  );
}

// ── Multi-select dropdown ────────────────────────────────────────────────────
