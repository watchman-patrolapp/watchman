import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase/client';
import { matchQueueConfidenceToScore } from '../utils/intelligenceConfidence';

export const useCriminalProfile = (profileId) => {
  return useQuery({
    queryKey: ['criminal-profile', profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('criminal_profiles')
        .select('*')
        .eq('id', profileId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!profileId
  });
};

export const useProfileIncidents = (profileId) => {
  return useQuery({
    queryKey: ['profile-incidents', profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profile_incidents')
        .select(`
          *,
          incidents (*)
        `)
        .eq('profile_id', profileId)
        .order('linked_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!profileId
  });
};

export const useProfileNetwork = (profileId) => {
  return useQuery({
    queryKey: ['profile-network', profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profile_associates')
        .select(`
          *,
          profile:associate_profile_id (*)
        `)
        .eq('profile_id', profileId);
      
      if (error) throw error;
      return data;
    },
    enabled: !!profileId
  });
};

export const useMatchSuggestions = (incidentId) => {
  return useQuery({
    queryKey: ['match-suggestions', incidentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profile_match_queue')
        .select(`
          *,
          profile:suggested_profile_id (*)
        `)
        .eq('source_incident_id', incidentId)
        .eq('status', 'pending')
        .order('match_confidence', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!incidentId
  });
};

export const useCreateProfileFromEvidence = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ evidenceData, incidentId }) => {
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id;
      const inc = typeof incidentId === 'object' && incidentId !== null ? incidentId : null;
      const incidentUuid = inc?.id ?? incidentId;

      // 1. Create profile from suspect evidence metadata
      const profileData = {
        primary_name: evidenceData.description?.substring(0, 50) || 'Unknown Subject',
        mo_signature: {
          target_types: inc?.type ? [inc.type] : [],
          time_patterns: evidenceData.metadata?.timeObserved ? [evidenceData.metadata.timeObserved] : [],
          entry_methods: []
        },
        first_identified_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        last_seen_location: inc?.location ?? null,
        created_by: uid
      };
      
      const { data: profile, error: profileError } = await supabase
        .from('criminal_profiles')
        .insert(profileData)
        .select()
        .single();
      
      if (profileError) throw profileError;
      
      // 2. Link to incident — no invented MO %; analyst can set score when reviewing
      const linkRow = {
        profile_id: profile.id,
        incident_id: incidentUuid,
        connection_type: 'probable_suspect',
        linked_by: uid
      };
      const { error: linkError } = await supabase.from('profile_incidents').insert(linkRow);
      if (linkError) throw linkError;
      
      // 3. Add geographic data
      if (inc?.location) {
        await supabase.from('profile_geography').insert({
          profile_id: profile.id,
          location_name: inc.location,
          location_type: 'crime_scene',
          incident_ids: [incidentUuid],
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString()
        });
      }
      
      return profile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['criminal-profiles']);
    }
  });
};

export const useConfirmMatch = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ matchId, profileId, incidentId, evidenceStrength = 'moderate' }) => {
      const { data: authData } = await supabase.auth.getUser();
      const reviewerId = authData?.user?.id ?? null;

      const { data: queueRow, error: queueFetchError } = await supabase
        .from('profile_match_queue')
        .select('match_confidence, match_reason')
        .eq('id', matchId)
        .single();

      if (queueFetchError) throw queueFetchError;

      const confidenceScore = matchQueueConfidenceToScore(queueRow?.match_confidence);

      const { error: queueUpdateError } = await supabase
        .from('profile_match_queue')
        .update({
          status: 'confirmed',
          reviewed_at: new Date().toISOString(),
          reviewed_by: reviewerId
        })
        .eq('id', matchId);

      if (queueUpdateError) throw queueUpdateError;

      const insertPayload = {
        profile_id: profileId,
        incident_id: incidentId,
        connection_type: 'probable_suspect',
        linked_by: reviewerId,
        evidence_strength: evidenceStrength
      };
      if (confidenceScore != null) insertPayload.confidence_score = confidenceScore;

      const { data, error } = await supabase
        .from('profile_incidents')
        .insert(insertPayload)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['match-suggestions']);
      queryClient.invalidateQueries(['profile-incidents']);
      queryClient.invalidateQueries(['criminal-profiles']);
    }
  });
};