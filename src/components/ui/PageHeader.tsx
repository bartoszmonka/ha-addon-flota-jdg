import React from 'react';

export const PageHeader: React.FC<{ title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
    <div className="flex-1 min-w-0">
      <h1 className="text-2xl sm:text-[26px] font-bold tracking-tight text-ink">{title}</h1>
      {subtitle && <p className="text-sm font-medium text-ink-3 mt-1">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);
