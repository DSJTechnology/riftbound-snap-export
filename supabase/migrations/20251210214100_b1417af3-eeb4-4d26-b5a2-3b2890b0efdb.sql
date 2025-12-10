-- Create riftbound_cards table to store card data and precomputed hashes
CREATE TABLE public.riftbound_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  set_name TEXT,
  rarity TEXT,
  art_url TEXT,
  hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS (but allow public read access since cards are public data)
ALTER TABLE public.riftbound_cards ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read cards (public data)
CREATE POLICY "Cards are publicly readable"
ON public.riftbound_cards
FOR SELECT
TO anon, authenticated
USING (true);

-- Create storage bucket for card images
INSERT INTO storage.buckets (id, name, public)
VALUES ('riftbound-cards', 'riftbound-cards', true);

-- Allow public read access to card images
CREATE POLICY "Card images are publicly accessible"
ON storage.objects
FOR SELECT
USING (bucket_id = 'riftbound-cards');

-- Allow edge functions to upload images (using service role)
CREATE POLICY "Service role can upload card images"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'riftbound-cards');

CREATE POLICY "Service role can update card images"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'riftbound-cards');

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_riftbound_cards_updated_at
BEFORE UPDATE ON public.riftbound_cards
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();