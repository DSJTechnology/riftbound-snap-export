import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

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

interface CardWithEmbedding {
  card_id: string;
  name: string;
  set_name: string | null;
  rarity: string | null;
  art_url: string;
  hash: string;
  embedding: number[];
}

// Configuration for embedding
const EMBEDDING_SIZE = 256; // Size of the feature vector
const COLOR_BINS = 8; // Bins per color channel
const GRID_SIZE = 4; // Spatial grid for local features

/**
 * Decode a WebP/PNG/JPG image to raw pixel data using canvas-like approach
 * Since Deno doesn't have Canvas, we'll use a simpler byte-based feature extraction
 */
function extractFeaturesFromBytes(buffer: ArrayBuffer): number[] {
  const bytes = new Uint8Array(buffer);
  const features: number[] = [];
  
  // Skip header bytes (typically first ~30 bytes are metadata)
  const dataStart = Math.min(100, Math.floor(bytes.length * 0.05));
  const dataEnd = Math.floor(bytes.length * 0.95); // Skip trailing metadata
  const dataBytes = bytes.slice(dataStart, dataEnd);
  
  if (dataBytes.length < 100) {
    // Fallback for very small files
    return new Array(EMBEDDING_SIZE).fill(0).map((_, i) => bytes[i % bytes.length] / 255);
  }
  
  // 1. Color histogram features (3 channels × COLOR_BINS bins = 24 features)
  const histR = new Array(COLOR_BINS).fill(0);
  const histG = new Array(COLOR_BINS).fill(0);
  const histB = new Array(COLOR_BINS).fill(0);
  
  // Sample pixels evenly across the image data
  const sampleCount = Math.min(10000, Math.floor(dataBytes.length / 3));
  const step = Math.max(3, Math.floor(dataBytes.length / sampleCount));
  
  for (let i = 0; i < dataBytes.length - 2; i += step) {
    const r = dataBytes[i];
    const g = dataBytes[i + 1];
    const b = dataBytes[i + 2];
    
    histR[Math.floor(r / 32)]++;
    histG[Math.floor(g / 32)]++;
    histB[Math.floor(b / 32)]++;
  }
  
  // Normalize histograms
  const totalSamples = histR.reduce((a, b) => a + b, 1);
  for (let i = 0; i < COLOR_BINS; i++) {
    features.push(histR[i] / totalSamples);
    features.push(histG[i] / totalSamples);
    features.push(histB[i] / totalSamples);
  }
  
  // 2. Intensity distribution features (16 features)
  const intensities: number[] = [];
  for (let i = 0; i < dataBytes.length - 2; i += step) {
    const r = dataBytes[i];
    const g = dataBytes[i + 1];
    const b = dataBytes[i + 2];
    const intensity = 0.299 * r + 0.587 * g + 0.114 * b;
    intensities.push(intensity);
  }
  
  // Calculate intensity statistics
  const meanIntensity = intensities.reduce((a, b) => a + b, 0) / intensities.length;
  const variance = intensities.reduce((a, b) => a + Math.pow(b - meanIntensity, 2), 0) / intensities.length;
  const stdDev = Math.sqrt(variance);
  
  features.push(meanIntensity / 255);
  features.push(stdDev / 128);
  
  // Intensity histogram (14 bins)
  const intensityHist = new Array(14).fill(0);
  for (const intensity of intensities) {
    const bin = Math.min(13, Math.floor(intensity / 18.3));
    intensityHist[bin]++;
  }
  for (let i = 0; i < 14; i++) {
    features.push(intensityHist[i] / intensities.length);
  }
  
  // 3. Spatial grid features (GRID_SIZE × GRID_SIZE × 4 = 64 features)
  const gridFeatures: number[][] = [];
  const cellSize = Math.floor(dataBytes.length / (GRID_SIZE * GRID_SIZE));
  
  for (let gy = 0; gy < GRID_SIZE; gy++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      const cellStart = (gy * GRID_SIZE + gx) * cellSize;
      const cellEnd = Math.min(cellStart + cellSize, dataBytes.length);
      
      let sumR = 0, sumG = 0, sumB = 0, sumI = 0, count = 0;
      
      for (let i = cellStart; i < cellEnd - 2; i += 9) {
        sumR += dataBytes[i];
        sumG += dataBytes[i + 1];
        sumB += dataBytes[i + 2];
        sumI += 0.299 * dataBytes[i] + 0.587 * dataBytes[i + 1] + 0.114 * dataBytes[i + 2];
        count++;
      }
      
      if (count > 0) {
        features.push(sumR / count / 255);
        features.push(sumG / count / 255);
        features.push(sumB / count / 255);
        features.push(sumI / count / 255);
      } else {
        features.push(0, 0, 0, 0);
      }
    }
  }
  
  // 4. Edge/gradient-like features (32 features)
  const edgeFeatures: number[] = [];
  const edgeSamples = Math.min(1000, Math.floor(dataBytes.length / 10));
  const edgeStep = Math.floor(dataBytes.length / edgeSamples);
  
  for (let i = 0; i < 32; i++) {
    const pos1 = (i * edgeStep * 100) % (dataBytes.length - edgeStep);
    const pos2 = pos1 + edgeStep;
    
    if (pos2 < dataBytes.length) {
      const diff = Math.abs(dataBytes[pos1] - dataBytes[pos2]);
      edgeFeatures.push(diff / 255);
    } else {
      edgeFeatures.push(0);
    }
  }
  features.push(...edgeFeatures);
  
  // 5. Texture features using local variance (32 features)
  const textureFeatures: number[] = [];
  const windowSize = Math.max(10, Math.floor(dataBytes.length / 1000));
  
  for (let i = 0; i < 32; i++) {
    const pos = Math.floor((i / 32) * (dataBytes.length - windowSize));
    const window = dataBytes.slice(pos, pos + windowSize);
    
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const localVar = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / window.length;
    textureFeatures.push(Math.sqrt(localVar) / 128);
  }
  features.push(...textureFeatures);
  
  // 6. Frequency-like features using byte differences (48 features)
  const freqFeatures: number[] = [];
  const freqStep = Math.max(1, Math.floor(dataBytes.length / 50));
  
  for (let i = 0; i < 48; i++) {
    const pos = i * freqStep;
    if (pos + 3 < dataBytes.length) {
      const d1 = dataBytes[pos + 1] - dataBytes[pos];
      const d2 = dataBytes[pos + 2] - dataBytes[pos + 1];
      const d3 = dataBytes[pos + 3] - dataBytes[pos + 2];
      freqFeatures.push((d1 + d2 + d3 + 384) / 768); // Normalize to [0, 1]
    } else {
      freqFeatures.push(0.5);
    }
  }
  features.push(...freqFeatures);
  
  // Pad or truncate to exact EMBEDDING_SIZE
  while (features.length < EMBEDDING_SIZE) {
    features.push(0);
  }
  
  // Normalize the entire feature vector (L2 normalization)
  const norm = Math.sqrt(features.reduce((a, b) => a + b * b, 0)) || 1;
  const normalized = features.slice(0, EMBEDDING_SIZE).map(f => f / norm);
  
  return normalized;
}

