import React from "react";
import hotToast from "react-hot-toast";
import { toastIdentity } from "./toastPolicy";

function apply(kind, message, options) {
  const { id, duration } = toastIdentity(kind, message, options || {});
  const next = { ...(options || {}) };
  delete next.retry;
  if (id) next.id = id;
  if (duration != null) next.duration = duration;
  return next;
}

function toast(message, options) {
  return hotToast(message, apply("toast", message, options));
}

toast.success = (message, options) => hotToast.success(message, apply("success", message, options));

toast.error = (message, options) => {
  const retry = options && typeof options.retry === "function" ? options.retry : null;
  const next = apply("error", message, options);
  if (retry && typeof message === "string") {
    return hotToast.error(
      (t) =>
        React.createElement(
          "span",
          { className: "flex items-center gap-3" },
          React.createElement("span", null, message),
          React.createElement(
            "button",
            {
              type: "button",
              className: "min-h-11 shrink-0 rounded-lg bg-white/20 px-3 text-sm font-semibold underline",
              onClick: () => {
                hotToast.dismiss(t.id);
                retry();
              },
            },
            "Retry"
          )
        ),
      next
    );
  }
  return hotToast.error(message, next);
};

toast.loading = (message, options) => hotToast.loading(message, apply("loading", message, options));
toast.custom = (message, options) => hotToast.custom(message, apply("custom", message, options));
toast.dismiss = (...args) => hotToast.dismiss(...args);
toast.promise = (...args) => hotToast.promise(...args);
if (typeof hotToast.remove === "function") {
  toast.remove = (...args) => hotToast.remove(...args);
}

export default toast;
