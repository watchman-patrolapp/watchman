import { useLayoutEffect, useRef } from "react";
import { FaEnvelope, FaPhone, FaUser } from "react-icons/fa";

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function FitText({ children, title }) {
  const ref = useRef(null);
  const text = children == null ? "" : String(children);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      const maxPx = 14;
      const minPx = 10;
      let size = maxPx;
      el.style.fontSize = `${size}px`;
      el.style.whiteSpace = "nowrap";
      while (size > minPx && el.scrollWidth > el.clientWidth + 0.5) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span ref={ref} title={title || text} className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap leading-tight">
      {text}
    </span>
  );
}

function InfoCell({ icon: Icon, label, children, href }) {
  const inner = (
    <div className="flex h-full min-w-0 flex-col gap-1 px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-400">{label}</p>
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
        <Icon className="h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <FitText>{children}</FitText>
        </div>
      </div>
    </div>
  );
  if (!href) return <div className="min-w-0">{inner}</div>;
  return (
    <a href={href} className="block h-full min-w-0 transition hover:bg-white/80 dark:hover:bg-gray-800/80">
      {inner}
    </a>
  );
}

/**
 * Company profile card: Facebook-style cover, then a full-width identity + contact grid.
 */
export default function CompanyCoverCard({
  name,
  logoUrl,
  bannerUrl,
  phone,
  email,
  contactPerson,
  kicker = "Security company",
  footer = null,
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-900">
      <div className="relative">
        <div className="aspect-[820/312] overflow-hidden bg-gradient-to-r from-slate-800 via-slate-600 to-teal-800">
          {bannerUrl ? (
            <img src={bannerUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
        </div>
        <div className="absolute -bottom-12 left-6">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className="h-24 w-24 rounded-2xl object-cover shadow-lg ring-[5px] ring-white dark:ring-gray-900"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-teal-600 font-mono text-2xl font-bold text-white shadow-lg ring-[5px] ring-white dark:ring-gray-900">
              {initials(name)}
            </div>
          )}
        </div>
      </div>

      <div className="border-b border-gray-100 px-6 pb-5 pt-16 dark:border-gray-800">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-teal-700 dark:text-teal-400">
              {kicker}
            </p>
            <h3 className="mt-1 break-words text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
              {name || "Security company"}
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {phone ? (
              <a
                href={`tel:${phone}`}
                className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
              >
                <FaPhone className="h-3.5 w-3.5" aria-hidden />
                Call
              </a>
            ) : null}
            {email ? (
              <a
                href={`mailto:${email}`}
                className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800"
              >
                <FaEnvelope className="h-3.5 w-3.5" aria-hidden />
                Email
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 divide-y divide-gray-200 bg-gray-50 dark:divide-gray-800 dark:bg-gray-950/50 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <InfoCell icon={FaPhone} label="Control room" href={phone ? `tel:${phone}` : undefined}>
          {phone || "Not listed"}
        </InfoCell>
        <InfoCell icon={FaEnvelope} label="Email" href={email ? `mailto:${email}` : undefined}>
          {email || "Not listed"}
        </InfoCell>
        <InfoCell icon={FaUser} label="Person in charge">
          {contactPerson || "Not listed"}
        </InfoCell>
      </div>
      {footer}
    </article>
  );
}
