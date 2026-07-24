import { Zap, UserPlus, CheckCircle, Clock, Smartphone, RefreshCw, Star, ChevronRight } from 'lucide-react';

interface Props {
  automationToggles: Record<string, boolean>;
  toggleAutomation: (key: string) => void;
}

const WORKFLOWS = [
  {
    key: 'welcome_lead',
    icon: UserPlus,
    title: 'ترحيب بالليد الجديد',
    desc: 'رسالة ترحيب تلقائية عند إضافة ليد جديد للنظام',
    trigger: 'عند إضافة ليد',
    action: 'إرسال رسالة واتساب / بريد',
    color: 'bg-blue-100 text-blue-700',
  },
  {
    key: 'converted_msg',
    icon: CheckCircle,
    title: 'رسالة التحويل الناجح',
    desc: 'تأكيد التسجيل + ترحيب عند تحويل الليد لمشترك',
    trigger: 'عند تغيير الحالة إلى محوّل',
    action: 'رسالة شكر + تفاصيل الاشتراك',
    color: 'bg-green-100 text-green-700',
  },
  {
    key: 'followup_reminder',
    icon: Clock,
    title: 'تذكيرات المتابعة للسيلز',
    desc: 'تذكير تلقائي للمبيعات بالليدات التي لم تُتابَع',
    trigger: 'بعد 24 ساعة من آخر تواصل',
    action: 'تنبيه للموظف المعيّن',
    color: 'bg-orange-100 text-orange-700',
  },
  {
    key: 'sms_drip',
    icon: Smartphone,
    title: 'تسلسل SMS التذكيري',
    desc: 'سلسلة رسائل SMS مجدولة للليدات غير المتحولة',
    trigger: 'بعد 3 أيام من الإضافة',
    action: 'إرسال 3 رسائل SMS خلال أسبوع',
    color: 'bg-teal-100 text-teal-700',
  },
  {
    key: 'cart_recovery',
    icon: RefreshCw,
    title: 'استرداد الطلبات المتروكة',
    desc: 'تذكير العملاء الذين بدأوا الدفع ولم يكملوا',
    trigger: 'بعد ساعة من توقف الدفع',
    action: 'رسالة استرداد + كوبون خصم',
    color: 'bg-amber-100 text-amber-700',
  },
  {
    key: 'review_request',
    icon: Star,
    title: 'طلب التقييم التلقائي',
    desc: 'طلب تقييم من العملاء بعد انتهاء الكورس',
    trigger: 'بعد 7 أيام من انتهاء الكورس',
    action: 'إرسال رابط التقييم',
    color: 'bg-yellow-100 text-yellow-700',
  },
];

export function AutomationSection({ automationToggles, toggleAutomation }: Props) {
  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="bg-gradient-to-l from-purple-700 to-indigo-600 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
            <Zap size={24} />
          </div>
          <div>
            <h3 className="font-bold text-lg">مركز الأتوميشن التسويقي</h3>
            <p className="text-purple-200 text-sm mt-0.5">
              {Object.values(automationToggles).filter(Boolean).length} مهمة نشطة من {Object.keys(automationToggles).length}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
          <div className="bg-white/15 rounded-xl p-3 text-center">
            <div className="text-2xl font-black">{Object.values(automationToggles).filter(Boolean).length}</div>
            <div className="text-xs text-purple-200">نشط</div>
          </div>
          <div className="bg-white/15 rounded-xl p-3 text-center">
            <div className="text-2xl font-black">{Object.values(automationToggles).filter(v => !v).length}</div>
            <div className="text-xs text-purple-200">متوقف</div>
          </div>
          <div className="bg-white/15 rounded-xl p-3 text-center">
            <div className="text-2xl font-black">{Object.keys(automationToggles).length}</div>
            <div className="text-xs text-purple-200">إجمالي</div>
          </div>
        </div>
      </div>

      {/* Automation workflows */}
      <div className="space-y-3">
        {WORKFLOWS.map(wf => {
          const isActive = automationToggles[wf.key];
          return (
            <div key={wf.key} className={`bg-white border rounded-2xl shadow-sm p-4 transition-all ${isActive ? 'border-gray-200' : 'border-gray-100 opacity-75'}`}>
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl ${wf.color} flex items-center justify-center shrink-0`}>
                  <wf.icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-bold text-gray-800">{wf.title}</h4>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {isActive ? '● نشط' : '○ متوقف'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mb-2">{wf.desc}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><Zap size={10} className="text-amber-500" /> <strong>تشغيل:</strong> {wf.trigger}</span>
                    <span className="flex items-center gap-1"><ChevronRight size={10} /> <strong>إجراء:</strong> {wf.action}</span>
                  </div>
                </div>
                <button onClick={() => toggleAutomation(wf.key)}
                  className={`shrink-0 w-12 h-6 rounded-full transition-all relative ${isActive ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${isActive ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-gray-400 text-center p-3 bg-gray-50 rounded-xl">
        ⚠️ الأتوميشن حالياً في وضع العرض — التفعيل الفعلي يتطلب ربط خدمات الرسائل
      </div>
    </div>
  );
}
