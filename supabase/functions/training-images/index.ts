import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const cardId = url.searchParams.get('card_id');
    const source = url.searchParams.get('source');
    const usedInModel = url.searchParams.get('used_in_model');
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    let query = supabase
      .from('training_images')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (cardId) {
      query = query.eq('card_id', cardId);
    }

    if (source) {
      query = query.eq('source', source);
    }

    if (usedInModel !== null) {
      query = query.eq('used_in_model', usedInModel === 'true');
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('[training-images] Query error:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get stats if no filters applied
    let stats = null;
    if (!cardId && !source && !usedInModel) {
      const { data: statsData } = await supabase
        .from('training_images')
        .select('source')
        .then(async (res) => {
          if (res.error) return { data: null };
          
          const counts = {
            scan_confirm: 0,
            scan_correction: 0,
            web_training: 0,
            total: res.data?.length || 0,
          };
          
          res.data?.forEach((row: any) => {
            if (row.source in counts) {
              counts[row.source as keyof typeof counts]++;
            }
          });
          
          return { data: counts };
        });
      
      stats = statsData;
    }

    return new Response(
      JSON.stringify({ 
        images: data,
        total: count,
        limit,
        offset,
        stats,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[training-images] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
