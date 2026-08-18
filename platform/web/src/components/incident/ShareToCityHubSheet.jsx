import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaTimes } from "react-icons/fa";
import toast from "react-hot-toast";
import { supabase } from "../../supabase/client";
import {
  CITY_HUB_SHARE_POST_TYPES,
  buildCityHubShareDraft,
  publishIncidentToCityHub,
} from "../../utils/cityHubShare";

export default function ShareToCityHubSheet({
  open,
  onClose,
  incident,
  organizationName,
  organizationId,
  userId,
  linkedProfiles: linkedProfilesProp,
  incidentSuspects: incidentSuspectsProp,
  onShared,
}) {
  const navigate = useNavigate();
  const [linkedProfiles, setLinkedProfiles] = useState(linkedProfilesProp || []);
  const [incidentSuspects, setIncidentSuspects] = useState(incidentSuspectsProp || []);
  const [type, setType] = useState("general");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [includeProfile, setIncludeProfile] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(false);

  const draft = useMemo(
    () =>
      buildCityHubShareDraft({
        incident,
        organizationName,
        linkedProfiles,
        incidentSuspects,
      }),
    [incident, organizationName, linkedProfiles, incidentSuspects]
  );

  useEffect(() => {
    if (!open || !incident?.id) return undefined;
    let cancelled = false;

    setConfirmed(false);
    setBusy(false);

    const hydrate = async () => {
      const needsProfiles = linkedProfilesProp == null;
      const needsSuspects = incidentSuspectsProp == null;
      if (!needsProfiles && !needsSuspects) {
        setLinkedProfiles(linkedProfilesProp || []);
        setIncidentSuspects(incidentSuspectsProp || []);
        return;
      }
      setHydrating(true);
      try {
        const [profileResult, suspectResult] = await Promise.all([
          needsProfiles
            ? supabase
                .from("profile_incidents")
                .select("profile_id, profile:profile_id (id, primary_name)")
                .eq("incident_id", incident.id)
            : Promise.resolve({ data: linkedProfilesProp, error: null }),
          needsSuspects
            ? supabase.from("incident_suspects").select("id").eq("incident_id", incident.id)
            : Promise.resolve({ data: incidentSuspectsProp, error: null }),
        ]);
        if (cancelled) return;
        if (!profileResult.error) setLinkedProfiles(profileResult.data || []);
        if (!suspectResult.error) setIncidentSuspects(suspectResult.data || []);
      } catch (err) {
        console.warn("City Hub share hydrate:", err);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [open, incident?.id, linkedProfilesProp, incidentSuspectsProp]);

  useEffect(() => {
    if (!open) return;
    setType(draft.type);
    setTitle(draft.title);
    setContent(draft.content);
    const firstProfile = draft.profileOptions[0]?.id || "";
    setProfileId(firstProfile);
    setIncludeProfile(Boolean(firstProfile));
    setConfirmed(false);
  }, [open, draft]);

  if (!open || !incident) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!confirmed) {
      toast.error("Confirm that you have reviewed this summary first.");
      return;
    }
    if (!title.trim() || !content.trim()) {
      toast.error("Title and content are required.");
      return;
    }
    setBusy(true);
    try {
      const post = await publishIncidentToCityHub({
        incidentId: incident.id,
        organizationId,
        userId,
        type,
        title: title.trim(),
        content: content.trim(),
        relatedProfileId: includeProfile ? profileId || null : null,
      });
      toast.success("Shared to City Hub.");
      onShared?.(post);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not share to City Hub.");
      if (err.alreadyShared) {
        onShared?.(err.existing || null);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="city-hub-share-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-600 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
          <div>
            <h2 id="city-hub-share-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              Share to City Hub
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Other neighborhoods will see this. Review the summary before publishing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close"
            disabled={busy}
          >
            <FaTimes />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="px-4 py-3 overflow-y-auto flex-1 min-h-0 space-y-3">
            <p className="text-xs text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              Prefill excludes reporter name, witnesses, street address, photos, anonymous-tip source, and SAPS numbers.
            </p>

            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Post type
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="input border w-full mt-1"
                disabled={busy || hydrating}
              >
                {CITY_HUB_SHARE_POST_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Title
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input border w-full mt-1"
                required
                disabled={busy || hydrating}
              />
            </label>

            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Summary
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
                className="w-full mt-1 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-y min-h-[160px]"
                required
                disabled={busy || hydrating}
              />
            </label>

            {draft.profileOptions.length > 0 ? (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={includeProfile}
                    onChange={(e) => setIncludeProfile(e.target.checked)}
                    disabled={busy}
                  />
                  <span>Include linked intelligence profile</span>
                </label>
                {includeProfile && draft.profileOptions.length > 1 ? (
                  <select
                    value={profileId}
                    onChange={(e) => setProfileId(e.target.value)}
                    className="input border w-full"
                    disabled={busy}
                  >
                    {draft.profileOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : includeProfile && draft.profileOptions[0] ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{draft.profileOptions[0].label}</p>
                ) : null}
              </div>
            ) : null}

            <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy}
              />
              <span>I have reviewed this summary and want to publish it city-wide.</span>
            </label>
          </div>

          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => navigate("/city-hub")}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              disabled={busy}
            >
              Open City Hub
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || hydrating || !confirmed || !title.trim() || !content.trim()}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Publishing…" : "Publish to City Hub"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
