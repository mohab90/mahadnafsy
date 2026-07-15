import type { LeadItem } from '../../../../types';

export const blankLead = (): LeadItem => ({
  id: '',
  name: '',
  email: '',
  phone: '',
  status: 'new',
  leadType: 'general',
  enrolledCourseId: '',
  branch: undefined,
  interestLevel: 'medium',
  source: '',
  assignedSalesId: '',
  assignedSalesName: '',
  interestedCourseIds: [],
  communications: [],
  notes: '',
  createdAt: '',
  hidden: false,
});
