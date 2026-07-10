import React from 'react';
import { CommunicationRecord } from '../../types';
import { commTypeMeta, ptLabels, branchLabels, statusLabels } from '../unifiedClient.constants';
import CommunicationsTab from '../unifiedClient/CommunicationsTab';
import CertificatesTab from '../unifiedClient/CertificatesTab';
import CoursesAccessTab from '../unifiedClient/CoursesAccessTab';
import ConsultationsTab from '../unifiedClient/ConsultationsTab';
import DaqqiRoundsTab from '../unifiedClient/DaqqiRoundsTab';
import InstallmentsTab from '../unifiedClient/InstallmentsTab';
import PaymentsTab from '../unifiedClient/PaymentsTab';
import EditClientTab from '../unifiedClient/EditClientTab';
import OverviewClientTab from '../unifiedClient/OverviewClientTab';

type Tab = 'overview' | 'communications' | 'payments' | 'courses' | 'certificates' | 'installments' | 'consultations' | 'daqqi' | 'edit';

interface Props {
  activeTab: Tab;
  isSub: boolean;
  overview: Omit<React.ComponentProps<typeof OverviewClientTab>, 'commTypeMeta'>;
  communications: Omit<React.ComponentProps<typeof CommunicationsTab>, 'allComms'> & { allComms: (CommunicationRecord & { _src?: string })[] };
  payments: Omit<React.ComponentProps<typeof PaymentsTab>, 'ptLabels'>;
  courses: React.ComponentProps<typeof CoursesAccessTab>;
  certificates: React.ComponentProps<typeof CertificatesTab>;
  installments: React.ComponentProps<typeof InstallmentsTab>;
  consultations: React.ComponentProps<typeof ConsultationsTab>;
  daqqi: React.ComponentProps<typeof DaqqiRoundsTab>;
  edit: Omit<React.ComponentProps<typeof EditClientTab>, 'branchLabels' | 'statusLabels'>;
  subConsultsCount: number;
  subDaqqiRoundsCount: number;
}

export function ClientTabContent({
  activeTab, isSub, overview, communications, payments, courses, certificates,
  installments, consultations, daqqi, edit, subConsultsCount, subDaqqiRoundsCount,
}: Props) {
  return (
    <div className="p-5 space-y-6">

      {/* ══ OVERVIEW ══ */}
      {activeTab === 'overview' && (
        <OverviewClientTab {...overview} commTypeMeta={commTypeMeta} />
      )}

      {/* ══ 💬 التواصل ══ */}
      {activeTab === 'communications' && (
        <CommunicationsTab {...communications} />
      )}

      {/* ══ 💳 الدفعات ══ */}
      {activeTab === 'payments' && (
        <PaymentsTab {...payments} ptLabels={ptLabels} />
      )}

      {/* ══ 🎓 الكورسات ══ */}
      {isSub && activeTab === 'courses' && (
        <CoursesAccessTab {...courses} />
      )}

      {/* ══ 🏆 الشهادات ══ */}
      {isSub && activeTab === 'certificates' && (
        <CertificatesTab {...certificates} />
      )}

      {/* ══ 📅 الأقساط ══ */}
      {isSub && activeTab === 'installments' && (
        <InstallmentsTab {...installments} />
      )}

      {/* ══ 🧠 الاستشارات ══ */}
      {activeTab === 'consultations' && subConsultsCount > 0 && (
        <ConsultationsTab {...consultations} />
      )}

      {/* ══ 🗓️ جدول الدقي ══ */}
      {isSub && activeTab === 'daqqi' && subDaqqiRoundsCount > 0 && (
        <DaqqiRoundsTab {...daqqi} />
      )}

      {/* ══ ✏️ تعديل البيانات ══ */}
      {activeTab === 'edit' && (
        <EditClientTab {...edit} branchLabels={branchLabels} statusLabels={statusLabels} />
      )}

    </div>
  );
}
