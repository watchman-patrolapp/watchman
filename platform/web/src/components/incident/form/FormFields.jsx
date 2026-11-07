import { FaExclamationTriangle, FaCamera } from "react-icons/fa";
import FormField from "../../ui/FormField";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

export function SectionCard({ title, children }) {
  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-5">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</h3>
      {children}
    </div>
  );
}

export function FormInput({ label, name, type = "text", required, hint, ...props }) {
  const id = props.id || `incident-${name}`;
  return (
    <FormField id={id} label={label} required={required} hint={hint}>
      <input
        id={id}
        type={type}
        name={name}
        required={required}
        className="input border w-full"
        {...props}
      />
    </FormField>
  );
}

export function FormTextarea({ label, name, required, rows = 4, hint, ...props }) {
  const id = props.id || `incident-${name}`;
  return (
    <FormField id={id} label={label} required={required} hint={hint}>
      <textarea
        id={id}
        name={name}
        required={required}
        rows={rows}
        className="input border w-full resize-y"
        {...props}
      />
    </FormField>
  );
}

export function FormSelect({ label, name, required, options, hint, ...props }) {
  const id = props.id || `incident-${name}`;
  return (
    <FormField id={id} label={label} required={required} hint={hint}>
      <select
        id={id}
        name={name}
        required={required}
        className="input border w-full"
        {...props}
      >
        <option value="">Select {String(label || "an option").toLowerCase()}</option>
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </FormField>
  );
}

export function AlertBox({ message }) {
  return (
    <div className="bg-danger-light border border-danger rounded-xl p-4 mb-6 flex items-start gap-3" role="alert">
      <FaExclamationTriangle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" aria-hidden />
      <p className="text-sm text-danger-foreground">{message}</p>
    </div>
  );
}

export function UploadProgress({ current, total, progress }) {
  return (
    <div className="mt-3 bg-teal-50 dark:bg-teal-900/20 rounded-xl p-3">
      <div className="flex justify-between text-sm mb-2 text-teal-700 dark:text-teal-300">
        <span className="flex items-center gap-2">
          <FaCamera className="w-4 h-4" />
          Uploading {current} of {total}
        </span>
        <span className="font-semibold">{progress}%</span>
      </div>
      <div className="w-full bg-teal-200 dark:bg-teal-800 rounded-full h-2">
        <div
          className="bg-teal-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
