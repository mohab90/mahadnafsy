import { useCallback } from 'react';
import { MyRequestsSection } from '../dashboard/my-profile/MyRequestsSection';
import { useMyHr } from '../dashboard/my-profile/useMyHr';
import type { Notify } from './lecturerApi';
import { Loading } from './ui';

/**
 * «وهو مش موظف ثابت … حساب ثابت وإذن وطلب سلفة»: the lecturer is not a permanent employee but still asks the institute for a
 * permission (morning or evening), a leave or an advance from their own portal. The same requests, the same HR inbox and the same
 * approval as everyone's «طلباتي» (MyRequestsSection) — nothing is built twice.
 */
export function LecturerRequests({ notify }: { notify: Notify }) {
  // The employee page's notifier also knows «warning»; the portal's has three kinds.
  const toPortal = useCallback((kind: 'success' | 'error' | 'warning' | 'info', message: string) => notify(kind === 'warning' ? 'info' : kind, message), [notify]);
  const { hr, leaves, advances, reload, loading } = useMyHr(toPortal);
  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      <p className="rounded-2xl border border-primary-100 bg-primary-50/60 p-4 text-sm text-primary-900">
        اطلب إذن (صباحي أو مسائي) أو إجازة أو سلفة من هنا — الطلب بيوصل للموارد البشرية والإدارة وبتعرف ردهم في نفس الصفحة.
      </p>
      <MyRequestsSection hr={hr} leaves={leaves} advances={advances} reload={reload} notify={toPortal} />
    </div>
  );
}
