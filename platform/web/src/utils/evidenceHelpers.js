import { supabase } from '../supabase/client';

/** Max images attached to a single evidence entry on the incident report form */
export const MAX_IMAGES_PER_EVIDENCE_ENTRY = 10;

export const generateEntryId = () => {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const validateEvidenceEntry = (entry) => {
  if (!entry) return { valid: false, error: 'Invalid entry' };

  const hasFiles = (entry.files?.length ?? 0) > 0;
  const hasUrls = (entry.media_urls?.length ?? 0) > 0;
  if (!entry.description?.trim() && !hasFiles && !hasUrls) {
    return { valid: false, error: 'Add a short description and/or at least one photo' };
  }

  if (entry.files?.length > MAX_IMAGES_PER_EVIDENCE_ENTRY) {
    return {
      valid: false,
      error: `Maximum ${MAX_IMAGES_PER_EVIDENCE_ENTRY} images allowed per entry`,
    };
  }
  
  // All files must be images
  const invalidFile = entry.files?.find(f => !f.type?.startsWith('image/'));
  if (invalidFile) {
    return { valid: false, error: `${invalidFile.name} is not a valid image` };
  }
  
  return { valid: true, error: null };
};

export const formatEvidenceForSubmit = (evidence, incidentId, userId) => {
  const records = [];
  
  Object.entries(evidence).forEach(([category, entries]) => {
    entries.forEach(entry => {
      const hasFiles = entry.files && entry.files.length > 0;
      const hasUrls = entry.media_urls && entry.media_urls.length > 0;
      if (!entry.description?.trim() && !hasFiles && !hasUrls) {
        return;
      }
      
      records.push({
        incident_id: incidentId,
        category: category,
        description: entry.description,
        metadata: entry.metadata || {},
        media_urls: [], // Will be populated after upload
        submitted_by: userId
      });
    });
  });
  
  return records;
};

export const uploadEvidenceFiles = async (supabase, incidentId, entryId, files) => {
  const urls = [];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}_${i}.${fileExt}`;
    const filePath = `${incidentId}/${entryId}/${fileName}`;
    
    try {
      const { error: uploadError } = await supabase.storage
        .from('incident-photos')
        .upload(filePath, file);
        
      if (uploadError) {
        console.error(`Upload failed for ${file.name}:`, uploadError);
        continue;
      }

      const { data: urlData } = supabase.storage
        .from('incident-photos')
        .getPublicUrl(filePath);
        
      urls.push(urlData.publicUrl);
    } catch (err) {
      console.error(`Error uploading ${file.name}:`, err);
    }
  }
  
  return urls;
};

export const groupEvidenceByCategory = (evidenceArray) => {
  return evidenceArray.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});
};

export const getEvidenceStats = (evidence) => {
  let totalEntries = 0;
  let totalImages = 0;
  
  Object.values(evidence).forEach(entries => {
    totalEntries += entries.length;
    entries.forEach(entry => {
      totalImages += entry.files?.length || 0;
    });
  });
  
  return { totalEntries, totalImages };
};

// AI MATCHING FUNCTIONS (heuristic — not facial recognition)
export const analyzeEvidenceForMatches = async (evidenceEntry, incidentData) => {
  const type = incidentData?.type;
  if (!type || !String(type).trim()) return [];

  const { data: potentialMatches, error } = await supabase.from('criminal_profiles').select('*').limit(40);

  if (error || !potentialMatches?.length) return [];

  const matches = potentialMatches
    .map((profile) => {
      const mo = profile.mo_signature || {};
      const targets = Array.isArray(mo.target_types) ? mo.target_types : [];
      const methods = Array.isArray(mo.methods) ? mo.methods : [];
      const typeHit = targets.includes(type) || methods.includes(type);
      if (!typeHit) return null;

      let confidence = 0.65;
      if (
        evidenceEntry.metadata?.timeObserved &&
        Array.isArray(mo.time_patterns) &&
        mo.time_patterns.some((t) => String(evidenceEntry.metadata.timeObserved).includes(String(t)))
      ) {
        confidence += 0.1;
      }
      if (profile.last_seen_location && profile.last_seen_location === incidentData.location) {
        confidence += 0.15;
      }

      return {
        profile_id: profile.id,
        profile,
        confidence: Math.min(confidence, 0.95),
        reason: `Incident type “${type}” overlaps profile MO (targets / methods)`,
      };
    })
    .filter(Boolean)
    .filter((m) => m.confidence > 0.6);

  return matches;
};

export const createMatchQueueEntries = async (matches, incidentId, evidenceId) => {
  if (!evidenceId) {
    console.warn('createMatchQueueEntries: missing incident_evidence id (FK); skipping queue insert');
    return;
  }
  const entries = matches.map(match => ({
    source_type: 'ai_mo',
    source_incident_id: incidentId,
    source_evidence_id: evidenceId,
    suggested_profile_id: match.profile_id,
    match_confidence: match.confidence,
    match_reason: match.reason,
    status: 'pending'
  }));
  
  const { error } = await supabase
    .from('profile_match_queue')
    .insert(entries);
    
  if (error) console.error('Error creating match queue:', error);
};
