import { useRef, useState } from 'react';
import type { StaffMember } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

export function useStaffState(
  initialStaffMembers: StaffMember[],
  lastCRMWriteRef: { current: number },
  track: Track,
) {
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>(initialStaffMembers);
  const staffMembersRef = useRef<StaffMember[]>(initialStaffMembers);
  staffMembersRef.current = staffMembers;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistStaffMemberToCollection = (_member: StaffMember) => { /* MySQL */ };

  const addStaffMember = (item: StaffMember) => {
    lastCRMWriteRef.current = Date.now();
    const nextStaff = [item, ...staffMembersRef.current];
    staffMembersRef.current = nextStaff;
    setStaffMembers(nextStaff);
    void mysqlAdmin.saveStaff(item as unknown as Record<string,unknown>).then(() => {
      persistStaffMemberToCollection(item);
    }).catch((err) => {
      console.error('[Staff] Failed to save staff to MySQL — rolling back:', err);
      const reverted = staffMembersRef.current.filter(s => s.id !== item.id);
      staffMembersRef.current = reverted;
      setStaffMembers(reverted);
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'staff', name: item.name } }));
    });
    track('create', 'staff', item.name);
  };

  const updateStaffMember = (item: StaffMember) => {
    lastCRMWriteRef.current = Date.now();
    const nextStaff = staffMembersRef.current.map((row) => (row.id === item.id ? item : row));
    staffMembersRef.current = nextStaff;
    setStaffMembers(nextStaff);
    persistStaffMemberToCollection(item);
    void mysqlAdmin.saveStaff(item as unknown as Record<string,unknown>);
    track('update', 'staff', item.name);
  };

  const deleteStaffMember = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    const nextStaff = staffMembersRef.current.filter((row) => row.id !== id);
    staffMembersRef.current = nextStaff;
    setStaffMembers(nextStaff);
    void mysqlAdmin.deleteStaff(id);
    track('delete', 'staff', id);
  };

  return { staffMembers, setStaffMembers, staffMembersRef, addStaffMember, updateStaffMember, deleteStaffMember };
}
