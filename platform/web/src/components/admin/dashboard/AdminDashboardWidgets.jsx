export function ChartSkeleton() {
  return <div className="h-[220px] w-full animate-pulse rounded-xl bg-gray-100 dark:bg-gray-700" />;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

export function StatCard({ icon: Icon, label, value, sub, color = 'teal' }) {
  const colorSchemes = {
    teal: 'from-teal-500 to-purple-600 bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-300',
    emerald: 'from-emerald-500 to-teal-600 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300',
    amber: 'from-amber-400 to-orange-500 bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
    rose: 'from-rose-500 to-pink-600 bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
  };

  return (
    <div className="card card-hover p-5 relative overflow-hidden">
      <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${colorSchemes[color]} opacity-10 rounded-full -translate-y-1/2 translate-x-1/2`}></div>
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">{value}</p>
          {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
        </div>
        <div className={`w-12 h-12 rounded-xl ${colorSchemes[color]} flex items-center justify-center`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}

export function SectionCard({ title, subtitle, children, action }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mb-8">
      <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

export function InlineConfirm({ label, onConfirm, onCancel, danger = true }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <button
        onClick={onConfirm}
        className={`px-2 py-1 text-white text-xs rounded-lg transition ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'}`}
      >
        Yes
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs rounded-lg transition"
      >
        No
      </button>
    </div>
  );
}
