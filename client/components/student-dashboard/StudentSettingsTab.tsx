import React from 'react';
import { AlertCircle, Camera, Eye, EyeOff, Lock, LogOut, Save, User } from 'lucide-react';
import type { AuthUser, SubscriberItem } from '../../types';

interface StudentSettingsTabProps {
  displayName: string;
  avatarDataUrl: string;
  avatarBg: string;
  avatarInputRef: React.RefObject<HTMLInputElement | null>;
  editingName: boolean;
  newName: string;
  setEditingName: React.Dispatch<React.SetStateAction<boolean>>;
  setNewName: React.Dispatch<React.SetStateAction<string>>;
  onSaveName: () => void;
  nameSaving: boolean;
  nameMsg: string;
  newNameEn: string;
  setNewNameEn: React.Dispatch<React.SetStateAction<string>>;
  onSaveNameEn: () => void;
  nameEnMsg: string;
  authUser: AuthUser | null;
  subscriber?: SubscriberItem;
  showPw: boolean;
  setShowPw: React.Dispatch<React.SetStateAction<boolean>>;
  pwCurrent: string;
  setPwCurrent: React.Dispatch<React.SetStateAction<string>>;
  pwNew: string;
  setPwNew: React.Dispatch<React.SetStateAction<string>>;
  pwConfirm: string;
  setPwConfirm: React.Dispatch<React.SetStateAction<string>>;
  pwMsg: string;
  pwSaving: boolean;
  onChangePassword: () => void;
  onLogout: () => void;
}

export const StudentSettingsTab: React.FC<StudentSettingsTabProps> = ({
  displayName,
  avatarDataUrl,
  avatarBg,
  avatarInputRef,
  editingName,
  newName,
  setEditingName,
  setNewName,
  onSaveName,
  nameSaving,
  nameMsg,
  newNameEn,
  setNewNameEn,
  onSaveNameEn,
  nameEnMsg,
  authUser,
  subscriber,
  showPw,
  setShowPw,
  pwCurrent,
  setPwCurrent,
  pwNew,
  setPwNew,
  pwConfirm,
  setPwConfirm,
  pwMsg,
  pwSaving,
  onChangePassword,
  onLogout,
}) => (
  <div className="max-w-xl space-y-6">
    <div className="rounded-2xl border border-white/50 bg-white/70 p-6 shadow-xl shadow-gray-200/50 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary-500/20">
      <h3 className="mb-5 flex items-center gap-2 text-base font-extrabold text-gray-900">
        <User size={16} /> معلوماتي الشخصية
      </h3>

      <div className="mb-5 flex items-center gap-4">
        <div className={`flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl font-extrabold text-white ${!avatarDataUrl ? avatarBg : ''}`}>
          {avatarDataUrl ? <img src={avatarDataUrl} alt="avatar" className="h-full w-full object-cover" /> : displayName.charAt(0).toUpperCase()}
        </div>
        <div>
          <button
            onClick={() => avatarInputRef.current?.click()}
            className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-200"
          >
            <Camera size={15} /> تغيير الصورة
          </button>
          <p className="mt-1 text-xs text-gray-400">JPG, PNG - يتم الحفظ على هذا الجهاز</p>
        </div>
      </div>

      <div className="mb-5">
        <label className="mb-1 block text-xs font-bold text-gray-600">
          الاسم الرباعي بالعربية <span className="font-normal text-gray-400">(يظهر على الشهادة)</span>
        </label>
        <div className="flex gap-2">
          <input
            value={editingName ? newName : displayName}
            onChange={(event) => {
              setEditingName(true);
              setNewName(event.target.value);
            }}
            placeholder="مثال: أحمد محمد علي حسن"
            className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
          />
          <button
            onClick={onSaveName}
            disabled={nameSaving}
            className="flex items-center gap-1 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary-700 disabled:opacity-60"
          >
            <Save size={14} /> حفظ
          </button>
        </div>
        {nameMsg && <p className="mt-1 text-xs text-green-600">{nameMsg}</p>}
      </div>

      <div className="mb-5">
        <label className="mb-1 block text-xs font-bold text-amber-700">
          الاسم الرباعي بالإنجليزية - <span className="font-normal text-amber-600">يظهر على الشهادة</span>
        </label>
        <div className="flex gap-2">
          <input
            dir="ltr"
            value={newNameEn}
            onChange={(event) => setNewNameEn(event.target.value)}
            placeholder="Full Name as on Certificate"
            className="flex-1 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm focus:border-amber-500 focus:outline-none"
          />
          <button onClick={onSaveNameEn} className="flex items-center gap-1 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-700">
            <Save size={14} /> حفظ
          </button>
        </div>
        {nameEnMsg && <p className="mt-1 text-xs text-amber-700">{nameEnMsg}</p>}
      </div>

      <div className="mb-5">
        <label className="mb-1 block text-xs font-bold text-gray-600">البريد الإلكتروني</label>
        <input value={authUser?.email || ''} readOnly className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-500" />
      </div>

      {subscriber?.clientCode && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
          <p className="mb-1 text-xs font-bold text-indigo-700">رابطك الشخصي الدائم</p>
          <p className="break-all font-mono text-[11px] text-indigo-600">{window.location.origin}/#/client/{subscriber.clientCode}</p>
          <p className="mt-1 text-[10px] text-indigo-400">هذا الرابط ثابت ويمكنك مشاركته مع فريق الدعم</p>
        </div>
      )}
    </div>

    <div className="space-y-4 rounded-2xl border border-white/50 bg-white/70 p-6 shadow-xl shadow-gray-200/50 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary-500/20">
      <h3 className="flex items-center gap-2 text-base font-extrabold text-gray-900">
        <Lock size={16} /> تغيير كلمة المرور
      </h3>

      <PasswordInput label="كلمة المرور الحالية" value={pwCurrent} onChange={setPwCurrent} showPw={showPw} setShowPw={setShowPw} canToggle />
      <PasswordInput label="كلمة المرور الجديدة" value={pwNew} onChange={setPwNew} showPw={showPw} placeholder="6 أحرف على الأقل" />
      <PasswordInput label="تأكيد كلمة المرور" value={pwConfirm} onChange={setPwConfirm} showPw={showPw} placeholder="أعد كتابة كلمة المرور الجديدة" />

      {pwMsg && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${pwMsg.includes('نجاح') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          <AlertCircle size={14} /> {pwMsg}
        </div>
      )}

      <button
        onClick={onChangePassword}
        disabled={pwSaving || !pwCurrent || !pwNew || !pwConfirm}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 font-bold text-white transition hover:bg-primary-700 disabled:opacity-50"
      >
        {pwSaving ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Save size={16} />}
        حفظ كلمة المرور
      </button>
    </div>

    <button
      onClick={onLogout}
      className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-red-200 py-3 font-bold text-red-600 transition hover:bg-red-50"
    >
      <LogOut size={16} /> تسجيل الخروج
    </button>
  </div>
);

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  showPw: boolean;
  setShowPw?: React.Dispatch<React.SetStateAction<boolean>>;
  canToggle?: boolean;
  placeholder?: string;
}

const PasswordInput: React.FC<PasswordInputProps> = ({ label, value, onChange, showPw, setShowPw, canToggle = false, placeholder }) => (
  <div>
    <label className="mb-1 block text-xs font-bold text-gray-600">{label}</label>
    <div className="relative">
      <input
        type={showPw ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || label}
        className={`w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none ${canToggle ? 'pr-10' : ''}`}
      />
      {canToggle && setShowPw && (
        <button type="button" onClick={() => setShowPw((value) => !value)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
          {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      )}
    </div>
  </div>
);
