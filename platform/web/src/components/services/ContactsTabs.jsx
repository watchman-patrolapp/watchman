import { useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { EMERGENCY_TAB, SERVICES_TAB, parseContactsTab } from "../../utils/localServices";

const TABS = [
  { id: EMERGENCY_TAB, label: "Emergency" },
  { id: SERVICES_TAB, label: "Local services" },
];

export default function ContactsTabs() {
  const [params, setParams] = useSearchParams();
  const active = parseContactsTab(params.toString());
  const refs = useRef({});

  const select = (id) => {
    const next = new URLSearchParams(params);
    next.set("tab", id);
    if (id !== SERVICES_TAB) next.delete("neighbours");
    setParams(next);
  };

  const onKeyDown = (event, index) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const nextIndex = (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    const nextId = TABS[nextIndex].id;
    select(nextId);
    refs.current[nextId]?.focus();
  };

  return (
    <div role="tablist" aria-label="Contacts" className="flex gap-2">
      {TABS.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            type="button"
            role="tab"
            id={`contacts-tab-${tab.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ring-1 transition ${
              selected
                ? "bg-teal-600 text-white ring-teal-600"
                : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
