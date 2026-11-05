/**
 * Icon-only button. `label` is required and becomes the accessible name.
 * Hit area is at least 44×44px.
 */
export default function IconButton({ label, type = "button", className = "", children, ...props }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={props.title || label}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
