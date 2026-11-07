import React from 'react';
import { FaUserSecret, FaExclamationTriangle } from 'react-icons/fa';
import StructuredEvidenceList, { EVIDENCE_CATEGORY_ORDER } from '../../evidence/StructuredEvidenceList';
import IncidentSectionPanel from '../IncidentSectionPanel';
import {
  INCIDENT_SECTION_LABELS,
  evidenceCategoryToSectionKey,
} from '../../../constants/incidentSectionUpdates';
import LinkedProfileLinkCard from './LinkedProfileLinkCard';

export function EvidenceTab({
  displayEvidence,
  legacyUrlsForScene,
  updatesBySection,
  canAddUpdates,
  navigate,
  setUpdateModal,
  handleMigrateLegacyScenePhotos,
  migrateLegacyBusy,
}) {
  return (
    <div className="space-y-8 rounded-xl border-2 border-gray-300 bg-white p-6 shadow-sm dark:border-gray-600 dark:bg-gray-800">
      {EVIDENCE_CATEGORY_ORDER.map((categoryId) => {
        const sectionKey = evidenceCategoryToSectionKey(categoryId);
        const label = INCIDENT_SECTION_LABELS[sectionKey];
        const emptyFallback = categoryId === 'scene_photos' ? legacyUrlsForScene : [];
        const allSectionUpdates = updatesBySection[sectionKey] || [];
        const sectionWideUpdates = allSectionUpdates.filter((u) => !u.target_evidence_id);
        return (
          <IncidentSectionPanel
            key={sectionKey}
            label={label}
            originalChildren={
              <StructuredEvidenceList
                items={displayEvidence}
                emptyFallbackUrls={emptyFallback}
                categoryFilter={categoryId}
                suppressCategoryHeading
                onOpenLinkedProfile={(profileId) =>
                  navigate(`/intelligence/profiles/${profileId}`)
                }
                incidentSectionUpdates={allSectionUpdates}
                canAddEntryUpdates={canAddUpdates}
                onAddEntryUpdate={
                  canAddUpdates
                    ? (evidenceId, entryLabel) =>
                        setUpdateModal({
                          key: sectionKey,
                          label,
                          targetEvidenceId: evidenceId,
                          entryHint: entryLabel,
                        })
                    : undefined
                }
                onMigrateLegacyPhotos={
                  canAddUpdates ? handleMigrateLegacyScenePhotos : undefined
                }
                migrateLegacyBusy={migrateLegacyBusy}
              />
            }
            updates={sectionWideUpdates}
            canAdd={canAddUpdates}
            onAddClick={() =>
              setUpdateModal({
                key: sectionKey,
                label,
                targetEvidenceId: undefined,
                entryHint: undefined,
              })
            }
          />
        );
      })}
    </div>
  );
}

export function IntelligenceTab({
  linkedProfiles,
  linkedProfilesForDisplay,
  navigate,
  id,
  profileUserLabelById,
}) {
  return (
    <div className="space-y-6">
      {linkedProfiles.length === 0 ? (
        <div className="text-center py-12">
          <FaUserSecret className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No Linked Profiles
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            This incident is not linked to any criminal profiles yet.
          </p>
          <button 
            onClick={() => navigate(`/incident/${id}/edit`)}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition"
          >
            Link Suspect to Profile
          </button>
        </div>
      ) : (
        <>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-2">
              <FaExclamationTriangle />
              Intelligence Summary
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              {linkedProfiles.length} suspect(s) linked to this incident with varying confidence levels.
              Review profiles for modus operandi patterns and associate networks.
            </p>
          </div>

          {linkedProfilesForDisplay.map((link) => (
            <LinkedProfileLinkCard
              key={link.id}
              link={link}
              navigate={navigate}
              userLabelById={profileUserLabelById}
            />
          ))}
        </>
      )}
    </div>
  );
}
