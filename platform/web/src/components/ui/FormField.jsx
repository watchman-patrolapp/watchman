import { Children, cloneElement, createContext, isValidElement, useContext } from "react";

/** Optional map of field id → error message, so forms can keep their existing field markup. */
export const FieldErrorContext = createContext({});

const NATIVE_CONTROLS = new Set(["input", "select", "textarea"]);

/**
 * Label, optional hint, and error for one control.
 * A native input/select/textarea child receives aria-invalid and aria-describedby.
 */
export default function FormField({ id, label, required = false, hint, error, children, className = "" }) {
  const contextErrors = useContext(FieldErrorContext);
  const resolvedError = error || contextErrors[id] || "";
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = resolvedError ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  let control = children;
  const only = Children.count(children) === 1 ? Children.only(children) : null;
  if (only && isValidElement(only) && typeof only.type === "string" && NATIVE_CONTROLS.has(only.type)) {
    const previous = only.props["aria-describedby"];
    control = cloneElement(only, {
      id: only.props.id || id,
      "aria-invalid": resolvedError ? true : only.props["aria-invalid"],
      "aria-describedby": [previous, describedBy].filter(Boolean).join(" ") || undefined,
    });
  }

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-text-primary">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden> *</span>
        ) : (
          <span className="font-normal text-text-tertiary"> (optional)</span>
        )}
      </label>
      {control}
      {hint ? (
        <p id={hintId} className="mt-1 text-sm text-text-tertiary">
          {hint}
        </p>
      ) : null}
      {resolvedError ? (
        <p id={errorId} className="mt-1 text-sm text-danger" role="alert">
          {resolvedError}
        </p>
      ) : null}
    </div>
  );
}
