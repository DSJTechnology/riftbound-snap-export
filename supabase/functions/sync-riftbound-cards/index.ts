import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

// Import shared decoder and preprocessing
import {
  decodeImageToPixels,
  cropToArtRegion,
  resizeImage,
  extractFeaturesFromPixels,
  l2Normalize,
  EMBEDDING_SIZE,
  OUTPUT_SIZE,
} from "../_shared/imageDecoder.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 5;

// Diagnostic cards to log
const DIAGNOSTIC_CARDS = ['OGN-001', 'OGN-050', 'OGN-100', 'OGN-150', 'SFD-001'];

interface DotGGCard {
  id: string;
  name: string;
  set_name: string;
  rarity: string | null;
  image: string;
}

/**
 * Compute embedding for a card image with art region focus
 */
async function computeCardEmbedding(imageBytes: Uint8Array, cardId: string): Promise<number[] | null> {
  const decoded = await decodeImageToPixels(imageBytes);
  if (!decoded) {
    console.warn(`[sync] Failed to decode image for ${cardId}`);
    return null;
  }
  
  console.log(`[sync] Decoded ${cardId}: ${decoded.width}x${decoded.height}`);
  
  // Crop to art region
  const art = cropToArtRegion(decoded.pixels, decoded.width, decoded.height);
  
  // Resize to standard size
  const resized = resizeImage(art.pixels, art.width, art.height);
  
  // Extract features
  const features = extractFeaturesFromPixels(resized, OUTPUT_SIZE, OUTPUT_SIZE);
  
  // L2 normalize
  return l2Normalize(features);
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
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) { 
          console.warn(`[sync] Failed to fetch image for ${card.id}: ${imageResponse.status}`);
          failed++; 
          continue; 
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageBytes = new Uint8Array(imageBuffer);
        
        // Upload to storage
        await supabase.storage.from('riftbound-cards').upload(`${card.id}.webp`, imageBytes, {
          contentType: 'image/webp',
          upsert: true,
        });
        
        const { data: publicUrlData } = supabase.storage.from('riftbound-cards').getPublicUrl(`${card.id}.webp`);
        
        // Compute art-focused embedding using REAL pixel decoder
        const embedding = await computeCardEmbedding(imageBytes, card.id);
        
        if (!embedding) {
          console.warn(`[sync] Failed to compute embedding for ${card.id}`);
          failed++;
          continue;
        }
        
        // Log diagnostic cards
        if (DIAGNOSTIC_CARDS.includes(card.id)) {
          const norm = Math.sqrt(embedding.reduce((a, b) => a + b * b, 0));
          console.log(`[sync] DIAGNOSTIC ${card.id} (${card.name}):`);
          console.log(`  First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(6)).join(', ')}]`);
          console.log(`  L2 norm: ${norm.toFixed(6)}`);
          console.log(`  Last 5 values: [${embedding.slice(-5).map(v => v.toFixed(6)).join(', ')}]`);
        }
        
        // Upsert to database
        const { error } = await supabase.from('riftbound_cards').upsert({
          card_id: card.id,
          name: card.name,
          set_name: card.set_name,
          rarity: card.rarity,
          art_url: publicUrlData.publicUrl,
          embedding: embedding,
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
