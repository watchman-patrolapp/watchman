import { FaLightbulb } from "react-icons/fa";
import { funFactsRotationCopy } from "../../utils/leaderboardFunFacts";

export default function FunFactsPanel({ facts, isSelf = true, name }) {
  if (!facts?.length) return null;

  const rotation = funFactsRotationCopy();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
        <FaLightbulb className="text-amber-500" />
        Did you know?
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {isSelf
          ? `From your patrol numbers and the weather you went out in — for fun, not a lab report. ${rotation}`
          : `What stands out in ${name || "this volunteer"}'s log — habits and weather included. ${rotation}`}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {facts.map((fact) => (
          <div
            key={fact.id}
            className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/10 border border-amber-100 dark:border-amber-800/40 p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-1">
              <span className="mr-1.5" aria-hidden>{fact.emoji}</span>
              {fact.kicker}
            </p>
            <p className="font-semibold text-gray-900 dark:text-white">{fact.title}</p>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{fact.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
