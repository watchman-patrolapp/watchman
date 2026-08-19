import { useMemo, useState } from "react";
import {
  FaBook,
  FaBuilding,
  FaBullhorn,
  FaChartLine,
  FaChevronDown,
  FaClipboardList,
  FaCommentAlt,
  FaComments,
  FaCreditCard,
  FaHistory,
  FaHome,
  FaIdCard,
  FaPhone,
  FaRocket,
  FaSync,
  FaUserCheck,
  FaUserFriends,
  FaUserShield,
  FaUsers,
} from "react-icons/fa";

function itemVisible(item) {
  return item.show !== false;
}

function groupBadge(items) {
  return items.reduce((sum, item) => sum + (Number(item.badge) || 0), 0);
}

function Badge({ value }) {
  if (!value) return null;
  return (
    <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
      {value > 99 ? "99+" : value}
    </span>
  );
}

function MobileRow({ item, onNavigate }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onNavigate(item.to)}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-teal-50/80 dark:hover:bg-white/5"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${item.tone}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium text-gray-900 dark:text-white">{item.label}</span>
      <Badge value={item.badge} />
    </button>
  );
}

function DesktopPill({ item, onNavigate }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onNavigate(item.to)}
      className={`relative inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-110 ${item.tone}`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {item.label}
      {item.badge ? (
        <span className="absolute -right-2 -top-2">
          <Badge value={item.badge} />
        </span>
      ) : null}
    </button>
  );
}