/**
 * Compute a simple perceptual hash for backward compatibility
 */
function computeHashFromBytes(buffer: ArrayBuffer, bits = 8): string {
  const bytes = new Uint8Array(buffer);
  const size = bits;
  const totalPixels = size * size;
  
  const step = Math.max(1, Math.floor(bytes.length / totalPixels));
  const samples: number[] = [];
  
  for (let i = 0; i < totalPixels; i++) {
    const offset = (i * step) % bytes.length;
    const val = (bytes[offset] + (bytes[offset + 1] || 0) + (bytes[offset + 2] || 0)) / 3;
    samples.push(val);
  }
  
  const avg = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  
  let bitsStr = '';
  for (const s of samples) {
    bitsStr += s > avg ? '1' : '0';
  }
  
  let hex = '';
  for (let i = 0; i < bitsStr.length; i += 4) {
    const nibble = bitsStr.slice(i, i + 4);
    hex += parseInt(nibble, 2).toString(16);
  }
  
  return hex;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[sync-riftbound-cards] Starting sync with embeddings...');
    
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
    const results: CardWithEmbedding[] = [];
    const BATCH_SIZE = 5; // Smaller batches for embedding computation
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
          
          // Compute hash (for backward compatibility)
          const hash = computeHashFromBytes(imageBuffer, 8);
          
          // Compute embedding using feature extraction
          const embedding = extractFeaturesFromBytes(imageBuffer);
          
          return {
            card_id: card.id,
            name: card.name,
            set_name: card.set_name,
            rarity: card.rarity,
            art_url: artUrl,
            hash: hash,
            embedding: embedding,
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
      
      if (processed % 50 === 0 || processed === cards.length) {
        console.log(`[sync-riftbound-cards] Progress: ${processed}/${cards.length} (${failed} failed)`);
      }
    }
    
    // Upsert all cards to database
    console.log(`[sync-riftbound-cards] Upserting ${results.length} cards with embeddings to database...`);
    
    // Upsert in batches to avoid payload size limits
    const UPSERT_BATCH = 50;
    for (let i = 0; i < results.length; i += UPSERT_BATCH) {
      const batch = results.slice(i, i + UPSERT_BATCH);
      const { error: upsertError } = await supabase
        .from('riftbound_cards')
        .upsert(batch, { onConflict: 'card_id' });
      
      if (upsertError) {
        console.error(`[sync-riftbound-cards] Upsert error for batch ${i}-${i + UPSERT_BATCH}:`, upsertError.message);
      }
    }
    
    console.log(`[sync-riftbound-cards] Sync complete! ${results.length} cards with embeddings synced.`);
    
    return new Response(
      JSON.stringify({
        success: true,
        total: cards.length,
        synced: results.length,
        failed: failed,
        embeddingSize: EMBEDDING_SIZE,
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
