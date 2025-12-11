import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

import {
  computeEmbedding,
  computeNorm,
  countTrailingZeros,
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
    
    let imageBytes: Uint8Array;
    
    // Handle card_art source
    if (source === 'card_art' && card_id) {
      // Get card from database
      const { data: card, error: cardError } = await supabase
        .from('riftbound_cards')
        .select('art_url')
        .eq('card_id', card_id)
        .single();
      
      if (cardError || !card) {
        throw new Error(`Card not found: ${card_id}`);
      }
      
      const response = await fetch(card.art_url);
      if (!response.ok) throw new Error(`Failed to fetch card art: ${response.status}`);
      
      const buffer = await response.arrayBuffer();
      imageBytes = new Uint8Array(buffer);
      console.log(`[debug-encode] Loaded card art for ${card_id}, bytes: ${imageBytes.length}`);
      
    } else if (training_image_id) {
      const { data: trainingImage, error } = await supabase
        .from('training_images')
        .select('*')
        .eq('id', training_image_id)
        .single();
      
      if (error || !trainingImage) {
        throw new Error(`Training image not found: ${training_image_id}`);
      }
      
      const response = await fetch(trainingImage.image_url);
      if (!response.ok) throw new Error('Failed to fetch training image');
      
      const buffer = await response.arrayBuffer();
      imageBytes = new Uint8Array(buffer);
      console.log(`[debug-encode] Loaded training image ${training_image_id}, bytes: ${imageBytes.length}`);
      
    } else if (image_data) {
      const base64Match = image_data.match(/^data:image\/\w+;base64,(.+)$/);
      if (base64Match) {
        imageBytes = Uint8Array.from(atob(base64Match[1]), c => c.charCodeAt(0));
      } else {
        throw new Error('Invalid image_data format');
      }
      console.log(`[debug-encode] Loaded base64 image, bytes: ${imageBytes.length}`);
      
    } else {
      throw new Error('Either image_data, training_image_id, or (source=card_art + card_id) required');
    }
    
    // Use shared embedding pipeline
    const embedding = await computeEmbedding(imageBytes);
    
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
