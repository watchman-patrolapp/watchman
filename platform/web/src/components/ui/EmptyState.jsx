export default function EmptyState({ title, message, action, icon: Icon }) {
  const heading = title || message;
  const detail = title ? message : "";
  return (
    <div className="px-4 py-12 text-center">
      {Icon ? <Icon className="mx-auto mb-3 h-10 w-10 text-text-tertiary" aria-hidden /> : null}
      <p className="text-base font-medium text-text-primary">{heading}</p>
      {detail ? <p className="mt-1 text-sm text-text-secondary">{detail}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
