import React from 'react';
import { User, Camera, Save, Lock, Eye, EyeOff, AlertCircle, LogOut } from 'lucide-react';

interface SettingsTabProps {
  authUser: any;
  subscriber: any;
  displayName: string;
  avatarDataUrl: string;
  avatarBg: string;
  avatarInputRef: React.RefObject<HTMLInputElement | null>;
  editingName: boolean;
  newName: string;
  setEditingName: (v: boolean) => void;
  setNewName: (v: string) => void;
  handleSaveName: () => void;
  nameSaving: boolean;
  nameMsg: string;
  newNameEn: string;
  setNewNameEn: (v: string) => void;
  handleSaveNameEn: () => void;
  nameEnMsg: string;
  pwCurrent: string;
  setPwCurrent: (v: string) => void;
  pwNew: string;
  setPwNew: (v: string) => void;
  pwConfirm: string;
  setPwConfirm: (v: string) => void;
  showPw: boolean;
  setShowPw: React.Dispatch<React.SetStateAction<boolean>>;
  pwMsg: string;
  pwSaving: boolean;
  handleChangePassword: () => void;
  handleLogout: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  authUser,
  subscriber,
  displayName,
  avatarDataUrl,
  avatarBg,
  avatarInputRef,
  editingName,
  newName,
  setEditingName,
  setNewName,
  handleSaveName,
  nameSaving,
  nameMsg,
  newNameEn,
  setNewNameEn,
  handleSaveNameEn,
  nameEnMsg,
  pwCurrent,
  setPwCurrent,
  pwNew,
  setPwNew,
  pwConfirm,
  setPwConfirm,
  showPw,
  setShowPw,
  pwMsg,
  pwSaving,
  handleChangePassword,
  handleLogout,
}) => {
  return (
    <div className="max-w-xl space-y-6">
      {/* Profile card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-5">
        <h3 className="font-extrabold text-gray-900 flex items-center gap-2 text-base">
          <User size={16} /> معلوماتي الشخصية
        </h3>

        {/* Avatar big */}
        <div className="flex items-center gap-4">
          <div className={`w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-2xl font-extrabold text-white flex-shrink-0 ${!avatarDataUrl ? avatarBg : ''}`}>
            {avatarDataUrl
              ? <img loading="lazy" decoding="async" src={avatarDataUrl} alt="avatar" className="w-full h-full object-cover" />
              : displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <button
              onClick={() => avatarInputRef.current?.click()}
              className="flex items-center gap-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-bold transition"
            >
              <Camera size={15} /> تغيير الصورة
            </button>
            <p className="text-xs text-gray-400 mt-1">JPG, PNG — يُحفظ على هذا الجهاز</p>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">الاسم الرباعي بالعربية <span className="text-gray-400 font-normal">(يظهر على الشهادة)</span></label>
          <div className="flex gap-2">
            <input
              value={editingName ? newName : displayName}
              onChange={e => { setEditingName(true); setNewName(e.target.value); }}
              placeholder="مثال: أحمد محمد علي حسن"
              className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
            />
            <button
              onClick={handleSaveName}
              disabled={nameSaving}
              className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-1 transition disabled:opacity-60"
            >
              <Save size={14} /> حفظ
            </button>
          </div>
          {nameMsg && <p className="text-green-600 text-xs mt-1">{nameMsg}</p>}
        </div>

        {/* English name for certificate */}
        <div>
          <label className="block text-xs font-bold text-amber-700 mb-1">
            الاسم الرباعي بالإنجليزية — <span className="font-normal text-amber-600">يظهر على الشهادة</span>
          </label>
          <div className="flex gap-2">
            <input
              dir="ltr"
              value={newNameEn}
              onChange={e => setNewNameEn(e.target.value)}
              placeholder="Full Name as on Certificate"
              className="flex-1 border border-amber-300 bg-amber-50 rounded-xl px-4 py-2.5 text-sm focus:border-amber-500 focus:outline-none ltr"
            />
            <button
              onClick={handleSaveNameEn}
              className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-1 transition"
            >
              <Save size={14} /> Save
            </button>
          </div>
          {nameEnMsg && <p className="text-amber-700 text-xs mt-1">{nameEnMsg}</p>}
        </div>

        {/* Email readonly */}
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">البريد الإلكتروني</label>
          <input
            value={authUser?.email || ''}
            readOnly
            className="w-full border border-gray-200 bg-gray-50 rounded-xl px-4 py-2.5 text-sm text-gray-500 cursor-not-allowed"
          />
        </div>

        {/* Client code / stable URL */}
        {subscriber?.clientCode && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
            <p className="text-xs font-bold text-indigo-700 mb-1">🔗 رابطك الشخصي الدائم</p>
            <p className="text-[11px] text-indigo-600 font-mono break-all">{window.location.origin}/#/client/{subscriber.clientCode}</p>
            <p className="text-[10px] text-indigo-400 mt-1">هذا الرابط ثابت ويمكنك مشاركته مع فريق الدعم</p>
          </div>
        )}
      </div>

      {/* Password card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-4">
        <h3 className="font-extrabold text-gray-900 flex items-center gap-2 text-base">
          <Lock size={16} /> تغيير كلمة المرور
        </h3>

        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">كلمة المرور الحالية</label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={pwCurrent}
              onChange={e => setPwCurrent(e.target.value)}
              placeholder="أدخل كلمة المرور الحالية"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm pr-10 focus:border-primary-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPw(p => !p)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">كلمة المرور الجديدة</label>
          <input
            type={showPw ? 'text' : 'password'}
            value={pwNew}
            onChange={e => setPwNew(e.target.value)}
            placeholder="6 أحرف على الأقل"
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">تأكيد كلمة المرور</label>
          <input
            type={showPw ? 'text' : 'password'}
            value={pwConfirm}
            onChange={e => setPwConfirm(e.target.value)}
            placeholder="أعد كتابة كلمة المرور الجديدة"
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
          />
        </div>

        {pwMsg && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${pwMsg.includes('نجاح') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            <AlertCircle size={14} /> {pwMsg}
          </div>
        )}

        <button
          onClick={handleChangePassword}
          disabled={pwSaving || !pwCurrent || !pwNew || !pwConfirm}
          className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {pwSaving
            ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            : <Save size={16} />}
          حفظ كلمة المرور
        </button>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 border-2 border-red-200 text-red-600 hover:bg-red-50 font-bold py-3 rounded-2xl transition"
      >
        <LogOut size={16} /> تسجيل الخروج
      </button>

    </div>
  );
};
