import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import {
  FaArrowLeft,
  FaUserSecret,
  FaSearch,
  FaPlusCircle,
  FaClipboardList,
  FaMapMarkerAlt,
  FaChevronRight,
} from 'react-icons/fa';

const PATROLLER_ROUTES = ['admin', 'committee', 'patroller', 'investigator'];
const COMMITTEE_ROUTES = ['admin', 'committee'];

export default function IntelligenceHome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role;

  const canPatrollerIntel = role && PATROLLER_ROUTES.includes(role);
  const canCommitteeIntel = role && COMMITTEE_ROUTES.includes(role);

  if (!canPatrollerIntel) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-gray-600 dark:text-gray-400 text-center max-w-sm">
          You do not have access to intelligence tools.
        </p>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  const cards = [
    {
      id: 'search',
      title: 'Criminal database',
      description: 'Search profiles, filter by risk and status, and open the field guide for terms like MO and watchlist flags.',
      to: '/intelligence/search',
      icon: FaSearch,
      color: 'bg-teal-600',
      show: true,
    },
    {
      id: 'create',
      title: 'New profile',
      description: 'Create a full intelligence record with photos, risk assessment, and modus operandi.',
      to: '/intelligence/profiles/new',
      icon: FaPlusCircle,
      color: 'bg-emerald-600',
      show: true,
    },
    {
      id: 'matches',
      title: 'Match queue',
      description: 'Review suggested links between new incidents and existing profiles; approve or reject for analysts.',
      to: '/intelligence/matches',
      icon: FaClipboardList,
      color: 'bg-amber-600',
      show: canCommitteeIntel,
    },
    {
      id: 'nearby',
      title: 'Nearby threats',
      description: 'High-risk profiles mapped near patrol areas — coming soon; placeholder for future map integration.',
      to: '/intelligence/nearby',
      icon: FaMapMarkerAlt,
      color: 'bg-rose-600',
      show: canCommitteeIntel,
    },
  ].filter((c) => c.show);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950 pb-20">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 transition"
          >
            <FaArrowLeft className="w-3 h-3" />
            Back to dashboard
          </button>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-lg shadow-red-900/20">
              <FaUserSecret className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Intelligence</h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-xl">
                Start here: search the database, add profiles, and (for committee) verify incident matches. Use the{' '}
                <strong className="text-gray-800 dark:text-gray-200">field guide</strong> on the database page for risk
                levels, status, and MO definitions.
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <ul className="space-y-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <li key={card.id}>
                <button
                  type="button"
                  onClick={() => navigate(card.to)}
                  className="w-full text-left flex items-stretch gap-0 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm hover:shadow-md hover:border-teal-300 dark:hover:border-teal-700 transition overflow-hidden group"
                >
                  <div className={`w-1.5 shrink-0 ${card.color}`} aria-hidden />
                  <div className="flex flex-1 items-center gap-4 p-4 min-w-0">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${card.color}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-semibold text-gray-900 dark:text-white group-hover:text-teal-600 dark:group-hover:text-teal-400 transition">
                        {card.title}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{card.description}</p>
                    </div>
                    <FaChevronRight className="w-4 h-4 shrink-0 text-gray-300 dark:text-gray-600 group-hover:text-teal-500 transition" />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
