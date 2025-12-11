import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

import {
  decodeImageToPixels,
  cropToArtRegion,
  resizeImage,
  pixelsToBMP,
  computePixelStats,
  OUTPUT_SIZE,
} from "../_shared/imageDecoder.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_data, training_image_id, source, card_id } = await req.json();
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    let imageBytes: Uint8Array;
    let resolvedCardId: string | null = null;
    let originalImageUrl: string | null = null;
    
    // Handle card_art source
    if (source === 'card_art' && card_id) {
      resolvedCardId = card_id;
      
      // Get card from database
      const { data: card, error: cardError } = await supabase
        .from('riftbound_cards')
        .select('art_url')
        .eq('card_id', card_id)
        .single();
      
      if (cardError || !card) {
        throw new Error(`Card not found: ${card_id}`);
      }
      
      originalImageUrl = card.art_url;
      
      // Fetch the card art image
      const response = await fetch(card.art_url);
      if (!response.ok) throw new Error(`Failed to fetch card art: ${response.status}`);
      
      const buffer = await response.arrayBuffer();
      imageBytes = new Uint8Array(buffer);
      
    } else if (training_image_id) {
      // Load from training images table
      const { data: trainingImage, error } = await supabase
        .from('training_images')
        .select('*')
        .eq('id', training_image_id)
        .single();
      
      if (error || !trainingImage) {
        throw new Error(`Training image not found: ${training_image_id}`);
      }
      
      resolvedCardId = trainingImage.card_id;
      originalImageUrl = trainingImage.image_url;
      
      // Fetch the image
      const response = await fetch(trainingImage.image_url);
      if (!response.ok) throw new Error('Failed to fetch training image');
      
      const buffer = await response.arrayBuffer();
      imageBytes = new Uint8Array(buffer);
      
    } else if (image_data) {
      // Parse base64 data URL
      const base64Match = image_data.match(/^data:image\/\w+;base64,(.+)$/);
      if (base64Match) {
        const base64 = base64Match[1];
        imageBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      } else {
        throw new Error('Invalid image_data format');
      }
    } else {
      throw new Error('Either image_data, training_image_id, or (source=card_art + card_id) required');
    }
    
    console.log(`[debug-preprocess] Processing image, bytes: ${imageBytes.length}`);
    
    // Decode image to proper RGBA pixels
    const decoded = await decodeImageToPixels(imageBytes);
    if (!decoded) {
      throw new Error('Failed to decode image - unsupported format or corrupted');
    }
    
    console.log(`[debug-preprocess] Decoded: ${decoded.width}x${decoded.height}`);
    
    // Crop to art region
    const art = cropToArtRegion(decoded.pixels, decoded.width, decoded.height);
    console.log(`[debug-preprocess] Art region: ${art.width}x${art.height}`);
    
    // Resize to output size (this is the pre-normalized RGB image)
    const resized = resizeImage(art.pixels, art.width, art.height);
    
    // Compute stats on the resized image
    const stats = computePixelStats(resized);
    
    // Create preview as BMP image from the resized RGB
    const previewBmp = pixelsToBMP(resized, OUTPUT_SIZE, OUTPUT_SIZE);
    
    return new Response(JSON.stringify({
      card_id: resolvedCardId,
      original_image_url: originalImageUrl,
      preprocessed_preview: `data:image/bmp;base64,${previewBmp}`,
      width: OUTPUT_SIZE,
      height: OUTPUT_SIZE,
      stats: {
        min_pixel: parseFloat(stats.min.toFixed(4)),
        max_pixel: parseFloat(stats.max.toFixed(4)),
        mean_pixel_value: parseFloat(stats.mean.toFixed(4)),
        std_pixel_value: parseFloat(stats.std.toFixed(4)),
        channels: 3,
        has_detected_card_region: true,
        card_region_bbox: art.bbox,
        original_dimensions: [decoded.width, decoded.height],
        art_dimensions: [art.width, art.height],
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[debug-preprocess] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
