import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import PageHeader from "../components/layout/PageHeader";
import { useScopedOrganization } from "../utils/organizationScope";

const ACTIVITY_TYPES = [
  "Suspicious Activity",
  "Suspicious Vehicle",
  "Noise Complaint",
  "Other",
];

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function isMissingIncidentColumnError(error) {
  const message = String(error?.message || "");
  return /is_anonymous_tip|legal_acknowledged_at|schema cache/i.test(message);
}

export default function ResidentActivityReport() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganizationId } = useScopedOrganization();
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [form, setForm] = useState({
    type: "Suspicious Activity",
    location: "",
    description: "",
    suspectDescription: "",
    vehicleInfo: "",
    anonymousTip: false,
    legalAccepted: false,
  });

  const attachmentSummary = useMemo(() => {
    if (!attachments.length) return "No files selected";
    return `${attachments.length} file${attachments.length === 1 ? "" : "s"} selected`;
  }, [attachments]);

  const handleAttachmentChange = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length > MAX_ATTACHMENTS) {
      toast.error(`Attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    const invalid = files.find((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"));
    if (invalid) {
      toast.error(`${invalid.name} is not an image/video file.`);
      return;
    }
    const tooLarge = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (tooLarge) {
      toast.error(`${tooLarge.name} is larger than 20MB.`);
      return;
    }
    setAttachments(files);
  };

  const submitReport = async (event) => {
    event.preventDefault();
    if (!user?.id) return;
    if (!form.location.trim() || !form.description.trim()) {
      toast.error("Location and description are required.");
      return;
    }
    if (form.anonymousTip && !form.legalAccepted) {
      toast.error("You must accept the legal notice for anonymous tips.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        incident_date: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
        location: form.location.trim(),
        type: form.type,
        description: form.description.trim(),
        suspect_description: form.suspectDescription.trim() || null,
        vehicle_info: form.vehicleInfo.trim() || null,
        submitted_by: user.id,
        submitted_by_name: form.anonymousTip
          ? "Anonymous resident"
          : user.fullName || user.email || "Resident",
        reporter_id: user.id,
        organization_id: activeOrganizationId || user.organizationId || null,
        status: "pending",
        title: form.type,
      };
      if (form.anonymousTip) {
        payload.is_anonymous_tip = true;
        payload.legal_acknowledged_at = new Date().toISOString();
      }

      let { data: inserted, error } = await supabase.from("incidents").insert(payload).select("id").single();
      if (error && isMissingIncidentColumnError(error) && form.anonymousTip) {
        const fallback = { ...payload };
        delete fallback.is_anonymous_tip;
        delete fallback.legal_acknowledged_at;
        ({ data: inserted, error } = await supabase.from("incidents").insert(fallback).select("id").single());
      }
      if (error || !inserted?.id) throw error || new Error("Could not create report.");

      const uploadedUrls = [];
      if (attachments.length > 0) {
        for (let index = 0; index < attachments.length; index += 1) {
          const file = attachments[index];
          const ext = file.name.split(".").pop() || "bin";
          const safePrefix = file.type.startsWith("video/") ? "video" : "image";
          const filePath = `${inserted.id}/resident_${safePrefix}_${Date.now()}_${index}.${ext}`;

          const { error: uploadErr } = await supabase.storage
            .from("incident-photos")
            .upload(filePath, file);
          if (uploadErr) {
            console.error(uploadErr);
            toast.error(`Could not upload ${file.name}.`);
            continue;
          }
          const { data: publicUrlData } = supabase.storage.from("incident-photos").getPublicUrl(filePath);
          if (publicUrlData?.publicUrl) uploadedUrls.push(publicUrlData.publicUrl);
        }
      }

      if (uploadedUrls.length > 0) {
        const { error: mediaErr } = await supabase
          .from("incidents")
          .update({ media_urls: uploadedUrls })
          .eq("id", inserted.id);
        if (mediaErr) {
          console.warn("Resident activity media update:", mediaErr.message);
        }

        const { error: evidenceErr } = await supabase.from("incident_evidence").insert({
          incident_id: inserted.id,
          category: "scene_photos",
          description: "Resident attachment bundle",
          metadata: {
            source: "resident_activity_report",
            attachment_count: uploadedUrls.length,
          },
          media_urls: uploadedUrls,
          submitted_by: user.id,
        });
        if (evidenceErr) {
          console.warn("Resident activity evidence insert:", evidenceErr.message);
        }
      }

      const { error: timelineErr } = await supabase.from("resident_report_events").insert({
        incident_id: inserted.id,
        reporter_id: user.id,
        event_type: "received",
        title: "Report received",
        details: "Your report has been received and is awaiting assignment.",
        actor_user_id: user.id,
      });
      if (timelineErr) {
        console.warn("Resident report timeline insert:", timelineErr.message);
      }

      toast.success("Suspicious activity report submitted.");
      navigate("/resident/activity");
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not submit suspicious activity report.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-xl p-6 shadow space-y-4">
        <PageHeader
          title="Report suspicious activity"
          subtitle="Resident report channel. Patrollers and admins review and action these submissions."
          backTo="/resident"
          backLabel="Back to resident home"
          className="p-0 shadow-none bg-transparent dark:bg-transparent"
        />

        <section className="rounded-lg border dark:border-gray-700 p-3 bg-sky-50 dark:bg-sky-950/20 text-sm text-sky-900 dark:text-sky-200">
          <p className="font-semibold">When to use this page</p>
          <p className="mt-1">
            Use this for suspicious observations that are not immediate life-threatening emergencies.
            For immediate danger, medical emergency, or active attack, use <strong>SOS</strong>.
          </p>
        </section>

        <form onSubmit={submitReport} className="space-y-3">
          <select
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
            className="w-full border rounded-lg p-2.5 bg-white dark:bg-gray-900 dark:border-gray-700 dark:text-white"
          >
            {ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          <input
            value={form.location}
            onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
            className="w-full border rounded-lg p-2.5 bg-white dark:bg-gray-900 dark:border-gray-700 dark:text-white"
            placeholder="Location"
            required
          />

          <textarea
            rows={4}
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            className="w-full border rounded-lg p-3 bg-white dark:bg-gray-900 dark:border-gray-700 dark:text-white"
            placeholder="What did you observe?"
            required
          />

          <textarea
            rows={2}
            value={form.suspectDescription}
            onChange={(e) => setForm((prev) => ({ ...prev, suspectDescription: e.target.value }))}
            className="w-full border rounded-lg p-3 bg-white dark:bg-gray-900 dark:border-gray-700 dark:text-white"
            placeholder="Optional suspect description"
          />

          <input
            value={form.vehicleInfo}
            onChange={(e) => setForm((prev) => ({ ...prev, vehicleInfo: e.target.value }))}
            className="w-full border rounded-lg p-2.5 bg-white dark:bg-gray-900 dark:border-gray-700 dark:text-white"
            placeholder="Optional vehicle details"
          />

          <div className="rounded-lg border dark:border-gray-700 p-3 space-y-3">
            <div className="flex items-start gap-2">
              <input
                id="anonymous-tip"
                type="checkbox"
                checked={form.anonymousTip}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    anonymousTip: e.target.checked,
                    legalAccepted: e.target.checked ? prev.legalAccepted : false,
                  }))
                }
                className="mt-1"
              />
              <label htmlFor="anonymous-tip" className="text-sm text-gray-700 dark:text-gray-300">
                Submit as anonymous tip (your identity is hidden from standard operational views).
              </label>
            </div>

            {form.anonymousTip ? (
              <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                <p className="font-semibold">Legal notice</p>
                <p>
                  False, misleading, or malicious reports may still be investigated by authorized platform/security
                  administrators under applicable law.
                </p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={form.legalAccepted}
                    onChange={(e) => setForm((prev) => ({ ...prev, legalAccepted: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>I understand and accept this legal notice.</span>
                </label>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border dark:border-gray-700 p-3 space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Attach photos/videos (optional)
            </label>
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleAttachmentChange}
              className="block w-full text-sm text-gray-700 dark:text-gray-300"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Up to {MAX_ATTACHMENTS} files, max 20MB each. Sensitive content is visible to moderation roles only.
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300">{attachmentSummary}</p>
          </div>

          <button disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? "Submitting..." : "Submit activity report"}
          </button>
        </form>
      </div>
    </div>
  );
}
