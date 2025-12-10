import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DotGGCard {
  id: string;
  name: string;
  set_name: string;
  rarity: string | null;
  image: string;
}

interface CardWithHash {
  card_id: string;
  name: string;
  set_name: string | null;
  rarity: string | null;
  art_url: string;
  hash: string;
}

// Compute perceptual hash from image data
function computePerceptualHash(imageData: Uint8Array, width: number, height: number, bits = 8): string {
  const size = bits;
  
  // Simple downscale by averaging blocks
  const blockW = Math.floor(width / size);
  const blockH = Math.floor(height / size);
  const grays: number[] = [];
  
  for (let by = 0; by < size; by++) {
    for (let bx = 0; bx < size; bx++) {
      let sum = 0;
      let count = 0;
      
      for (let y = by * blockH; y < (by + 1) * blockH && y < height; y++) {
        for (let x = bx * blockW; x < (bx + 1) * blockW && x < width; x++) {
          const idx = (y * width + x) * 4;
          const r = imageData[idx] || 0;
          const g = imageData[idx + 1] || 0;
          const b = imageData[idx + 2] || 0;
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          sum += gray;
          count++;
        }
      }
      
      grays.push(count > 0 ? sum / count : 0);
    }
  }
  
  // Calculate average
  const avg = grays.reduce((sum, v) => sum + v, 0) / Math.max(grays.length, 1);
  
  // Build binary string
  let bitsStr = '';
  for (const g of grays) {
    bitsStr += g > avg ? '1' : '0';
  }
  
  // Convert to hex
  let hex = '';
  for (let i = 0; i < bitsStr.length; i += 4) {
    const nibble = bitsStr.slice(i, i + 4);
    hex += parseInt(nibble, 2).toString(16);
  }
  
  return hex;
}

// Decode image and get raw pixel data (simplified for WebP/PNG/JPG)
async function getImageDimensions(buffer: ArrayBuffer): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  // For edge function, we'll use a simpler approach - hash the raw bytes
  // This won't be as accurate as proper image processing but works without dependencies
  const bytes = new Uint8Array(buffer);
  
  // Create a pseudo-image data by sampling the bytes
  // This is a simplified approach - for production you'd want proper image decoding
  const size = 8;
  const totalPixels = size * size;
  const bytesPerPixel = Math.floor(bytes.length / totalPixels);
  
  const grays: number[] = [];
  for (let i = 0; i < totalPixels; i++) {
    const offset = i * bytesPerPixel;
    // Sample 3 bytes as RGB-like values
    const r = bytes[offset % bytes.length] || 0;
    const g = bytes[(offset + 1) % bytes.length] || 0;
    const b = bytes[(offset + 2) % bytes.length] || 0;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    grays.push(gray);
  }
  
  // Create pseudo image data
  const imageData = new Uint8Array(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    const gray = grays[i];
    imageData[i * 4] = gray;
    imageData[i * 4 + 1] = gray;
    imageData[i * 4 + 2] = gray;
    imageData[i * 4 + 3] = 255;
  }
  
  return { width: size, height: size, data: imageData };
}

