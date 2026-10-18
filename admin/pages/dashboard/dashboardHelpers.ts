import type { Price, StaffMember } from '../../types';

export type StaffWire = StaffMember & { is_active?: number | boolean };

export const staffStatusFromWire = (staff: StaffWire): StaffMember['status'] =>
  staff.status === 'active' || staff.is_active === 1 || staff.is_active === true ? 'active' : 'inactive';

export const priceForCurrency = (price: Price | undefined, currency: keyof Price): number =>
  Number(price?.[currency] ?? 0) || 0;
