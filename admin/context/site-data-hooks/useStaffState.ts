import { useRef, useState } from 'react';
import type { StaffMember } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

export function useStaffState(
  initialStaff: StaffMember[],
  lastWriteRef: { current: number },
  track: Track,
) {
  const [staffMembers, setStaffMembers] = useState(initialStaff);
  const staffMembersRef = useRef(initialStaff);
  staffMembersRef.current = staffMembers;

  const reloadStaffMembers = async () => {
    const rows = await mysqlAdmin.listAllStaff() as unknown as StaffMember[];
    const normalized = rows.map(member => ({
      ...member,
      role: String(member.role || 'other').toLowerCase() as StaffMember['role'],
      status: member.status === 'inactive' ? 'inactive' as const : 'active' as const,
    }));
    staffMembersRef.current = normalized;
    setStaffMembers(normalized);
  };

  const save = async (item: StaffMember) => {
    try { await mysqlAdmin.saveStaff(item as unknown as Record<string, unknown>); return true; }
    catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'staff', name: item.name } }));
      return false;
    }
  };

  const addStaffMember = async (item: StaffMember) => {
    lastWriteRef.current = Date.now();
    if (!await save(item)) return false;
    const next = [item, ...staffMembersRef.current.filter(row => row.id !== item.id)];
    staffMembersRef.current = next;
    setStaffMembers(next);
    track('create', 'staff', item.name);
    return true;
  };

  const updateStaffMember = async (item: StaffMember) => {
    lastWriteRef.current = Date.now();
    if (!await save(item)) return false;
    const next = staffMembersRef.current.map(row => row.id === item.id ? item : row);
    staffMembersRef.current = next;
    setStaffMembers(next);
    track('update', 'staff', item.name);
    return true;
  };

  const deleteStaffMember = async (id: string) => {
    lastWriteRef.current = Date.now();
    try { await mysqlAdmin.deleteStaff(id); }
    catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'staff', name: id } }));
      return false;
    }
    const next = staffMembersRef.current.filter(row => row.id !== id);
    staffMembersRef.current = next;
    setStaffMembers(next);
    track('delete', 'staff', id);
    return true;
  };

  return { staffMembers, setStaffMembers, staffMembersRef, reloadStaffMembers, addStaffMember, updateStaffMember, deleteStaffMember };
}
