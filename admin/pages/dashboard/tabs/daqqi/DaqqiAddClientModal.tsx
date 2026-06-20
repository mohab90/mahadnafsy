/**
 * DaqqiAddClientModal — thin wrapper around AddSubscriberModal (mode='daqqi').
 * Preserves the original Props API so DaqqiScheduleTab requires no changes.
 */
import React from 'react';
import AddSubscriberModal from '../../../../components/AddSubscriberModal';
import type { SubscriberItem } from '../../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  notify: NotifyFn;
  subscribersOverride?: SubscriberItem[];
  onLocallyAdd: (id: string) => void;
  onClientAdded: () => void;
}

export function DaqqiAddClientModal({ isOpen, onClose, notify, onLocallyAdd, onClientAdded }: Props) {
  return (
    <AddSubscriberModal
      isOpen={isOpen}
      onClose={onClose}
      notify={notify}
      mode="daqqi"
      branchLabel="فرع الدقي"
      onSuccess={(id) => {
        onLocallyAdd(id);
        onClientAdded();
      }}
    />
  );
}
