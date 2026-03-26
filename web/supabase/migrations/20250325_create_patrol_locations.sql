-- Create patrol_locations table for GPS tracking
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
        ON DELETE CASCADE,
    
    -- Indexes for performance
    INDEX idx_patrol_locations_patrol_id (patrol_id),
    INDEX idx_patrol_locations_user_id (user_id),
    INDEX idx_patrol_locations_timestamp (timestamp),
    INDEX idx_patrol_locations_deleted_at (deleted_at)
);

-- Create patrol_locations_archive table for data retention
CREATE TABLE IF NOT EXISTS patrol_locations_archive (
    id UUID PRIMARY KEY,
    patrol_id UUID NOT NULL,
    user_id UUID NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION DEFAULT 0,
    altitude DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    heading DOUBLE PRECISION,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create function to archive old patrol locations
CREATE OR REPLACE FUNCTION archive_old_patrol_locations()
RETURNS void AS $$
DECLARE
    archive_cutoff TIMESTAMPTZ;
    delete_cutoff TIMESTAMPTZ;
BEGIN
    -- Archive locations older than 30 days
    archive_cutoff := NOW() - INTERVAL '30 days';
    
    -- Delete locations older than 90 days
    delete_cutoff := NOW() - INTERVAL '90 days';
    
    -- Archive old locations
    INSERT INTO patrol_locations_archive (
        id, patrol_id, user_id, latitude, longitude, 
        accuracy, altitude, speed, heading, timestamp, 
        created_at, deleted_at
    )
    SELECT 
        id, patrol_id, user_id, latitude, longitude,
        accuracy, altitude, speed, heading, timestamp,
        created_at, deleted_at
    FROM patrol_locations 
    WHERE deleted_at IS NOT NULL 
      AND deleted_at < archive_cutoff;
    
    -- Hard delete archived locations
    DELETE FROM patrol_locations 
    WHERE deleted_at IS NOT NULL 
      AND deleted_at < delete_cutoff;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically set deleted_at when patrol ends
CREATE OR REPLACE FUNCTION mark_patrol_locations_deleted()
RETURNS TRIGGER AS $$
BEGIN
    -- Mark all locations for this patrol as deleted when patrol ends
    UPDATE patrol_locations 
    SET deleted_at = NOW() 
    WHERE patrol_id = OLD.id 
      AND deleted_at IS NULL;
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on active_patrols table
DROP TRIGGER IF EXISTS trigger_mark_locations_deleted ON active_patrols;
CREATE TRIGGER trigger_mark_locations_deleted
    BEFORE DELETE ON active_patrols
    FOR EACH ROW
    EXECUTE FUNCTION mark_patrol_locations_deleted();

-- Enable Row Level Security (RLS)
ALTER TABLE patrol_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_locations_archive ENABLE ROW LEVEL SECURITY;

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

-- Create policies for patrol_locations_archive (read-only)
CREATE POLICY "Users can view their own archived patrol locations" ON patrol_locations_archive
    FOR SELECT
    USING (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON patrol_locations TO authenticated;
GRANT SELECT ON patrol_locations_archive TO authenticated;

-- Grant usage on sequences if they exist
GRANT USAGE ON SCHEMA public TO authenticated;