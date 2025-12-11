import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

import {
  computeEmbedding,
  computeEmbeddingFromUrl,
  computeNorm,
  countTrailingZeros,
  decodeImageToPixels,
  EMBEDDING_SIZE,
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
    
    let embedding: number[] | null = null;
    
    // Handle card_art source - use URL-based embedding (handles WebP)
    if (source === 'card_art' && card_id) {
      const { data: card, error: cardError } = await supabase
        .from('riftbound_cards')
        .select('art_url')
        .eq('card_id', card_id)
        .single();
      
      if (cardError || !card) {
        throw new Error(`Card not found: ${card_id}`);
      }
      
      console.log(`[debug-encode] Loading card art for ${card_id} from ${card.art_url}`);
      embedding = await computeEmbeddingFromUrl(card.art_url);
      
    } else if (training_image_id) {
      const { data: trainingImage, error } = await supabase
        .from('training_images')
        .select('*')
        .eq('id', training_image_id)
        .single();
      
      if (error || !trainingImage) {
        throw new Error(`Training image not found: ${training_image_id}`);
      }
      
      console.log(`[debug-encode] Loading training image ${training_image_id}`);
      embedding = await computeEmbeddingFromUrl(trainingImage.image_url);
      
    } else if (image_data) {
      const base64Match = image_data.match(/^data:image\/\w+;base64,(.+)$/);
      if (base64Match) {
        const imageBytes = Uint8Array.from(atob(base64Match[1]), c => c.charCodeAt(0));
        console.log(`[debug-encode] Loaded base64 image, bytes: ${imageBytes.length}`);
        embedding = await computeEmbedding(imageBytes);
      } else {
        throw new Error('Invalid image_data format');
      }
      
    } else {
      throw new Error('Either image_data, training_image_id, or (source=card_art + card_id) required');
    }
    
    if (!embedding) {
      throw new Error('Failed to compute embedding - image decode failed');
    }
    
    const norm = computeNorm(embedding);
    const trailingZeros = countTrailingZeros(embedding);
    
    return new Response(JSON.stringify({
      dimension: EMBEDDING_SIZE,
      norm: parseFloat(norm.toFixed(6)),
      embedding,
      trailing_zero_count: trailingZeros,
      sample_values: {
        first_10: embedding.slice(0, 10).map(v => parseFloat(v.toFixed(6))),
        last_10: embedding.slice(-10).map(v => parseFloat(v.toFixed(6))),
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[debug-encode] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});