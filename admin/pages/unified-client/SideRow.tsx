import React from 'react';

export const SideRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
    <span className="text-gray-400 text-xs">{label}</span>
    <span className="font-medium text-gray-800 text-xs text-left">{value}</span>
  </div>
);
