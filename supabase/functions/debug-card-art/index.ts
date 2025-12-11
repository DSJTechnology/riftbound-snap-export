import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const cardId = url.searchParams.get('card_id');
    
    if (!cardId) {
      throw new Error('card_id query parameter is required');
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    console.log(`[debug-card-art] Fetching card art for: ${cardId}`);
    
    // Get card from database
    const { data: card, error: cardError } = await supabase
      .from('riftbound_cards')
      .select('card_id, name, art_url, embedding')
      .eq('card_id', cardId.toUpperCase())
      .single();
    
    if (cardError || !card) {
      throw new Error(`Card not found: ${cardId}`);
    }
    
    // Return card art info in the same format as training images
    return new Response(JSON.stringify({
      card_id: card.card_id,
      art_url: card.art_url,
      has_embedding: !!card.embedding,
      images: [
        {
          id: `${card.card_id}-art`,
          image_url: card.art_url,
          source: 'card_art',
          card_name: card.name,
        }
      ]
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[debug-card-art] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
