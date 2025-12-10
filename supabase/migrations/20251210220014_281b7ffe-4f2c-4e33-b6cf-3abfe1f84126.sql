-- Add embedding column to store MobileNet feature vectors
ALTER TABLE public.riftbound_cards
ADD COLUMN IF NOT EXISTS embedding jsonb;