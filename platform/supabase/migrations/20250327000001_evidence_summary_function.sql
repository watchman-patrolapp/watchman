-- Migration: Add evidence summary function for structured evidence system
-- This function provides a summary of evidence for an incident

-- Create function to get evidence summary
CREATE OR REPLACE FUNCTION get_evidence_summary(incident_id uuid)
RETURNS TABLE (
    total_entries bigint,
    total_files bigint,
    categories jsonb,
    scene_photos_count bigint,
    suspects_count bigint,
    vehicles_count bigint,
    physical_evidence_count bigint,
    documentation_count bigint,
    contextual_intel_count bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::bigint as total_entries,
        COALESCE(SUM(array_length(ie.media_urls, 1)), 0)::bigint as total_files,
        jsonb_object_agg(
            ie.category, 
            COUNT(*)::bigint
        ) FILTER (WHERE ie.category IS NOT NULL) as categories,
        COUNT(*) FILTER (WHERE ie.category = 'scene_photos')::bigint as scene_photos_count,
        COUNT(*) FILTER (WHERE ie.category = 'suspects')::bigint as suspects_count,
        COUNT(*) FILTER (WHERE ie.category = 'vehicles')::bigint as vehicles_count,
        COUNT(*) FILTER (WHERE ie.category = 'physical_evidence')::bigint as physical_evidence_count,
        COUNT(*) FILTER (WHERE ie.category = 'documentation')::bigint as documentation_count,
        COUNT(*) FILTER (WHERE ie.category = 'contextual_intel')::bigint as contextual_intel_count
    FROM incident_evidence ie
    WHERE ie.incident_id = get_evidence_summary.incident_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_evidence_summary(uuid) TO authenticated;

-- Create index for better performance on evidence queries
CREATE INDEX IF NOT EXISTS idx_incident_evidence_incident_category 
ON incident_evidence(incident_id, category, created_at);

-- Add comments for documentation
COMMENT ON FUNCTION get_evidence_summary(uuid) IS 'Returns a summary of evidence entries for a given incident, including counts by category and total file counts';