import React from 'react';
import { Shield } from 'lucide-react';

export function StaffPermissionsLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 via-white to-primary-50/30 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-500 text-sm">جارٍ تحميل صلاحياتك...</p>
      </div>
    </div>
  );
}

export function AdminBootstrapLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 via-white to-primary-50/30 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-14 h-14 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto" />
        <p className="text-gray-800 font-bold text-lg">جارٍ تحميل لوحة التحكم...</p>
        <p className="text-gray-400 text-sm">جارٍ تحميل بيانات CRM والمشتركين</p>
      </div>
    </div>
  );
}

export function AccessDenied() {
  return (
    <div className="bg-white border border-red-200 rounded-2xl p-12 text-center">
      <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Shield size={28} className="text-red-500" />
      </div>
      <h3 className="text-lg font-bold text-gray-900 mb-2">غير مصرح بالوصول</h3>
      <p className="text-gray-500 text-sm">ليس لديك صلاحية الوصول لهذا القسم. تواصل مع المدير لطلب الصلاحية.</p>
    </div>
  );
}
