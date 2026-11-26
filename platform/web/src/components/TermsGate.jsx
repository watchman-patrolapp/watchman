import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { recordAcceptance, useTermsGateDecision } from "../auth/useTermsGate";
import toast from "../utils/notify";
import {
  REQUIRED_AGREEMENT_LABELS,
  allRequiredAgreementsAccepted,
} from "../utils/termsGate";
import AuthShell from "./layout/AuthShell";

const linkClass = "font-medium text-text-link underline";
const checkboxClass = "mt-1 h-5 w-5 shrink-0";
const labelClass = "flex items-start gap-3 rounded-xl border border-subtle p-3 text-sm text-text-primary";

function TermsAcceptanceScreen({ userId }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [acceptedAge18, setAcceptedAge18] = useState(false);
  const [acceptedPopia, setAcceptedPopia] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const agreed = allRequiredAgreementsAccepted({ acceptedAge18, acceptedPopia, acceptedTerms });

  async function handleAccept() {
    if (!agreed || saving) return;
    setSaving(true);
    try {
      await recordAcceptance(userId, "gate");
    } catch (err) {
      console.warn("Terms: accept_terms", err);
      toast.error("We couldn't save that. Check your connection and try again.");
      setSaving(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut?.();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <AuthShell alignTop>
      <section className="card w-full max-w-lg space-y-4 p-6 sm:p-8" aria-labelledby="terms-gate-title">
        <header className="space-y-1">
          <h2 id="terms-gate-title" className="text-xl font-bold text-text-primary">
            Before you continue
          </h2>
          <p className="text-sm text-text-secondary">
            Please read and accept our Terms of Use and Privacy Policy to use Watchman.
          </p>
        </header>

        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-text-secondary">
          <li>Watchman is for adults only. You must be 18 or older.</li>
          <li>Post only what you saw or know. Don&apos;t accuse anyone without facts, and never identify a child.</li>
          <li>You are responsible for what you post. Moderators can remove content and restrict accounts.</li>
          <li>Use Report in the ⋯ menu for anything harmful. You can block members you don&apos;t want to see.</li>
          <li>In an emergency, call SAPS on 10111 first. Watchman is not an emergency service.</li>
        </ul>

        <p className="text-sm">
          <Link to="/terms" className={linkClass}>
            Read the Terms of Use
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/privacy" className={linkClass}>
            Read the Privacy Policy
          </Link>
        </p>

        <div className="space-y-2">
          <label className={labelClass}>
            <input
              type="checkbox"
              className={checkboxClass}
              checked={acceptedAge18}
              onChange={(e) => setAcceptedAge18(e.target.checked)}
            />
            <span>{REQUIRED_AGREEMENT_LABELS.acceptedAge18}</span>
          </label>
          <label className={labelClass}>
            <input
              type="checkbox"
              className={checkboxClass}
              checked={acceptedPopia}
              onChange={(e) => setAcceptedPopia(e.target.checked)}
            />
            <span>
              {REQUIRED_AGREEMENT_LABELS.acceptedPopia}{" "}
              <Link to="/privacy" className={linkClass}>
                Privacy policy
              </Link>
            </span>
          </label>
          <label className={labelClass}>
            <input
              type="checkbox"
              className={checkboxClass}
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
            />
            <span>
              I accept the{" "}
              <Link to="/terms" className={linkClass}>
                platform terms
              </Link>{" "}
              and community conduct rules.
            </span>
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleAccept}
            disabled={!agreed || saving}
            className="min-h-11 rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Accept and continue"}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="min-h-11 rounded-xl bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            Sign out
          </button>
        </div>
      </section>
    </AuthShell>
  );
}

/**
 * Full-screen Terms of Use / Privacy Policy acceptance after sign-in.
 * Fails open (renders the app) when the profile, the SQL or the network is not there.
 */
export default function TermsGate({ children }) {
  const { userId, decision } = useTermsGateDecision();
  const signupTried = useRef(null);

  // Accepted on the Register form: record it once, silently.
  useEffect(() => {
    if (decision !== "signup" || !userId || signupTried.current === userId) return;
    signupTried.current = userId;
    recordAcceptance(userId, "signup").catch((err) => {
      console.warn("Terms: signup acceptance", err);
    });
  }, [decision, userId]);

  if (decision === "ask" && userId) return <TermsAcceptanceScreen userId={userId} />;
  return children;
}
