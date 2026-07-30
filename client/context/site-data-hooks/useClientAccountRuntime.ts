import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { mysqlClient } from '../../lib/mysqlapi';
import type { ConsultationItem, Course, SubscriberItem } from '../../types';

type Setter<T> = Dispatch<SetStateAction<T>>;
type RuntimeUser = { uid?: string | null; email?: string | null } | null | undefined;

interface ClientAccountRuntimeOptions {
  authUser: RuntimeUser;
  isAdmin: boolean;
  setSubscribers: Setter<SubscriberItem[]>;
  setCourses: Setter<Course[]>;
  setConsultations: Setter<ConsultationItem[]>;
}

export function useClientAccountRuntime({
  authUser,
  isAdmin,
  setSubscribers,
  setCourses,
  setConsultations,
}: ClientAccountRuntimeOptions) {
  const [mySubscriberLoaded, setMySubscriberLoaded] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const emailRef = useRef<string | null>(null);
  useEffect(() => { emailRef.current = authUser?.email ?? null; }, [authUser?.email]);

  const applySubscriberData = useCallback((value: unknown) => {
    const raw = value as SubscriberItem & { enrolledCoursesData?: Course[] };
    const subscriber = {
      ...raw,
      enrolledCourseIds: Array.isArray(raw.enrolledCourseIds) ? raw.enrolledCourseIds : [],
    };
    setSubscribers(previous => {
      const index = previous.findIndex(item => item.id === subscriber.id);
      if (index >= 0) {
        const next = [...previous];
        next[index] = { ...next[index], ...subscriber };
        return next;
      }
      const email = (emailRef.current || '').toLowerCase().trim();
      return [subscriber, ...previous.filter(item => item.email?.toLowerCase().trim() !== email)];
    });
    if (Array.isArray(raw.enrolledCoursesData) && raw.enrolledCoursesData.length > 0) {
      setCourses(previous => {
        const existing = new Set(previous.map(course => course.id));
        const additions = raw.enrolledCoursesData!.filter(course => !existing.has(course.id));
        return additions.length > 0 ? [...previous, ...additions] : previous;
      });
    }
    setMySubscriberLoaded(true);
  }, [setCourses, setSubscribers]);

  const refreshMySubscriber = useCallback(() => {
    if (!emailRef.current) return;
    void mysqlClient.getMySubscriber()
      .then(value => { if (value) applySubscriberData(value); })
      .catch(() => {});
  }, [applySubscriberData]);

  useEffect(() => {
    if (!authUser || isAdmin) return;
    setMySubscriberLoaded(false);
    let cancelled = false;
    void mysqlClient.getMySubscriber()
      .then(value => {
        if (cancelled) return;
        if (value) applySubscriberData(value);
        else setMySubscriberLoaded(true);
      })
      .catch(() => { if (!cancelled) setMySubscriberLoaded(true); });

    const pollId = setInterval(() => { if (!cancelled) refreshMySubscriber(); }, 5 * 60 * 1000);
    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible') refreshMySubscriber();
    };
    const onProgressSynced = () => { if (!cancelled) refreshMySubscriber(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('mahad-progress-synced', onProgressSynced);
    return () => {
      cancelled = true;
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('mahad-progress-synced', onProgressSynced);
    };
  }, [authUser?.uid, isAdmin, applySubscriberData, refreshMySubscriber]);

  useEffect(() => {
    if (!authUser?.email || isAdmin) return;
    let cancelled = false;
    void mysqlClient.getMyConsultations()
      .then(list => {
        if (!cancelled) {
          setConsultations((list as unknown as ConsultationItem[])
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [authUser?.uid, authUser?.email, isAdmin, setConsultations]);

  useEffect(() => {
    if (!authUser?.uid || isAdmin) {
      setIsStaff(false);
      return;
    }
    let cancelled = false;
    void mysqlClient.checkIsStaff()
      .then(result => { if (!cancelled) setIsStaff(result.isStaff); })
      .catch(() => { if (!cancelled) setIsStaff(false); });
    return () => { cancelled = true; };
  }, [authUser?.uid, isAdmin]);

  return { mySubscriberLoaded, refreshMySubscriber, isStaff };
}
