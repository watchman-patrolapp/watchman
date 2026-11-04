import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import PageHeader from "../components/layout/PageHeader";
import ResidentSosControl from "../components/resident/ResidentSosControl";
import { useScopedOrganization } from "../utils/organizationScope";

export default function ResidentSos() {
  const { user } = useAuth();
  const { activeOrganizationId } = useScopedOrganization();
  const [notes, setNotes] = useState("");
  const organizationId = activeOrganizationId || user?.organizationId || null;

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="mx-auto max-w-2xl space-y-4 rounded-xl bg-white p-6 shadow dark:bg-gray-800">
        <PageHeader
          title="Emergency SOS"
          subtitle="Use this only when immediate assistance is required. Your location (if available) is included."
          backTo="/resident"
          backLabel="Back to resident home"
          className="p-0 shadow-none bg-transparent dark:bg-transparent"
        />

        <ResidentSosControl user={user} organizationId={organizationId} notes={notes} />

        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="w-full rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          rows={4}
          placeholder="Optional details (example: intruder at gate, medical emergency, fire)"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Hold the SOS button for two seconds. You then have five seconds to cancel, or press SOS
          again to send now. Optional notes above are sent with the alert.
        </p>
      </div>
    </div>
  );
}
