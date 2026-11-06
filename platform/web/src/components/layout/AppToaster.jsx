import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";

const MOBILE_QUERY = "(max-width: 767px)";

/**
 * Bottom-center on phones (above the tab bar and home indicator) and top-right from md up.
 * Success toasts are short; errors stay longer. Callers dedupe via src/utils/notify.js ids.
 */
export default function AppToaster() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_QUERY).matches : false
  );

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <Toaster
      position={mobile ? "bottom-center" : "top-right"}
      containerStyle={
        mobile
          ? { bottom: "calc(4.25rem + env(safe-area-inset-bottom, 0px))" }
          : { top: "max(1rem, env(safe-area-inset-top, 0px))" }
      }
      toastOptions={{
        success: { duration: 2000 },
        error: { duration: 8000 },
      }}
      gutter={8}
    />
  );
}
