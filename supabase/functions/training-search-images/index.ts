import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ImageResult {
  thumbnailUrl: string;
  originalUrl: string;
  title: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const cardId = url.searchParams.get('card_id');
    const cardName = url.searchParams.get('card_name');

    if (!cardId && !cardName) {
      return new Response(
        JSON.stringify({ error: 'Missing card_id or card_name parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Look up card name from DB if only card_id provided
    let searchName = cardName;
    if (!searchName && cardId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { data: card } = await supabase
        .from('riftbound_cards')
        .select('name')
        .eq('card_id', cardId)
        .maybeSingle();

      if (card) {
        searchName = card.name;
      } else {
        searchName = cardId; // Fall back to using card_id as search term
      }
    }

    // Get API keys from environment
    const googleApiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const searchEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');

    if (!googleApiKey || !searchEngineId) {
      console.warn('[training-search-images] Google Search API not configured');
      return new Response(
        JSON.stringify({ 
          error: 'Image search API not configured. Please set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID.',
          results: [] 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Try multiple search queries to find images
    const searchQueries = [
      `"${searchName}" riftbound card`,
      `${searchName} riftbound tcg`,
      `${searchName} trading card game`,
      `${searchName} card game art`,
    ];

    const allResults: ImageResult[] = [];
    const seenUrls = new Set<string>();

    for (const searchQuery of searchQueries) {
      if (allResults.length >= 15) break; // Stop if we have enough results
      
      console.log(`[training-search-images] Searching for: ${searchQuery}`);

      // Call Google Custom Search API
      const googleUrl = new URL('https://www.googleapis.com/customsearch/v1');
      googleUrl.searchParams.set('key', googleApiKey);
      googleUrl.searchParams.set('cx', searchEngineId);
      googleUrl.searchParams.set('q', searchQuery);
      googleUrl.searchParams.set('searchType', 'image');
      googleUrl.searchParams.set('num', '10');
      googleUrl.searchParams.set('safe', 'active');

      try {
        const googleResponse = await fetch(googleUrl.toString());
        const googleData = await googleResponse.json();

        console.log(`[training-search-images] Google response status: ${googleResponse.status}, items: ${googleData.items?.length || 0}, searchInfo:`, googleData.searchInformation);

        if (!googleResponse.ok) {
          console.error('[training-search-images] Google API error:', googleData);
          continue; // Try next query
        }

        if (!googleData.items || googleData.items.length === 0) {
          console.log(`[training-search-images] No items in response. Full response keys:`, Object.keys(googleData));
        }

        // Parse and deduplicate results
        for (const item of googleData.items || []) {
          const url = item.link;
          if (!seenUrls.has(url)) {
            seenUrls.add(url);
            allResults.push({
              thumbnailUrl: item.image?.thumbnailLink || url,
              originalUrl: url,
              title: item.title || 'Unknown',
            });
          }
        }
      } catch (err) {
        console.error(`[training-search-images] Error with query "${searchQuery}":`, err);
      }
    }

    const results = allResults.slice(0, 20); // Limit to 20 results

    console.log(`[training-search-images] Found ${results.length} images for "${searchName}"`);

    return new Response(
      JSON.stringify({ results, card_name: searchName }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[training-search-images] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
