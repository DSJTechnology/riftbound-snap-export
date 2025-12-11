-- Create table for storing scan feedback samples for future training/calibration
CREATE TABLE public.card_scan_samples (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id TEXT NOT NULL,
  visual_embedding JSONB,
  ocr_text TEXT,
  ocr_confidence REAL,
  visual_score REAL,
  combined_score REAL,
  was_correct BOOLEAN DEFAULT true,
  user_corrected_to TEXT,
  scan_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS but allow public inserts for anonymous feedback capture
ALTER TABLE public.card_scan_samples ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert samples (anonymous feedback capture)
CREATE POLICY "Anyone can insert scan samples"
ON public.card_scan_samples
FOR INSERT
WITH CHECK (true);

-- Allow reading for analysis (could restrict to admin later)
CREATE POLICY "Anyone can read scan samples"
ON public.card_scan_samples
FOR SELECT
USING (true);

-- Add index for analysis queries
CREATE INDEX idx_card_scan_samples_card_id ON public.card_scan_samples(card_id);
CREATE INDEX idx_card_scan_samples_timestamp ON public.card_scan_samples(scan_timestamp DESC);