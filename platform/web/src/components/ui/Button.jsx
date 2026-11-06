const VARIANT_CLASS = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  success: "btn-success",
  ghost: "btn-ghost",
};

function Spinner() {
  return (
    <span
      className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden
    />
  );
}

/**
 * Shared button. `loading` disables the control and shows a spinner.
 */
export default function Button({
  variant = "primary",
  loading = false,
  disabled = false,
  type = "button",
  className = "",
  children,
  ...props
}) {
  const variantClass = VARIANT_CLASS[variant] || VARIANT_CLASS.primary;
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`${variantClass} min-h-11 ${className}`.trim()}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