// Simple hash from raw bytes (more reliable in edge function context)
function computeHashFromBytes(buffer: ArrayBuffer, bits = 8): string {
  const bytes = new Uint8Array(buffer);
  const size = bits;
  const totalPixels = size * size;
  
  // Sample bytes evenly across the file
  const step = Math.max(1, Math.floor(bytes.length / totalPixels));
  const samples: number[] = [];
  
  for (let i = 0; i < totalPixels; i++) {
    const offset = (i * step) % bytes.length;
    // Take a few bytes and combine them
    const val = (bytes[offset] + (bytes[offset + 1] || 0) + (bytes[offset + 2] || 0)) / 3;
    samples.push(val);
  }
  
  // Calculate average
  const avg = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  
  // Build binary string
  let bitsStr = '';
  for (const s of samples) {
    bitsStr += s > avg ? '1' : '0';
  }
  
  // Convert to hex
  let hex = '';
  for (let i = 0; i < bitsStr.length; i += 4) {
    const nibble = bitsStr.slice(i, i + 4);
    hex += parseInt(nibble, 2).toString(16);
  }
  
  return hex;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[sync-riftbound-cards] Starting sync...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Fetch cards from dotGG API
    console.log('[sync-riftbound-cards] Fetching cards from dotGG API...');
    const apiUrl = 'https://api.dotgg.gg/cgfw/getcards?game=riftbound&mode=indexed';
    const apiResponse = await fetch(apiUrl);
    
    if (!apiResponse.ok) {
      throw new Error(`Failed to fetch from dotGG API: ${apiResponse.status}`);
    }
    
    const apiData = await apiResponse.json();
    console.log(`[sync-riftbound-cards] Got ${apiData.data?.length || 0} cards from API`);
    
    // Parse the indexed format
    const names = apiData.names as string[];
    const idIndex = names.indexOf('id');
    const nameIndex = names.indexOf('name');
    const setNameIndex = names.indexOf('set_name');
    const rarityIndex = names.indexOf('rarity');
    const imageIndex = names.indexOf('image');
    
    if (idIndex === -1 || nameIndex === -1) {
      throw new Error('API response missing required fields');
    }
    
    const cards: DotGGCard[] = [];
    for (const row of apiData.data) {
      if (!Array.isArray(row)) continue;
      
      const cardId = row[idIndex];
      const name = row[nameIndex];
      const setName = setNameIndex !== -1 ? row[setNameIndex] : null;
      const rarity = rarityIndex !== -1 ? row[rarityIndex] : null;
      const image = imageIndex !== -1 ? row[imageIndex] : null;
      
      if (cardId && name) {
        cards.push({
          id: String(cardId).trim().toUpperCase(),
          name: String(name).trim(),
          set_name: setName ? String(setName).trim() : 'Unknown',
          rarity: rarity ? String(rarity).trim() : null,
          image: image || `https://static.dotgg.gg/riftbound/cards/${cardId}.webp`,
        });
      }
    }
    
    console.log(`[sync-riftbound-cards] Parsed ${cards.length} cards`);
    
    // Process cards in batches
    const results: CardWithHash[] = [];
    const BATCH_SIZE = 10;
    let processed = 0;
    let failed = 0;
    
    for (let i = 0; i < cards.length; i += BATCH_SIZE) {
      const batch = cards.slice(i, i + BATCH_SIZE);
      
      const batchPromises = batch.map(async (card) => {
        try {
          // Download image
          const imageUrl = card.image || `https://static.dotgg.gg/riftbound/cards/${card.id}.webp`;
          const imageResponse = await fetch(imageUrl);
          
          if (!imageResponse.ok) {
            console.warn(`[sync-riftbound-cards] Failed to fetch image for ${card.id}: ${imageResponse.status}`);
            return null;
          }
          
          const imageBuffer = await imageResponse.arrayBuffer();
          const imageBytes = new Uint8Array(imageBuffer);
          
          // Upload to Supabase Storage
          const storagePath = `${card.id}.webp`;
          const { error: uploadError } = await supabase.storage
            .from('riftbound-cards')
            .upload(storagePath, imageBytes, {
              contentType: 'image/webp',
              upsert: true,
            });
          
          if (uploadError) {
            console.warn(`[sync-riftbound-cards] Failed to upload ${card.id}: ${uploadError.message}`);
          }
          
          // Get public URL
          const { data: publicUrlData } = supabase.storage
            .from('riftbound-cards')
            .getPublicUrl(storagePath);
          
          const artUrl = publicUrlData.publicUrl;
          
          // Compute hash from raw bytes
          const hash = computeHashFromBytes(imageBuffer, 8);
          
          return {
            card_id: card.id,
            name: card.name,
            set_name: card.set_name,
            rarity: card.rarity,
            art_url: artUrl,
            hash: hash,
          };
        } catch (err) {
          console.warn(`[sync-riftbound-cards] Error processing ${card.id}:`, err);
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      for (const result of batchResults) {
        if (result) {
          results.push(result);
          processed++;
        } else {
          failed++;
        }
      }
      
      console.log(`[sync-riftbound-cards] Progress: ${processed}/${cards.length} (${failed} failed)`);
    }
    
    // Upsert all cards to database
    console.log(`[sync-riftbound-cards] Upserting ${results.length} cards to database...`);
    
    const { error: upsertError } = await supabase
      .from('riftbound_cards')
      .upsert(results, { onConflict: 'card_id' });
    
    if (upsertError) {
      throw new Error(`Failed to upsert cards: ${upsertError.message}`);
    }
    
    console.log(`[sync-riftbound-cards] Sync complete! ${results.length} cards synced.`);
    
    return new Response(
      JSON.stringify({
        success: true,
        total: cards.length,
        synced: results.length,
        failed: failed,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[sync-riftbound-cards] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
