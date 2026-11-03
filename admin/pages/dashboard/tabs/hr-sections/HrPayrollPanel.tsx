// What sits around the month's payroll: compensation approvals, salary advances and instructor pay. The payroll run itself (calculate, approve, pay, its
// lines per employee) lives in the month sheet above — it used to be drawn here a second time, as a list of runs and a table of the same lines.
import HrCompensationApprovals from './HrCompensationApprovals';
import HrAdvancesPanel from './HrAdvancesPanel';
import HrInstructorPayPanel from './HrInstructorPayPanel';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

export default function HrPayrollPanel({ notify, canManageFinance, canManagePayroll }: {
  notify: Notify;
  canManageFinance: boolean;
  // The route accepts manage_hr OR manage_financial, so the instructor pay gate is its own.
  canManagePayroll: boolean;
}) {
  return (
    <div className="space-y-4">
      <HrCompensationApprovals notify={notify} />
      <HrAdvancesPanel notify={notify} canDisburse={canManageFinance} />
      <HrInstructorPayPanel notify={notify} canManage={canManagePayroll} />
    </div>
  );
}
