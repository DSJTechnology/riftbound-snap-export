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
    const limit = parseInt(url.searchParams.get('limit') || '10');
    
    if (!cardId) {
      throw new Error('card_id query parameter is required');
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    console.log(`[debug-training-images] Fetching images for card: ${cardId}, limit: ${limit}`);
    
    const { data: images, error } = await supabase
      .from('training_images')
      .select('id, image_url, source, created_at')
      .eq('card_id', cardId)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      throw new Error(`Failed to fetch training images: ${error.message}`);
    }
    
    return new Response(JSON.stringify({
      card_id: cardId,
      images: images || [],
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[debug-training-images] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
