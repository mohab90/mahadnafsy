import { useState } from 'react';

// Subscriber-list filter/pagination state, lifted out of the Dashboard god-hub.
// Pure UI state (no effects) — returns identical names so the component body is
// unchanged apart from the single destructure that replaces 10 useState lines.
export function useSubscriberFilters() {
  const [subscriberSubTab, setSubscriberSubTab] = useState<'local' | 'abroad' | 'all' | 'online25'>('all');
  const [subscriberCourseFilter, setSubscriberCourseFilter] = useState('');
  const [subscriberSearch, setSubscriberSearch] = useState('');
  const [subscriberSalesFilter, setSubscriberSalesFilter] = useState('all');
  const [subscriberCsFilter, setSubscriberCsFilter] = useState('all');
  const [subscriberInstFilter, setSubscriberInstFilter] = useState(''); // '' | 'overdue' | 'soon'
  const [subscriberRemainingFilter, setSubscriberRemainingFilter] = useState(''); // '' | '1000' | ...
  const [subscriberCertFilter, setSubscriberCertFilter] = useState(''); // '' | 'has' | 'pending' | 'issued'
  const [subscriberPayFilter, setSubscriberPayFilter] = useState(''); // '' | 'pending'
  const [subscriberPage, setSubscriberPage] = useState(1);
  return {
    subscriberSubTab, setSubscriberSubTab,
    subscriberCourseFilter, setSubscriberCourseFilter,
    subscriberSearch, setSubscriberSearch,
    subscriberSalesFilter, setSubscriberSalesFilter,
    subscriberCsFilter, setSubscriberCsFilter,
    subscriberInstFilter, setSubscriberInstFilter,
    subscriberRemainingFilter, setSubscriberRemainingFilter,
    subscriberCertFilter, setSubscriberCertFilter,
    subscriberPayFilter, setSubscriberPayFilter,
    subscriberPage, setSubscriberPage,
  };
}
