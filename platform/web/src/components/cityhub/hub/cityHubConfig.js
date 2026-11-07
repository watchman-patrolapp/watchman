export const POST_TYPES = [
  { value: "suspect_alert", label: "Suspect Alert" },
  { value: "pattern", label: "Pattern" },
  { value: "resource_request", label: "Resource Request" },
  { value: "general", label: "General" },
];

export const POST_TYPE_CARD_ACCENT = {
  suspect_alert: "border-l-red-500 dark:border-l-red-400",
  pattern: "border-l-amber-500 dark:border-l-amber-400",
  resource_request: "border-l-sky-500 dark:border-l-sky-400",
  general: "border-l-slate-400 dark:border-l-slate-500",
};

export const POST_TYPE_HEADLINE_STYLES = {
  suspect_alert:
    "bg-red-100 text-red-800 ring-1 ring-red-300/80 dark:bg-red-950/75 dark:text-red-200 dark:ring-red-500/45",
  pattern:
    "bg-amber-100 text-amber-950 ring-1 ring-amber-300/80 dark:bg-amber-950/70 dark:text-amber-200 dark:ring-amber-500/40",
  resource_request:
    "bg-sky-100 text-sky-900 ring-1 ring-sky-300/80 dark:bg-sky-950/70 dark:text-sky-200 dark:ring-sky-500/40",
  general:
    "bg-slate-100 text-slate-800 ring-1 ring-slate-300/80 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/40",
};

export function cityHubPostTypeHeadline(type) {
  const option = POST_TYPES.find((item) => item.value === type);
  return {
    label: option?.label || String(type || "Alert").replaceAll("_", " "),
    className: POST_TYPE_HEADLINE_STYLES[type] || POST_TYPE_HEADLINE_STYLES.general,
  };
}
