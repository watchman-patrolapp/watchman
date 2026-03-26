import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: localStorage, // explicitly set (though default)
  },
});

// Evidence management functions
export const evidenceService = {
  // Get all evidence for an incident
  async getEvidenceForIncident(incidentId) {
    const { data, error } = await supabase
      .from('incident_evidence')
      .select(`
        *,
        incident_suspects (
          *
        )
      `)
      .eq('incident_id', incidentId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  // Get evidence by category for an incident
  async getEvidenceByCategory(incidentId, category) {
    const { data, error } = await supabase
      .from('incident_evidence')
      .select('*')
      .eq('incident_id', incidentId)
      .eq('category', category)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  // Add new evidence entry
  async addEvidenceEntry(incidentId, evidenceData) {
    const { data, error } = await supabase
      .from('incident_evidence')
      .insert({
        incident_id: incidentId,
        category: evidenceData.category,
        description: evidenceData.description || '',
        metadata: evidenceData.metadata || {},
        media_urls: evidenceData.media_urls || [],
        submitted_by: evidenceData.submitted_by,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Update evidence entry
  async updateEvidenceEntry(evidenceId, updates) {
    const { data, error } = await supabase
      .from('incident_evidence')
      .update(updates)
      .eq('id', evidenceId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Delete evidence entry
  async deleteEvidenceEntry(evidenceId) {
    const { error } = await supabase
      .from('incident_evidence')
      .delete()
      .eq('id', evidenceId);

    if (error) throw error;
    return true;
  },

  // Add suspect to evidence
  async addSuspectToEvidence(evidenceId, suspectData) {
    const { data, error } = await supabase
      .from('incident_suspects')
      .insert({
        incident_id: suspectData.incident_id,
        evidence_id: evidenceId,
        description: suspectData.description || '',
        estimated_age: suspectData.estimated_age || '',
        clothing_description: suspectData.clothing_description || '',
        distinguishing_features: suspectData.distinguishing_features || '',
        direction_last_seen: suspectData.direction_last_seen || '',
        time_observed: suspectData.time_observed || '',
        photo_urls: suspectData.photo_urls || [],
        linked_incident_ids: suspectData.linked_incident_ids || [],
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Get evidence summary for an incident
  async getEvidenceSummary(incidentId) {
    const { data, error } = await supabase
      .rpc('get_evidence_summary', { incident_id: incidentId });

    if (error) throw error;
    return data;
  }
};
