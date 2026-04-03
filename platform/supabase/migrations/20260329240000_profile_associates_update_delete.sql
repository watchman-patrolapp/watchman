-- Allow staff to correct relationship type and remove mistaken links
CREATE POLICY "Enable update for authenticated users" ON profile_associates
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users" ON profile_associates
  FOR DELETE
  USING (auth.role() = 'authenticated');
