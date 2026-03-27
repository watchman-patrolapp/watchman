import React from 'react';
import GlobalSearch from './GlobalSearch';

const IntelligenceHeader = () => {
  return (
    <div className="sticky top-0 z-40 bg-gradient-to-r from-indigo-600 to-indigo-700 dark:from-indigo-800 dark:to-indigo-900 shadow-lg">
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