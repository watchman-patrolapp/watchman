import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase/client';

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
      // 1. Create profile from suspect evidence metadata
      const profileData = {
        primary_name: evidenceData.description?.substring(0, 50) || 'Unknown Subject',
        mo_signature: {
          target_types: [incidentId.type],
          time_patterns: evidenceData.metadata?.timeObserved ? [evidenceData.metadata.timeObserved] : [],
          entry_methods: []
        },
        first_identified_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        last_seen_location: incidentId.location,
        created_by: (await supabase.auth.getUser()).data.user.id
      };
      
      const { data: profile, error: profileError } = await supabase
        .from('criminal_profiles')
        .insert(profileData)
        .select()
        .single();
      
      if (profileError) throw profileError;
      
      // 2. Link to incident
      await supabase.from('profile_incidents').insert({
        profile_id: profile.id,
        incident_id: incidentId,
        connection_type: 'probable_suspect',
        confidence_score: 75,
        linked_by: (await supabase.auth.getUser()).data.user.id
      });
      
      // 3. Add geographic data
      await supabase.from('profile_geography').insert({
        profile_id: profile.id,
        location_name: incidentId.location,
        location_type: 'crime_scene',
        incident_ids: [incidentId],
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString()
      });
      
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
    mutationFn: async ({ matchId, profileId, incidentId }) => {
      // Update match queue
      await supabase
        .from('profile_match_queue')
        .update({ status: 'confirmed', reviewed_at: new Date().toISOString() })
        .eq('id', matchId);
      
      // Create profile-incident link
      const { data, error } = await supabase
        .from('profile_incidents')
        .insert({
          profile_id: profileId,
          incident_id: incidentId,
          connection_type: 'probable_suspect',
          confidence_score: 85,
          evidence_strength: 'moderate'
        })
        .select();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['match-suggestions']);
      queryClient.invalidateQueries(['profile-incidents']);
    }
  });
};