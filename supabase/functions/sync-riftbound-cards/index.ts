import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 25; // Increased since we're not computing embeddings anymore

interface DotGGCard {
  id: string;
  name: string;
  set_name: string;
  rarity: string | null;
  image: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { offset = 0, setName, cardId } = await req.json().catch(() => ({}));
    console.log(`[sync] Starting at offset ${offset}, setName: ${setName || 'all'}, cardId: ${cardId || 'none'}`);
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // Fetch cards from dotGG API
    const apiResponse = await fetch('https://api.dotgg.gg/cgfw/getcards?game=riftbound&mode=indexed');
    if (!apiResponse.ok) throw new Error(`API error: ${apiResponse.status}`);
    
    const apiData = await apiResponse.json();
    const names = apiData.names as string[];
    const idIndex = names.indexOf('id');
    const nameIndex = names.indexOf('name');
    const setNameIndex = names.indexOf('set_name');
    const rarityIndex = names.indexOf('rarity');
    const imageIndex = names.indexOf('image');
    
    let allCards: DotGGCard[] = [];
    for (const row of apiData.data) {
      if (!Array.isArray(row)) continue;
      const rowCardId = row[idIndex];
      const name = row[nameIndex];
      if (rowCardId && name) {
        allCards.push({
          id: String(rowCardId).trim().toUpperCase(),
          name: String(name).trim(),
          set_name: setNameIndex !== -1 && row[setNameIndex] ? String(row[setNameIndex]).trim() : 'Unknown',
          rarity: rarityIndex !== -1 && row[rarityIndex] ? String(row[rarityIndex]).trim() : null,
          image: imageIndex !== -1 && row[imageIndex] ? row[imageIndex] : `https://static.dotgg.gg/riftbound/cards/${rowCardId}.webp`,
        });
      }
    }
    
    // Filter by cardId (single card refresh)
    if (cardId) {
      allCards = allCards.filter(c => c.id === cardId.toUpperCase());
      console.log(`[sync] Filtered to single card: ${cardId}, found: ${allCards.length}`);
    }
    // Filter by set name
    else if (setName) {
      allCards = allCards.filter(c => c.set_name === setName);
      console.log(`[sync] Filtered to set "${setName}", found: ${allCards.length} cards`);
    }
    
    const cards = allCards.slice(offset, offset + BATCH_SIZE);
    console.log(`[sync] Processing ${cards.length} cards (${offset}-${offset + cards.length} of ${allCards.length})`);
    
    let processed = 0;
    let failed = 0;
    
    for (const card of cards) {
      try {
        const imageUrl = card.image || `https://static.dotgg.gg/riftbound/cards/${card.id}.webp`;
        
        // Get public URL for the card art (assuming it's already in storage or will be)
        const { data: publicUrlData } = supabase.storage.from('riftbound-cards').getPublicUrl(`${card.id}.webp`);
        
        // Upsert to database - NO embedding computation
        // Embeddings will be computed client-side via the Embedding Admin page
        const { error } = await supabase.from('riftbound_cards').upsert({
          card_id: card.id,
          name: card.name,
          set_name: card.set_name,
          rarity: card.rarity,
          art_url: imageUrl, // Use the original DotGG URL directly
          // embedding: null - Don't set this, leave existing embeddings intact
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'card_id',
        });
        
        if (error) {
          console.error(`[sync] DB error for ${card.id}:`, error);
          failed++;
        } else {
          processed++;
        }
        
      } catch (err) {
        console.error(`[sync] Error processing ${card.id}:`, err);
        failed++;
      }
    }
    
    const hasMore = offset + BATCH_SIZE < allCards.length;
    
    console.log(`[sync] Done batch: ${processed} processed, ${failed} failed, hasMore: ${hasMore}`);
    
    return new Response(JSON.stringify({
      success: true,
      processed,
      failed,
      hasMore,
      nextOffset: hasMore ? offset + BATCH_SIZE : null,
      total: allCards.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[sync] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});