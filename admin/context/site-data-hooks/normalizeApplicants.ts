// Applicant rows as they arrive from the API.
//
// Fields come back camelCase or snake_case depending on the endpoint, so each
// is read both ways. This lived twice — once for the initial load, once for the
// reload — and the two copies had to be kept in step by hand. A field added to
// one would have been dropped by the other.

import type { JoinUsApplication } from '../../types';

export function normalizeApplicants(rows: unknown): JoinUsApplication[] {
  return (rows as Record<string, unknown>[]).map(row => ({
    ...row,
    status: String(row.status || 'NEW').toLowerCase(),
    createdAt: String(row.createdAt ?? row.created_at ?? ''),
    adminNote: (row.adminNote ?? row.admin_note) as string | undefined,
    // The call log. contactedAt was declared on the type and read by the screen
    // but mapped by nobody, so it was undefined even once the route started
    // sending it — the field had two independent breaks in the same chain, and
    // fixing either alone would have changed nothing on the page.
    contactedAt: (row.contactedAt ?? row.contacted_at) as string | undefined,
    contactedBy: (row.contactedBy ?? row.contacted_by) as string | undefined,
    contactedByName: (row.contactedByName ?? row.contacted_by_name) as string | undefined,
    contactNote: (row.contactNote ?? row.contact_note) as string | undefined,
    contactNoteAt: (row.contactNoteAt ?? row.contact_note_at) as string | undefined,
    // The applicant record is the one the interviews screen reads, so its date
    // wins where the two disagree.
    interviewAt: (row.applicantInterviewAt ?? row.applicant_interview_at
      ?? row.interviewAt ?? row.interview_at) as string | undefined,
    convertedApplicantId: (row.convertedApplicantId ?? row.converted_applicant_id) as string | undefined,
    applicantStage: (row.applicantStage ?? row.applicant_stage) as JoinUsApplication['applicantStage'],
    hiredStaffId: (row.hiredStaffId ?? row.hired_staff_id) as string | undefined,
    applicantBranch: (row.applicantBranch ?? row.applicant_branch) as string | undefined,
    education: row.education as string | undefined,
    experienceYears: (row.experienceYears ?? row.experience_years) as string | undefined,
    experiencePlaces: (row.experiencePlaces ?? row.experience_places) as string | undefined,
    jobId: (row.jobId ?? row.job_id) as string | undefined,
    jobTitle: (row.jobTitle ?? row.job_title) as string | undefined,
  })) as JoinUsApplication[];
}
