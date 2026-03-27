-- Simple patrol_locations table creation for GPS tracking
-- This is a minimal version to get the GPS tracking working

CREATE TABLE IF NOT EXISTS patrol_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patrol_id UUID NOT NULL,
    user_id UUID NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION DEFAULT 0,
    altitude DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    heading DOUBLE PRECISION,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    
    -- Foreign key constraints
    CONSTRAINT fk_patrol_locations_patrol_id 
        FOREIGN KEY (patrol_id) 
        REFERENCES active_patrols(id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_patrol_locations_user_id 
        FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_patrol_locations_patrol_id ON patrol_locations(patrol_id);
CREATE INDEX IF NOT EXISTS idx_patrol_locations_user_id ON patrol_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_patrol_locations_timestamp ON patrol_locations(timestamp);

-- Enable Row Level Security (RLS)
ALTER TABLE patrol_locations ENABLE ROW LEVEL SECURITY;

-- Create policies for patrol_locations
CREATE POLICY "Users can view their own patrol locations" ON patrol_locations
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own patrol locations" ON patrol_locations
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own patrol locations" ON patrol_locations
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own patrol locations" ON patrol_locations
    FOR DELETE
    USING (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON patrol_locations TO authenticated;