-- Allow anyone to update riftbound_cards embeddings (for admin rebuild)
CREATE POLICY "Anyone can update riftbound_cards" 
ON public.riftbound_cards 
FOR UPDATE 
USING (true)
WITH CHECK (true);