export default function AdminToolsMenu({
  pendingCount = 0,
  pendingFeedbackCount = 0,
  pendingPatrollerCount = 0,
  showRetryCounts = false,
  isFeedbackReviewer = false,
  isPlatformConsoleUser = false,
  isGlobalAppUser = false,
  canOpenResidentPreview = false,
  canOpenHousehold = false,
  canEditEmergencyContacts = false,
  canSendAreaNotice = false,
  onNavigate,
  onRetryCounts,
}) {
  const [openId, setOpenId] = useState("operations");

  const groups = useMemo(() => {
    const operations = [
      {
        id: "incidents",
        label: "Moderate incidents",
        to: "/admin/incidents",
        icon: FaClipboardList,
        tone: "bg-orange-600",
        badge: pendingCount,
      },
      {
        id: "notice",
        label: "Neighbourhood notice",
        to: "/admin/broadcast",
        icon: FaBullhorn,
        tone: "bg-amber-600",
        show: canSendAreaNotice,
      },
      {
        id: "contacts",
        label: "Emergency contacts",
        to: "/admin/contacts",
        icon: FaPhone,
        tone: "bg-blue-800",
        show: canEditEmergencyContacts,
      },
      {
        id: "chat-logs",
        label: "Chat logs",
        to: "/admin/chat",
        icon: FaCommentAlt,
        tone: "bg-teal-600",
      },
      {
        id: "staff-activity",
        label: "NW admin activity",
        to: "/admin/staff-activity",
        icon: FaHistory,
        tone: "bg-slate-600",
        show: isGlobalAppUser,
      },
      {
        id: "feedback",
        label: "Feedback reviews",
        to: "/admin/feedback",
        icon: FaComments,
        tone: "bg-violet-600",
        badge: pendingFeedbackCount,
        show: isFeedbackReviewer,
      },
    ].filter(itemVisible);

    const people = [
      {
        id: "users",
        label: "Manage users",
        to: "/admin/users",
        icon: FaUsers,
        tone: "bg-blue-600",
      },
      {
        id: "residents",
        label: "Residents",
        to: "/admin/residents",
        icon: FaHome,
        tone: "bg-emerald-600",
        badge: pendingPatrollerCount,
      },
      {
        id: "members",
        label: "Patroller member profiles",
        to: "/admin/members",
        icon: FaIdCard,
        tone: "bg-cyan-600",
      },
      {
        id: "resident-profiles",
        label: "Verified resident profiles",
        to: "/admin/resident-profiles",
        icon: FaUserCheck,
        tone: "bg-emerald-800",
      },
      {
        id: "my-household",
        label: "Resident Portal",
        to: "/resident",
        icon: FaUserFriends,
        tone: "bg-teal-700",
        show: canOpenHousehold,
      },
      {
        id: "resident-home",
        label: "View resident home",
        to: "/resident",
        icon: FaUserFriends,
        tone: "bg-fuchsia-600",
        show: canOpenResidentPreview && !canOpenHousehold,
      },
    ].filter(itemVisible);

    const platform = [
      {
        id: "organizations",
        label: "Organizations",
        to: "/admin/organizations",
        icon: FaBuilding,
        tone: "bg-slate-700",
        show: isPlatformConsoleUser,
      },
      {
        id: "billing",
        label: "Billing",
        to: "/admin/billing",
        icon: FaCreditCard,
        tone: "bg-emerald-700",
        show: isPlatformConsoleUser,
      },
      {
        id: "security-memberships",
        label: "Security memberships",
        to: "/admin/security-memberships",
        icon: FaUserShield,
        tone: "bg-indigo-600",
        show: isPlatformConsoleUser || isGlobalAppUser,
      },
      {
        id: "security-insights",
        label: "Security insights",
        to: "/admin/security-insights",
        icon: FaChartLine,
        tone: "bg-blue-700",
        show: isPlatformConsoleUser,
      },
      {
        id: "pilot",
        label: "Pilot readiness",
        to: "/admin/pilot-readiness",
        icon: FaRocket,
        tone: "bg-violet-700",
        show: isPlatformConsoleUser,
      },
    ].filter(itemVisible);

    const reference = [
      {
        id: "roles",
        label: "Role guide",
        to: "/admin/roles",
        icon: FaBook,
        tone: "bg-gray-700",
      },
    ];

    return [
      { id: "operations", title: "Operations", hint: "Daily watch work", items: operations },
      { id: "people", title: "People", hint: "Users and households", items: people },
      { id: "platform", title: "Platform", hint: "Billing and partners", items: platform },
      { id: "reference", title: "Reference", hint: "Guides", items: reference },
    ].filter((group) => group.items.length > 0);
  }, [
    pendingCount,
    pendingFeedbackCount,
    pendingPatrollerCount,
    canSendAreaNotice,
    canEditEmergencyContacts,
    isFeedbackReviewer,
    canOpenResidentPreview,
    canOpenHousehold,
    isPlatformConsoleUser,
    isGlobalAppUser,
  ]);

  const toggle = (id) => {
    setOpenId((current) => (current === id ? "" : id));
  };

  return (
    <div className="mb-8">
      <div className="md:hidden overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-lg ring-1 ring-black/5 dark:border-white/10 dark:bg-gradient-to-b dark:from-gray-800 dark:to-gray-900 dark:ring-white/10">
        {groups.map((group, index) => {
          const open = openId === group.id;
          const badge = groupBadge(group.items);
          return (
            <div
              key={group.id}
              className={index > 0 ? "border-t border-gray-100 dark:border-white/10" : ""}
            >
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold tracking-tight text-gray-900 dark:text-white">
                    {group.title}
                  </span>
                  <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                    {group.hint}
                  </span>
                </span>
                <Badge value={badge} />
                <FaChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-teal-600 transition-transform duration-200 dark:text-teal-400 ${
                    open ? "rotate-180" : ""
                  }`}
                  aria-hidden
                />
              </button>
              {open ? (
                <div className="space-y-0.5 px-2 pb-3">
                  {group.items.map((item) => (
                    <MobileRow key={item.id} item={item} onNavigate={onNavigate} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {showRetryCounts ? (
          <div className="border-t border-gray-100 px-3 py-3 dark:border-white/10">
            <button
              type="button"
              onClick={onRetryCounts}
              className="inline-flex items-center gap-2 rounded-lg bg-yellow-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-600"
            >
              <FaSync className="h-3.5 w-3.5" aria-hidden />
              Retry counts
            </button>
          </div>
        ) : null}
      </div>

      <div className="hidden space-y-5 md:block">
        {groups.map((group) => (
          <section key={group.id}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">
              {group.title}
            </p>
            <div className="flex flex-wrap gap-3">
              {group.items.map((item) => (
                <DesktopPill key={item.id} item={item} onNavigate={onNavigate} />
              ))}
            </div>
          </section>
        ))}
        {showRetryCounts ? (
          <button
            type="button"
            onClick={onRetryCounts}
            className="rounded-lg bg-yellow-500 px-3 py-1 text-sm text-white hover:bg-yellow-600"
          >
            Retry counts
          </button>
        ) : null}
      </div>
    </div>
  );
}
