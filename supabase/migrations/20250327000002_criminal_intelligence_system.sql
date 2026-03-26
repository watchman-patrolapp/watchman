-- CRIMINAL PROFILES MASTER TABLE
CREATE TABLE criminal_profiles (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    primary_name text NOT NULL,
    date_of_birth date,
    place_of_birth text,
    nationality text[],
    gender text CHECK (gender IN ('male', 'female', 'unknown', 'other')),
    height_cm integer,
    weight_kg integer,
    build_type text CHECK (build_type IN ('slim', 'medium', 'heavy', 'muscular', 'athletic', 'unknown')),
    eye_color text,
    hair_color text,
    complexion text,
    distinguishing_marks text[],
    photo_urls text[],
    risk_level text CHECK (risk_level IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
    status text CHECK (status IN ('active', 'incarcerated', 'deceased', 'unknown', 'cleared', 'wanted')) DEFAULT 'unknown',
    priority text CHECK (priority IN ('routine', 'priority', 'urgent', 'immediate')) DEFAULT 'routine',
    watchlist_flags text[],
    mo_signature jsonb DEFAULT '{"entry_methods": [], "weapons_used": [], "target_types": [], "time_patterns": [], "day_of_week": [], "disguise_used": false, "getaway_methods": [], "communication_methods": [], "geographic_pattern": null, "violence_level": "none"}'::jsonb,
    known_aliases text[],
    id_numbers jsonb DEFAULT '{}',
    first_identified_at timestamptz,
    last_seen_at timestamptz,
    last_seen_location text,
    last_seen_coordinates point,
    gang_affiliation text,
    criminal_organization text,
    created_by text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- PROFILE-INCIDENT LINKS WITH CONFIDENCE SCORING
CREATE TABLE profile_incidents (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id uuid REFERENCES criminal_profiles(id) ON DELETE CASCADE,
    incident_id uuid REFERENCES incidents(id) ON DELETE CASCADE,
    connection_type text CHECK (connection_type IN ('confirmed_perpetrator', 'probable_suspect', 'person_of_interest', 'witness', 'associate_present', 'victim', 'false_positive')) DEFAULT 'person_of_interest',
    confidence_score integer CHECK (confidence_score BETWEEN 1 AND 100),
    evidence_strength text CHECK (evidence_strength IN ('circumstantial', 'moderate', 'strong', 'conclusive')),
    linked_by text,
    linked_at timestamptz DEFAULT now(),
    verified_by text,
    verified_at timestamptz,
    verification_notes text,
    evidence_ids uuid[],
    UNIQUE(profile_id, incident_id)
);

-- ASSOCIATE NETWORK (Social Network Analysis)
CREATE TABLE profile_associates (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id uuid REFERENCES criminal_profiles(id) ON DELETE CASCADE,
    associate_profile_id uuid REFERENCES criminal_profiles(id) ON DELETE CASCADE,
    relationship_type text CHECK (relationship_type IN ('family_parent', 'family_child', 'family_sibling', 'family_spouse', 'gang_member', 'gang_leader', 'gang_recruit', 'accomplice', 'coordinator', 'lookout', 'driver', 'associate', 'friend', 'romantic_partner', 'employer', 'employee', 'client', 'supplier', 'neighbor', 'cellmate', 'unknown')),
    relationship_strength text CHECK (relationship_strength IN ('suspected', 'weak', 'moderate', 'strong', 'confirmed')),
    evidence_incident_ids uuid[],
    evidence_description text,
    first_observed_at timestamptz,
    last_observed_at timestamptz,
    is_active boolean DEFAULT true,
    UNIQUE(profile_id, associate_profile_id)
);

-- GEOGRAPHIC ACTIVITY TRACKING
CREATE TABLE profile_geography (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id uuid REFERENCES criminal_profiles(id) ON DELETE CASCADE,
    location_name text NOT NULL,
    location_type text CHECK (location_type IN ('residence', 'workplace', 'frequented_location', 'crime_scene', 'sighting', 'associate_location', 'arrest_location', 'court')),
    coordinates point,
    address text,
    city text,
    province text,
    first_seen_at timestamptz,
    last_seen_at timestamptz,
    visit_count integer DEFAULT 1,
    incident_ids uuid[],
    created_by text,
    created_at timestamptz DEFAULT now()
);

-- INTELLIGENCE NOTES (OSINT/HUMINT)
CREATE TABLE profile_intelligence (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id uuid REFERENCES criminal_profiles(id) ON DELETE CASCADE,
    source_type text CHECK (source_type IN ('osint', 'humint', 'sigint', 'imint', 'geo_int', 'investigation', 'informant', 'public_record', 'surveillance', 'interview', 'financial_record')),
    intelligence_type text CHECK (intelligence_type IN ('observation', 'communication', 'financial_activity', 'travel_movement', 'associates_meeting', 'threat_assessment', 'employment', 'residence_change', 'vehicle_acquisition')),
    content text NOT NULL,
    source_reliability integer CHECK (source_reliability BETWEEN 1 AND 6),
    content_accuracy integer CHECK (content_accuracy BETWEEN 1 AND 6),
    reported_by text,
    handler_notes text,
    valid_until timestamptz,
    created_at timestamptz DEFAULT now()
);

-- MODUS OPERANDI PATTERN HISTORY
CREATE TABLE mo_pattern_history (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id uuid REFERENCES criminal_profiles(id) ON DELETE CASCADE,
    pattern_type text CHECK (pattern_type IN ('entry_method', 'weapon_used', 'disguise', 'getaway_method', 'target_selection', 'time_of_day', 'day_of_week', 'communication_method', 'geographic_area', 'seasonal_pattern')),
    pattern_value text NOT NULL,
    frequency integer DEFAULT 1,
    confidence_score decimal(3,2),
    first_observed timestamptz,
    last_observed timestamptz,
    related_incidents uuid[],
    created_at timestamptz DEFAULT now()
);

-- AI MATCH QUEUE (For facial recognition & pattern matching)
CREATE TABLE profile_match_queue (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    source_type text CHECK (source_type IN ('ai_facial', 'ai_mo', 'manual_review', 'pattern_match')),
    source_incident_id uuid REFERENCES incidents(id),
    source_evidence_id uuid REFERENCES incident_evidence(id),
    suggested_profile_id uuid REFERENCES criminal_profiles(id),
    match_confidence decimal(3,2),
    match_reason text,
    status text CHECK (status IN ('pending', 'confirmed', 'rejected', 'under_review')) DEFAULT 'pending',
    reviewed_by text,
    reviewed_at timestamptz,
    review_notes text,
    created_at timestamptz DEFAULT now()
);

-- INDEXES
CREATE INDEX idx_profiles_risk ON criminal_profiles(risk_level, status);
CREATE INDEX idx_profiles_priority ON criminal_profiles(priority) WHERE status = 'wanted';
CREATE INDEX idx_profiles_names ON criminal_profiles USING gin(primary_name gin_trgm_ops);
CREATE INDEX idx_profiles_aliases ON criminal_profiles USING gin(known_aliases);
CREATE INDEX idx_profile_incidents_profile ON profile_incidents(profile_id);
CREATE INDEX idx_profile_incidents_incident ON profile_incidents(incident_id);
CREATE INDEX idx_profile_incidents_confidence ON profile_incidents(confidence_score DESC);
CREATE INDEX idx_associates_network ON profile_associates(profile_id, associate_profile_id);
CREATE INDEX idx_geography_profile ON profile_geography(profile_id);
CREATE INDEX idx_geography_coords ON profile_geography USING gist(coordinates);
CREATE INDEX idx_intelligence_profile ON profile_intelligence(profile_id);
CREATE INDEX idx_match_queue_status ON profile_match_queue(status, match_confidence DESC);

-- RLS
ALTER TABLE criminal_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_associates ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_geography ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE mo_pattern_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_match_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON criminal_profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert for authenticated users" ON criminal_profiles FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Enable update for creators or admins" ON criminal_profiles FOR UPDATE USING (auth.uid()::text = created_by OR auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Enable read access for authenticated users" ON profile_incidents FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert for authenticated users" ON profile_incidents FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable read access for authenticated users" ON profile_associates FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert for authenticated users" ON profile_associates FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable read access for authenticated users" ON profile_geography FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert for authenticated users" ON profile_geography FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable read access for authenticated users" ON profile_intelligence FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert for authenticated users" ON profile_intelligence FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable read access for authenticated users" ON profile_match_queue FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Enable update for authenticated users" ON profile_match_queue FOR UPDATE USING (auth.role() = 'authenticated');

COMMENT ON TABLE criminal_profiles IS 'Master criminal entity with INTERPOL-style nominal data and MO signatures';
COMMENT ON TABLE profile_match_queue IS 'AI-generated match suggestions pending analyst verification';