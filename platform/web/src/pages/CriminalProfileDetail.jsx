import BrandedLoader from '../components/layout/BrandedLoader';
import PatrollerPhotoPreview from '../components/patrol/PatrollerPhotoPreview';
import ProfileRecordAudit from '../components/intelligence/ProfileRecordAudit';
import { useCriminalProfileDetail } from './criminalProfile/useCriminalProfileDetail';
import ProfileDetailHeader from './criminalProfile/ProfileDetailHeader';
import ProfileStatusBanner from './criminalProfile/ProfileStatusBanner';
import ProfilePhotosSection from './criminalProfile/ProfilePhotosSection';
import ProfilePhysicalSection from './criminalProfile/ProfilePhysicalSection';
import ProfileBasicInfoSection from './criminalProfile/ProfileBasicInfoSection';
import ProfileLocationSection from './criminalProfile/ProfileLocationSection';
import ProfileHistorySection from './criminalProfile/ProfileHistorySection';
import ProfileLinkedIncidentsSection from './criminalProfile/ProfileLinkedIncidentsSection';
import ProfileAssociatesSection from './criminalProfile/ProfileAssociatesSection';
import ProfileFieldGuideModal from './criminalProfile/ProfileFieldGuideModal';

export default function CriminalProfileDetail() {
  const detail = useCriminalProfileDetail();

  if (detail.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <BrandedLoader message="Loading profile…" size="lg" />
      </div>
    );
  }

  if (!detail.profile) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 text-center dark:bg-gray-900">
        <h2 className="mb-4 text-2xl font-bold text-gray-800 dark:text-white">Profile Not Found</h2>
        <button
          onClick={() => detail.navigate(detail.backTarget)}
          className="rounded-lg bg-primary-700 px-4 py-2 text-white hover:bg-primary-800"
        >
          {detail.backLabel}
        </button>
      </div>
    );
  }

  const {
    profile,
    navigate,
    backTarget,
    backLabel,
    buildProfilePath,
    isEditing,
    editForm,
    displayData,
    saving,
    photoUploadsPending,
    fieldGuideTopic,
    setFieldGuideTopic,
    auditUserLabels,
    incidents,
    associates,
    associatesDraft,
    associateSearchQuery,
    setAssociateSearchQuery,
    associateSearchLoading,
    associateSearchResults,
    photoLightbox,
    setPhotoLightbox,
    handleSave,
    handleCancel,
    handleDelete,
    updateField,
    handleEditPhotoSelect,
    removePhotoAtIndex,
    updateArrayField,
    addArrayItem,
    removeArrayItem,
    setWatchlistFlagsForEdit,
    addAssociateFromSearch,
    removeAssociateDraftRow,
    updateAssociateDraftField,
  } = detail;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="mx-auto max-w-6xl p-6">
        <ProfileDetailHeader
          isEditing={isEditing}
          displayName={displayData.primary_name}
          backLabel={backLabel}
          onBack={() => navigate(backTarget)}
          onEdit={() => navigate(buildProfilePath({ edit: true }))}
          onDelete={handleDelete}
          onCancel={handleCancel}
          onSave={handleSave}
          saving={saving}
          photoUploadsPending={photoUploadsPending}
        />

        {profile && (
          <div className="mb-6 max-w-3xl">
            <ProfileRecordAudit profile={profile} userLabelById={auditUserLabels} />
          </div>
        )}

        <ProfileStatusBanner
          isEditing={isEditing}
          editForm={editForm}
          displayData={displayData}
          onUpdateField={updateField}
          onOpenFieldGuide={setFieldGuideTopic}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <ProfilePhotosSection
              isEditing={isEditing}
              displayData={displayData}
              photoUploadsPending={photoUploadsPending}
              onSelectPhotos={handleEditPhotoSelect}
              onRemovePhoto={removePhotoAtIndex}
              onOpenLightbox={setPhotoLightbox}
            />
            <ProfilePhysicalSection
              isEditing={isEditing}
              editForm={editForm}
              displayData={displayData}
              onUpdateField={updateField}
              onUpdateArrayField={updateArrayField}
              onAddArrayItem={addArrayItem}
              onRemoveArrayItem={removeArrayItem}
            />
          </div>

          <div className="lg:col-span-2 space-y-6">
            <ProfileBasicInfoSection
              isEditing={isEditing}
              editForm={editForm}
              displayData={displayData}
              onUpdateField={updateField}
              onUpdateArrayField={updateArrayField}
              onAddArrayItem={addArrayItem}
              onRemoveArrayItem={removeArrayItem}
            />
            <ProfileLocationSection
              isEditing={isEditing}
              editForm={editForm}
              displayData={displayData}
              onUpdateField={updateField}
            />
            <ProfileHistorySection
              isEditing={isEditing}
              editForm={editForm}
              displayData={displayData}
              onUpdateField={updateField}
              onUpdateArrayField={updateArrayField}
              onAddArrayItem={addArrayItem}
              onRemoveArrayItem={removeArrayItem}
              onSetWatchlistFlags={setWatchlistFlagsForEdit}
              onOpenFieldGuide={setFieldGuideTopic}
            />
            <ProfileLinkedIncidentsSection
              incidents={incidents}
              onOpenIncident={(incidentId) => navigate(`/incidents/${incidentId}`)}
            />
            <ProfileAssociatesSection
              isEditing={isEditing}
              associates={associates}
              associatesDraft={associatesDraft}
              associateSearchQuery={associateSearchQuery}
              onAssociateSearchQuery={setAssociateSearchQuery}
              associateSearchLoading={associateSearchLoading}
              associateSearchResults={associateSearchResults}
              onAddAssociate={addAssociateFromSearch}
              onUpdateAssociate={updateAssociateDraftField}
              onRemoveAssociate={removeAssociateDraftRow}
              onOpenProfile={(profileId) => navigate(`/intelligence/profiles/${profileId}`)}
            />
          </div>
        </div>
      </div>

      <ProfileFieldGuideModal
        topic={fieldGuideTopic}
        onClose={() => setFieldGuideTopic(null)}
      />

      <PatrollerPhotoPreview
        key={photoLightbox ? `criminal-photo-${photoLightbox.index}` : 'criminal-photo-closed'}
        open={!!photoLightbox}
        onClose={() => setPhotoLightbox(null)}
        name={displayData.primary_name?.trim() || 'Subject'}
        imageUrls={photoLightbox?.urls}
        initialIndex={photoLightbox?.index ?? 0}
      />
    </div>
  );
}
