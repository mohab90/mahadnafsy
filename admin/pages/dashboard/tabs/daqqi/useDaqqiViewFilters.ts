import { useState } from 'react';

export const useDaqqiViewFilters = () => {
  const [daqqiView, setDaqqiView] = useState<'table' | 'calendar'>('table');
  const [daqqiFilterCourse, setDaqqiFilterCourse] = useState('');
  const [daqqiFilterInstructor, setDaqqiFilterInstructor] = useState('');
  const [daqqiFilterDay, setDaqqiFilterDay] = useState('');
  const [daqqiFilterTimeSlot, setDaqqiFilterTimeSlot] = useState('');
  const [daqqiFilterStatus, setDaqqiFilterStatus] = useState('');
  const [daqqiFilterReception, setDaqqiFilterReception] = useState('');

  const hasDaqqiFilters = Boolean(
    daqqiFilterCourse ||
    daqqiFilterInstructor ||
    daqqiFilterDay ||
    daqqiFilterTimeSlot ||
    daqqiFilterStatus ||
    daqqiFilterReception,
  );

  const clearDaqqiFilters = () => {
    setDaqqiFilterCourse('');
    setDaqqiFilterInstructor('');
    setDaqqiFilterDay('');
    setDaqqiFilterTimeSlot('');
    setDaqqiFilterStatus('');
    setDaqqiFilterReception('');
  };

  return {
    daqqiView,
    setDaqqiView,
    daqqiFilterCourse,
    setDaqqiFilterCourse,
    daqqiFilterInstructor,
    setDaqqiFilterInstructor,
    daqqiFilterDay,
    setDaqqiFilterDay,
    daqqiFilterTimeSlot,
    setDaqqiFilterTimeSlot,
    daqqiFilterStatus,
    setDaqqiFilterStatus,
    daqqiFilterReception,
    setDaqqiFilterReception,
    hasDaqqiFilters,
    clearDaqqiFilters,
  };
};
