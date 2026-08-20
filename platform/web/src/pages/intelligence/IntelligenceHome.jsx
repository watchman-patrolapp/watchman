import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import {
  FaArrowLeft,
  FaUserSecret,
  FaSearch,
  FaPlusCircle,
  FaFire,
  FaPhone,
  FaChevronRight,
} from 'react-icons/fa';
import ThemeToggle from '../../components/ThemeToggle';
import {
  canViewIntelligence,
} from '../../auth/roleMatrix';

export default function IntelligenceHome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canMemberIntel = canViewIntelligence(user?.role);

  if (!canMemberIntel) {
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
      id: 'hotspots',
      title: 'Hotspots',
      description: 'Break-ins and cable / infrastructure theft on the map, hot zones, travel paths, and camera suggestions.',
      to: '/hotspots',
      icon: FaFire,
      color: 'bg-red-600',
      show: true,
    },
    {
      id: 'contacts',
      title: 'Emergency contacts',
      description: 'Police, ambulance, fire, electrical, and registered security companies with logos and control-room numbers.',
      to: '/intelligence/contacts',
      icon: FaPhone,
      color: 'bg-blue-700',
      show: true,
    },
  ].filter((c) => c.show);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950 pb-20">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/90">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm text-gray-600 transition dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            <FaArrowLeft className="h-3 w-3" />
            Back to dashboard
          </button>
          <ThemeToggle variant="toolbar" />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-lg shadow-red-900/20">
            <FaUserSecret className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Intelligence</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-xl">
              Start here: search the database, add profiles, and map break-in hotspots. Link known suspects on the
              incident report when you already have a profile. Use the{' '}
              <strong className="text-gray-800 dark:text-gray-200">field guide</strong> on the database page for risk
              levels, status, and MO definitions. Nearby high-risk sightings already surface on the patrol dashboard
              when you are on duty.
            </p>
          </div>
        </div>
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
