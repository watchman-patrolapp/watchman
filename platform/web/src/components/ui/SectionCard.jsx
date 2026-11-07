import React from 'react';

/**
 * Titled form section with a top rule. `as` sets the heading level so each page
 * can keep a correct outline (h2 under the page title, h3 inside another section).
 */
export default function SectionCard({ title, as: Heading = 'h2', children }) {
  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-5">
      <Heading className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</Heading>
      {children}
    </div>
  );
}
