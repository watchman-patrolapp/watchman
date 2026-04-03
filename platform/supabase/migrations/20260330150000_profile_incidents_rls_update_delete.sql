-- profile_incidents had only SELECT + INSERT; upsert and unlink deletes need UPDATE/DELETE or changes never persist.
CREATE POLICY "Enable update for authenticated users" ON public.profile_incidents
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users" ON public.profile_incidents
  FOR DELETE
  USING (auth.role() = 'authenticated');
