export type TenantId = string;
export type BranchId = string;

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'online_manager'
  | 'sales'
  | 'collection'
  | 'finance'
  | 'hr'
  | 'instructor'
  | 'student';

export type LeadStage =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'proposal'
  | 'won'
  | 'lost'
  | 'archived';

export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export interface TenantScoped {
  tenant_id?: TenantId | null;
  branch_id?: BranchId | null;
}

export interface AuditFields {
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  updated_by?: string | null;
}
