import React from 'react';
import GlobalSearch from './GlobalSearch';

const IntelligenceHeader = () => {
  return (
    <div className="sticky top-0 z-40 bg-gradient-to-r from-teal-600 to-teal-700 dark:from-teal-800 dark:to-teal-900 shadow-lg">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex-1 max-w-lg">
            <GlobalSearch />
          </div>
        </div>
      </div>
    </div>
  );
};

export default IntelligenceHeader;