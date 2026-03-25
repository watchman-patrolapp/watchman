import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";

export default function SOPFlashcards() {
  const { user, refreshUser } = useAuth(); // ✅ use refreshUser
  const navigate = useNavigate();
  const [sop, setSop] = useState(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    async function loadSOP() {
      try {
        const { data, error } = await supabase
          .from('sop_versions')
          .select('*')
          .eq('active', true)
          .single();

        if (error) {
          console.error("Error loading SOP:", error);
          return;
        }
        if (!data) {
          console.error("No active SOP document found");
          return;
        }
        setSop(data);
      } catch (err) {
        console.error("Error loading SOP:", err);
      } finally {
        setLoading(false);
      }
    }
    loadSOP();
  }, []);

  const handleNext = () => {
    if (index < sop.cards.length - 1) setIndex(index + 1);
  };

  const handlePrev = () => {
    if (index > 0) setIndex(index - 1);
  };

  const handleAccept = async () => {
    if (!user) return;
    setAccepting(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({
          sop_version_accepted: sop.version,
          sop_accepted_at: new Date(),
        })
        .eq('id', user.id);

      if (error) throw error;

      // Refresh user profile to get updated sop_version_accepted
      await refreshUser();

      // Navigate to dashboard directly
      navigate("/dashboard");
    } catch (err) {
      console.error("Acceptance failed:", err);
      alert(`Failed to record acceptance: ${err.message}`);
    } finally {
      setAccepting(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading SOP…</div>;
  if (!sop) return <div className="min-h-screen flex items-center justify-center text-red-600">SOP not available. Please contact admin.</div>;

  const card = sop.cards[index];

  return (
    <div className="min-h-screen flex flex-col bg-gray-100 p-4">
      <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full">
        <div className="bg-white rounded-xl shadow p-6 mb-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">{card.title}</h2>
            <span className="text-sm text-gray-500">
              {index + 1} / {sop.cards.length}
            </span>
          </div>

          <p className="text-sm text-gray-600 mb-6 bg-gray-50 p-3 rounded">
            {card.scenario}
          </p>

          <div className="mb-6">
            <h3 className="font-semibold text-green-700 mb-2">✓ DO</h3>
            <ul className="list-disc ml-6 space-y-1">
              {card.do.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-red-700 mb-2">✗ DO NOT</h3>
            <ul className="list-disc ml-6 space-y-1">
              {card.doNot.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex justify-between items-center mt-4">
          <button
            onClick={handlePrev}
            disabled={index === 0}
            className="px-4 py-2 bg-gray-300 text-gray-800 rounded disabled:opacity-50 hover:bg-gray-400 transition"
          >
            ← Back
          </button>

          {index < sop.cards.length - 1 ? (
            <button
              onClick={handleNext}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
            >
              Next →
            </button>
          ) : (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="w-4 h-4"
                />
                I have read and understand the SOP
              </label>
              <button
                onClick={handleAccept}
                disabled={!acknowledged || accepting}
                className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition disabled:opacity-50"
              >
                {accepting ? "Accepting..." : "Accept & Continue"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}