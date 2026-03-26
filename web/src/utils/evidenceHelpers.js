export const generateEntryId = () => {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const validateEvidenceEntry = (entry) => {
  if (!entry) return { valid: false, error: 'Invalid entry' };
  
  // Must have description if files exist
  if (entry.files?.length > 0 && !entry.description?.trim()) {
    return { valid: false, error: 'Description required when images are attached' };
  }
  
  // Max 3 files per entry
  if (entry.files?.length > 3) {
    return { valid: false, error: 'Maximum 3 images allowed per entry' };
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
      // Skip empty entries
      if (!entry.description?.trim() && (!entry.files || entry.files.length === 0)) {
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

// AI MATCHING FUNCTIONS
export const analyzeEvidenceForMatches = async (evidenceEntry, incidentData) => {
  // This would call your AI/ML service or database similarity search
  // For now, we'll query for similar MO patterns
  
  const { data: potentialMatches, error } = await supabase
    .from('criminal_profiles')
    .select('*')
    .contains('mo_signature->target_types', [incidentData.type])
    .limit(5);
  
  if (error) return [];
  
  // Calculate simple confidence based on metadata overlap
  const matches = potentialMatches.map(profile => {
    let confidence = 0.5; // Base confidence
    
    // Boost if time pattern matches
    if (evidenceEntry.metadata?.timeObserved && 
        profile.mo_signature?.time_patterns?.some(t => 
          evidenceEntry.metadata.timeObserved.includes(t)
        )) {
      confidence += 0.2;
    }
    
    // Boost if location proximity (simplified)
    if (profile.last_seen_location === incidentData.location) {
      confidence += 0.3;
    }
    
    return {
      profile_id: profile.id,
      profile: profile,
      confidence: Math.min(confidence, 0.95),
      reason: `MO Pattern Match: ${profile.mo_signature?.target_types?.join(', ')}`
    };
  }).filter(m => m.confidence > 0.6);
  
  return matches;
};

export const createMatchQueueEntries = async (matches, incidentId, evidenceId) => {
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
