import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";

export default function SOPFlashcards() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [sop, setSop] = useState(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [popiaAck, setPopiaAck] = useState(false);
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

      await refreshUser();

      navigate("/dashboard");
    } catch (err) {
      console.error("Acceptance failed:", err);
      alert(`Failed to record acceptance: ${err.message}`);
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <BrandedLoader message="Loading SOP…" size="lg" />
      </div>
    );
  }
  if (!sop) return <div className="min-h-screen flex items-center justify-center text-red-600">SOP not available. Please contact admin.</div>;

  const card = sop.cards[index];
  const isLast = index === sop.cards.length - 1;
  const hasDo = Array.isArray(card.do) && card.do.length > 0;
  const hasDoNot = Array.isArray(card.doNot) && card.doNot.length > 0;

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 dark:bg-gray-900 p-4">
      <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full">
        <header className="mb-3">
          <div className="flex justify-end mb-2">
            <ThemeToggle variant="toolbar" />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-bold text-slate-800 dark:text-gray-100">Standard Operating Procedures</h1>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
              Neighbourhood watch rules, POPIA-aligned use of personal information, and patroller boundaries (version {sop.version}).
            </p>
          </div>
        </header>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-slate-200/80 dark:border-gray-700 p-6 mb-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-slate-900 dark:text-gray-100 pr-2">{card.title}</h2>
            <span className="text-sm text-slate-500 dark:text-gray-400 shrink-0">
              {index + 1} / {sop.cards.length}
            </span>
          </div>

          <p className="text-sm text-slate-600 dark:text-gray-300 mb-6 bg-slate-50 dark:bg-gray-900/50 p-3 rounded-lg border border-slate-100 dark:border-gray-700 leading-relaxed">
            {card.scenario}
          </p>

          {hasDo && (
            <div className="mb-6">
              <h3 className="font-semibold text-emerald-800 dark:text-emerald-300 mb-2">✓ DO</h3>
              <ul className="list-disc ml-6 space-y-1.5 text-slate-700 dark:text-gray-300 text-sm">
                {card.do.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {hasDoNot && (
            <div>
              <h3 className="font-semibold text-red-800 dark:text-red-300 mb-2">✗ DO NOT</h3>
              <ul className="list-disc ml-6 space-y-1.5 text-slate-700 dark:text-gray-300 text-sm">
                {card.doNot.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mt-2">
          <button
            type="button"
            onClick={handlePrev}
            disabled={index === 0}
            className="px-4 py-2 bg-slate-200 dark:bg-gray-700 text-slate-800 dark:text-gray-200 rounded-lg disabled:opacity-50 hover:bg-slate-300 dark:hover:bg-gray-600 transition text-sm font-medium"
          >
            ← Back
          </button>

          {!isLast ? (
            <button
              type="button"
              onClick={handleNext}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium sm:ml-auto"
            >
              Next →
            </button>
          ) : (
            <div className="flex flex-col gap-3 w-full sm:items-end sm:max-w-md sm:ml-auto">
              <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="w-4 h-4 mt-0.5 shrink-0"
                />
                <span>I have read and understand this Standard Operating Procedure.</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={popiaAck}
                  onChange={(e) => setPopiaAck(e.target.checked)}
                  className="w-4 h-4 mt-0.5 shrink-0"
                />
                <span>
                  I acknowledge that personal information (including contact details, addresses, photos, and patrol data)
                  is processed for neighbourhood watch purposes as described above, in line with POPIA principles
                  (lawfulness, minimality, security, and purpose limitation).
                </span>
              </label>
              <button
                type="button"
                onClick={handleAccept}
                disabled={!acknowledged || !popiaAck || accepting}
                className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 text-sm font-semibold w-full sm:w-auto"
              >
                {accepting ? "Accepting…" : "Accept & continue"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
