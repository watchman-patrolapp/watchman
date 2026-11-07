import React from 'react';

export default function SectionCard({ title, children }) {
  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-5">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</h2>
      {children}
    </div>
  );
}
