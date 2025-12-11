import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

import {
  computeEmbedding,
  computeNorm,
  countTrailingZeros,
  cosineSimilarity,
  dotProduct,
  EMBEDDING_SIZE,
} from "../_shared/imageDecoder.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ImageInput {
  source?: 'training' | 'card_art';
  training_image_id?: string;
  card_id?: string;
  image_data?: string;
}

async function loadImageBytes(supabase: any, input: ImageInput): Promise<Uint8Array> {
  // Handle card_art source
  if (input.source === 'card_art' && input.card_id) {
    const { data: card, error: cardError } = await supabase
      .from('riftbound_cards')
      .select('art_url')
      .eq('card_id', input.card_id)
      .single();
    
    if (cardError || !card) {
      throw new Error(`Card not found: ${input.card_id}`);
    }
    
    const response = await fetch(card.art_url);
    if (!response.ok) throw new Error(`Failed to fetch card art: ${response.status}`);
    
    const buffer = await response.arrayBuffer();
    console.log(`[debug-compare] Loaded card art for ${input.card_id}`);
    return new Uint8Array(buffer);
  }
  
  // Handle training image
  if (input.training_image_id) {
    const { data: trainingImage, error } = await supabase
      .from('training_images')
      .select('*')
      .eq('id', input.training_image_id)
      .single();
    
    if (error || !trainingImage) {
      throw new Error(`Training image not found: ${input.training_image_id}`);
    }
    
    const response = await fetch(trainingImage.image_url);
    if (!response.ok) throw new Error('Failed to fetch training image');
    
    const buffer = await response.arrayBuffer();
    console.log(`[debug-compare] Loaded training image ${input.training_image_id}`);
    return new Uint8Array(buffer);
  }
  
  // Handle base64 image data
  if (input.image_data) {
    const base64Match = input.image_data.match(/^data:image\/\w+;base64,(.+)$/);
    if (base64Match) {
      console.log(`[debug-compare] Loaded base64 image`);
      return Uint8Array.from(atob(base64Match[1]), c => c.charCodeAt(0));
    }
    throw new Error('Invalid image_data format');
  }
  
  throw new Error('Either training_image_id, (source=card_art + card_id), or image_data required');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image1, image2 } = await req.json();
    
    if (!image1 || !image2) {
      throw new Error('Both image1 and image2 are required');
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    console.log(`[debug-compare] Loading images...`);
    
    const [bytes1, bytes2] = await Promise.all([
      loadImageBytes(supabase, image1),
      loadImageBytes(supabase, image2),
    ]);
    
    console.log(`[debug-compare] Encoding images...`);
    
    const [embedding1, embedding2] = await Promise.all([
      computeEmbedding(bytes1),
      computeEmbedding(bytes2),
    ]);
    
    if (!embedding1 || !embedding2) {
      throw new Error('Failed to compute embeddings - image decode failed');
    }
    
    const cosine = cosineSimilarity(embedding1, embedding2);
    const dot = dotProduct(embedding1, embedding2);
    
    return new Response(JSON.stringify({
      embedding1: {
        norm: parseFloat(computeNorm(embedding1).toFixed(6)),
        dimension: EMBEDDING_SIZE,
        trailing_zero_count: countTrailingZeros(embedding1),
      },
      embedding2: {
        norm: parseFloat(computeNorm(embedding2).toFixed(6)),
        dimension: EMBEDDING_SIZE,
        trailing_zero_count: countTrailingZeros(embedding2),
      },
      cosine_similarity: parseFloat(cosine.toFixed(6)),
      dot_product: parseFloat(dot.toFixed(6)),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[debug-compare] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
