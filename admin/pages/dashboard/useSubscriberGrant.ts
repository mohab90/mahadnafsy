import { useState } from 'react';
import type { CourseAccessSetting } from '../../types';

// "Grant course access" panel state, lifted out of the Dashboard god-hub. Pure UI
// state (no effects); the openSubscriberGrantPanel/saveSubscriberGrant handlers
// stay in Dashboard and use these via the destructure (identical names).
export function useSubscriberGrant() {
  const [grantSubscriberId, setGrantSubscriberId] = useState('');
  const [grantEnrolledCourseIds, setGrantEnrolledCourseIds] = useState<string[]>([]);
  const [grantCourseAccess, setGrantCourseAccess] = useState<Record<string, CourseAccessSetting>>({});
  const [grantPaymentAmount, setGrantPaymentAmount] = useState('');
  const [grantPaymentCurrency, setGrantPaymentCurrency] = useState<'EGP' | 'SAR' | 'USD'>('EGP');
  const [grantPaymentNote, setGrantPaymentNote] = useState('منح صلاحية مشاهدة');
  return {
    grantSubscriberId, setGrantSubscriberId,
    grantEnrolledCourseIds, setGrantEnrolledCourseIds,
    grantCourseAccess, setGrantCourseAccess,
    grantPaymentAmount, setGrantPaymentAmount,
    grantPaymentCurrency, setGrantPaymentCurrency,
    grantPaymentNote, setGrantPaymentNote,
  };
}
