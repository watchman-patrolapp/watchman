-- Feedback read/update: technical_support only (admin/committee use other tools; UI route matches).

DROP POLICY IF EXISTS "feedback_select_staff" ON public.feedback;
CREATE POLICY "feedback_select_technical_support" ON public.feedback
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(cu.role::text)) = 'technical_support'
    )
  );

DROP POLICY IF EXISTS "feedback_update_staff" ON public.feedback;
CREATE POLICY "feedback_update_technical_support" ON public.feedback
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(cu.role::text)) = 'technical_support'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(cu.role::text)) = 'technical_support'
    )
  );
