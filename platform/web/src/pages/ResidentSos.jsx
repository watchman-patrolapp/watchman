import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../auth/useAuth";
import PageHeader from "../components/layout/PageHeader";
import SosHoldButton from "../components/resident/SosHoldButton";
import { useScopedOrganization } from "../utils/organizationScope";
import { triggerResidentSos } from "../utils/residentSos";

export default function ResidentSos() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganizationId } = useScopedOrganization();
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");

  const triggerSos = async () => {
    if (!user?.id) return;
    if (loading) return;
    const organizationId = activeOrganizationId || user.organizationId;
    if (!organizationId) {
      toast.error("Select or join a neighbourhood before sending an SOS.");
      return;
    }
    setLoading(true);
    try {
      await triggerResidentSos({
        user,
        organizationId,
        notes,
        triggerType: "hold",
      });
      toast.success("SOS sent. Patrollers and admins have been notified.");
      navigate("/chat");
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not trigger SOS.");
    } finally {
      setLoading(false);
    }
  };

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

        <SosHoldButton onTrigger={triggerSos} busy={loading} />

        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="w-full rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          rows={4}
          placeholder="Optional details (example: intruder at gate, medical emergency, fire)"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Hold the SOS button for two seconds. Optional notes above are sent with the alert.
        </p>
      </div>
    </div>
  );
}
