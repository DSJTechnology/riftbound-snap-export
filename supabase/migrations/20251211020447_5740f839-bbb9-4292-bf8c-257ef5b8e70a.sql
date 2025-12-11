-- Create training_images table for storing labeled training data
CREATE TABLE public.training_images (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('scan_confirm', 'scan_correction', 'web_training')),
  image_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  used_in_model BOOLEAN NOT NULL DEFAULT false
);

-- Create index for faster lookups by card_id
CREATE INDEX idx_training_images_card_id ON public.training_images(card_id);

-- Create index for filtering by source
CREATE INDEX idx_training_images_source ON public.training_images(source);

-- Enable Row Level Security
ALTER TABLE public.training_images ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read training images (for training scripts)
CREATE POLICY "Anyone can read training images"
ON public.training_images
FOR SELECT
USING (true);

-- Allow anyone to insert training images (from scanner)
CREATE POLICY "Anyone can insert training images"
ON public.training_images
FOR INSERT
WITH CHECK (true);

-- Allow anyone to update training images (for marking as used)
CREATE POLICY "Anyone can update training images"
ON public.training_images
FOR UPDATE
USING (true);

-- Create storage bucket for training images
INSERT INTO storage.buckets (id, name, public)
VALUES ('training-images', 'training-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for training images bucket
CREATE POLICY "Training images are publicly accessible"
ON storage.objects
FOR SELECT
USING (bucket_id = 'training-images');

CREATE POLICY "Anyone can upload training images"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'training-images');