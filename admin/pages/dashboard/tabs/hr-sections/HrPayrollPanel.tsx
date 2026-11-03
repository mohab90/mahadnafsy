// What sits around the month's payroll: compensation approvals and salary advances. The payroll run itself (calculate, approve, pay, its lines per employee) lives
// in the month sheet above — it used to be drawn here a second time, as a list of runs and a table of the same lines. The instructors' pay has its own tab
// («المحاضرون وأجورهم», 3 Nov 2026), not a part of the employees' salaries.
import HrCompensationApprovals from './HrCompensationApprovals';
import HrAdvancesPanel from './HrAdvancesPanel';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

export default function HrPayrollPanel({ notify, canManageFinance }: { notify: Notify; canManageFinance: boolean }) {
  return (
    <div className="space-y-4">
      <HrCompensationApprovals notify={notify} />
      <HrAdvancesPanel notify={notify} canDisburse={canManageFinance} />
    </div>
  );
}
