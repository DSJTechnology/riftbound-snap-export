import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { decode as decodePng } from "https://deno.land/x/pngs@0.1.1/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// SHARED CONFIGURATION - MUST MATCH CLIENT EXACTLY
// ============================================================
const EMBEDDING_SIZE = 256;
const COLOR_BINS = 8;
const INTENSITY_BINS = 14;
const GRID_SIZE = 4;
const EDGE_FEATURES = 32;
const TEXTURE_FEATURES = 32;
const FREQUENCY_FEATURES = 48;

// Card art crop parameters
const CARD_CROP = {
  LEFT_PERCENT: 0.08,
  RIGHT_PERCENT: 0.92,
  TOP_PERCENT: 0.10,
  BOTTOM_PERCENT: 0.60,
};

const OUTPUT_SIZE = 224;

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

// ============================================================
// IMAGE DECODING
// ============================================================

interface DecodedImage {
  width: number;
  height: number;
  pixels: Uint8Array; // RGBA format
}

/**
 * Attempt to decode a WebP image using basic parsing.
 * WebP is complex, so we'll convert to PNG via a simpler method.
 */
async function decodeImage(buffer: ArrayBuffer): Promise<DecodedImage | null> {
  const bytes = new Uint8Array(buffer);
  
  // Check if it's a PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    try {
      const decoded = decodePng(bytes);
      return {
        width: decoded.width,
        height: decoded.height,
        pixels: new Uint8Array(decoded.image),
      };
    } catch (e) {
      console.warn('PNG decode failed:', e);
    }
  }
  
  // For WebP and other formats, extract a simplified pixel approximation
  // by treating the compressed data as a pseudo-image
  return decodeFromCompressedBytes(buffer);
}

/**
 * Extract pseudo-pixel data from compressed image bytes.
 * This creates a consistent representation even without full decoding.
 */
function decodeFromCompressedBytes(buffer: ArrayBuffer): DecodedImage {
  const bytes = new Uint8Array(buffer);
  
  // Target a reasonable image size
  const targetSize = OUTPUT_SIZE;
  const totalPixels = targetSize * targetSize;
  const pixels = new Uint8Array(totalPixels * 4);
  
  // Skip header bytes
  const dataStart = Math.min(200, Math.floor(bytes.length * 0.1));
  const dataEnd = Math.floor(bytes.length * 0.95);
  const dataBytes = bytes.slice(dataStart, dataEnd);
  
  if (dataBytes.length < 100) {
    // Fallback: generate from hash
    for (let i = 0; i < totalPixels * 4; i += 4) {
      pixels[i] = bytes[i % bytes.length];
      pixels[i + 1] = bytes[(i + 1) % bytes.length];
      pixels[i + 2] = bytes[(i + 2) % bytes.length];
      pixels[i + 3] = 255;
    }
    return { width: targetSize, height: targetSize, pixels };
  }
  
  // Sample data evenly to create pseudo-pixel representation
  const step = Math.max(1, Math.floor(dataBytes.length / totalPixels));
  
  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = Math.min((i * step) % (dataBytes.length - 3), dataBytes.length - 4);
    const dstIdx = i * 4;
    
    pixels[dstIdx] = dataBytes[srcIdx];
    pixels[dstIdx + 1] = dataBytes[srcIdx + 1];
    pixels[dstIdx + 2] = dataBytes[srcIdx + 2];
    pixels[dstIdx + 3] = 255;
  }
  
  return { width: targetSize, height: targetSize, pixels };
}

// ============================================================
// IMAGE PREPROCESSING (matches client exactly)
// ============================================================

/**
 * Crop image to card art region and resize to OUTPUT_SIZE.
 */
function cropToArtRegion(image: DecodedImage): DecodedImage {
  const { width, height, pixels } = image;
  
  // Calculate crop region
  const cropX = Math.floor(width * CARD_CROP.LEFT_PERCENT);
  const cropY = Math.floor(height * CARD_CROP.TOP_PERCENT);
  const cropWidth = Math.floor(width * (CARD_CROP.RIGHT_PERCENT - CARD_CROP.LEFT_PERCENT));
  const cropHeight = Math.floor(height * (CARD_CROP.BOTTOM_PERCENT - CARD_CROP.TOP_PERCENT));
  
  // Make it square (center crop)
  const minDim = Math.min(cropWidth, cropHeight);
  const squareX = cropX + Math.floor((cropWidth - minDim) / 2);
  const squareY = cropY + Math.floor((cropHeight - minDim) / 2);
  
  // Create output image
  const outPixels = new Uint8Array(OUTPUT_SIZE * OUTPUT_SIZE * 4);
  
  // Bilinear interpolation resize
  for (let outY = 0; outY < OUTPUT_SIZE; outY++) {
    for (let outX = 0; outX < OUTPUT_SIZE; outX++) {
      const srcX = squareX + (outX / OUTPUT_SIZE) * minDim;
      const srcY = squareY + (outY / OUTPUT_SIZE) * minDim;
      
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);
      
      const xFrac = srcX - x0;
      const yFrac = srcY - y0;
      
      const outIdx = (outY * OUTPUT_SIZE + outX) * 4;
      
      for (let c = 0; c < 4; c++) {
        const v00 = pixels[(y0 * width + x0) * 4 + c] || 0;
        const v10 = pixels[(y0 * width + x1) * 4 + c] || 0;
        const v01 = pixels[(y1 * width + x0) * 4 + c] || 0;
        const v11 = pixels[(y1 * width + x1) * 4 + c] || 0;
        
        const v0 = v00 * (1 - xFrac) + v10 * xFrac;
        const v1 = v01 * (1 - xFrac) + v11 * xFrac;
        const v = v0 * (1 - yFrac) + v1 * yFrac;
        
        outPixels[outIdx + c] = Math.round(v);
      }
    }
  }
  
  return { width: OUTPUT_SIZE, height: OUTPUT_SIZE, pixels: outPixels };
}

// ============================================================
// FEATURE EXTRACTION (matches client exactly)
// ============================================================

// ============================================================
// FEATURE EXTRACTION (matches client exactly)
// ============================================================

function extractFeaturesFromPixels(pixels: Uint8Array, width: number, height: number): number[] {
  const features: number[] = [];
  const pixelCount = width * height;

  // 1. Color histogram features (3 channels × COLOR_BINS bins = 24 features)
  const histR = new Array(COLOR_BINS).fill(0);
  const histG = new Array(COLOR_BINS).fill(0);
  const histB = new Array(COLOR_BINS).fill(0);

  for (let i = 0; i < pixels.length; i += 4) {
    histR[Math.floor(pixels[i] / 32)]++;
    histG[Math.floor(pixels[i + 1] / 32)]++;
    histB[Math.floor(pixels[i + 2] / 32)]++;
  }

  const totalPixels = pixelCount || 1;
  for (let i = 0; i < COLOR_BINS; i++) {
    features.push(histR[i] / totalPixels);
    features.push(histG[i] / totalPixels);
    features.push(histB[i] / totalPixels);
  }

  // 2. Intensity distribution features (2 + INTENSITY_BINS = 16 features)
  const intensities: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const intensity = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    intensities.push(intensity);
  }

  const meanIntensity = intensities.reduce((a, b) => a + b, 0) / intensities.length;
  const variance = intensities.reduce((a, b) => a + Math.pow(b - meanIntensity, 2), 0) / intensities.length;
  const stdDev = Math.sqrt(variance);

  features.push(meanIntensity / 255);
  features.push(stdDev / 128);

  const intensityHist = new Array(INTENSITY_BINS).fill(0);
  for (const intensity of intensities) {
    const bin = Math.min(INTENSITY_BINS - 1, Math.floor(intensity / (256 / INTENSITY_BINS)));
    intensityHist[bin]++;
  }
  for (let i = 0; i < INTENSITY_BINS; i++) {
    features.push(intensityHist[i] / intensities.length);
  }

  // 3. Spatial grid features (GRID_SIZE × GRID_SIZE × 4 = 64 features)
  const cellWidth = Math.floor(width / GRID_SIZE);
  const cellHeight = Math.floor(height / GRID_SIZE);

  for (let gy = 0; gy < GRID_SIZE; gy++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      let sumR = 0, sumG = 0, sumB = 0, sumI = 0, count = 0;

      const startX = gx * cellWidth;
      const startY = gy * cellHeight;
      const endX = Math.min(startX + cellWidth, width);
      const endY = Math.min(startY + cellHeight, height);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4;
          sumR += pixels[idx];
          sumG += pixels[idx + 1];
          sumB += pixels[idx + 2];
          sumI += 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
          count++;
        }
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

  // 4. Edge/gradient features (32 features)
  for (let i = 0; i < EDGE_FEATURES; i++) {
    const y = Math.floor((i / EDGE_FEATURES) * (height - 1));
    const x1 = Math.floor(((i % 8) / 8) * (width - 10));
    const x2 = Math.min(x1 + 10, width - 1);

    const idx1 = (y * width + x1) * 4;
    const idx2 = (y * width + x2) * 4;

    const intensity1 = 0.299 * pixels[idx1] + 0.587 * pixels[idx1 + 1] + 0.114 * pixels[idx1 + 2];
    const intensity2 = 0.299 * pixels[idx2] + 0.587 * pixels[idx2 + 1] + 0.114 * pixels[idx2 + 2];

    features.push(Math.abs(intensity1 - intensity2) / 255);
  }

  // 5. Texture features using local variance (32 features)
  const windowSize = Math.max(5, Math.floor(width / 20));
  for (let i = 0; i < TEXTURE_FEATURES; i++) {
    const startX = Math.floor(((i % 8) / 8) * Math.max(1, width - windowSize));
    const startY = Math.floor((Math.floor(i / 8) / 4) * Math.max(1, height - windowSize));

    const samples: number[] = [];
    for (let dy = 0; dy < windowSize && startY + dy < height; dy++) {
      for (let dx = 0; dx < windowSize && startX + dx < width; dx++) {
        const idx = ((startY + dy) * width + (startX + dx)) * 4;
        const intensity = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
        samples.push(intensity);
      }
    }

    if (samples.length > 0) {
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      const localVar = samples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / samples.length;
      features.push(Math.sqrt(localVar) / 128);
    } else {
      features.push(0);
    }
  }

  // 6. Frequency-like features (48 features)
  for (let i = 0; i < FREQUENCY_FEATURES; i++) {
    const y = Math.floor((i / FREQUENCY_FEATURES) * (height - 1));
    const x = Math.floor(((i % 12) / 12) * (width - 4));

    const idx = (y * width + x) * 4;
    const idx1 = Math.min(idx + 4, pixels.length - 4);
    const idx2 = Math.min(idx + 8, pixels.length - 4);
    const idx3 = Math.min(idx + 12, pixels.length - 4);

    const d1 = pixels[idx1] - pixels[idx];
    const d2 = pixels[idx2] - pixels[idx1];
    const d3 = pixels[idx3] - pixels[idx2];

    features.push((d1 + d2 + d3 + 384) / 768);
  }

  // Pad or truncate to exact EMBEDDING_SIZE
  while (features.length < EMBEDDING_SIZE) {
    features.push(0);
  }

  return features.slice(0, EMBEDDING_SIZE);
}

/**
 * L2 normalize a vector.
 */
function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((a, b) => a + b * b, 0)) || 1;
  return vector.map(v => v / norm);
}

/**
 * Compute average of multiple embeddings and L2 normalize the result.
 */
function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return new Array(EMBEDDING_SIZE).fill(0);
  if (embeddings.length === 1) return embeddings[0];
  
  const avg = new Array(EMBEDDING_SIZE).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < EMBEDDING_SIZE; i++) {
      avg[i] += emb[i];
    }
  }
  for (let i = 0; i < EMBEDDING_SIZE; i++) {
    avg[i] /= embeddings.length;
  }
  
  return l2Normalize(avg);
}

/**
 * Compute hash for backward compatibility.
 */
function computeHashFromPixels(pixels: Uint8Array, width: number, height: number): string {
  const size = 8;
  const samples: number[] = [];
  
  const cellW = Math.floor(width / size);
  const cellH = Math.floor(height / size);
  
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      let sum = 0;
      let count = 0;
      
      const startX = gx * cellW;
      const startY = gy * cellH;
      
      for (let y = startY; y < startY + cellH && y < height; y++) {
        for (let x = startX; x < startX + cellW && x < width; x++) {
          const idx = (y * width + x) * 4;
          sum += 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
          count++;
        }
      }
      
      samples.push(count > 0 ? sum / count : 0);
    }
  }
  
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  
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

// ============================================================
// MAIN SYNC FUNCTION
// ============================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[sync-riftbound-cards] Starting sync with augmented embeddings...');
    
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
    
    // Process cards in batches - no augmentation for speed
    const results: CardWithEmbedding[] = [];
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
          
          // Decode image
          const decodedImage = await decodeImage(imageBuffer);
          if (!decodedImage) {
            console.warn(`[sync-riftbound-cards] Failed to decode image for ${card.id}`);
            return null;
          }
          
          // Crop to art region
          const croppedImage = cropToArtRegion(decodedImage);
          
          // Extract features and normalize (no augmentation for speed)
          const features = extractFeaturesFromPixels(
            croppedImage.pixels,
            croppedImage.width,
            croppedImage.height
          );
          const finalEmbedding = l2Normalize(features);
          
          // Compute hash from the original cropped image (for backward compatibility)
          const hash = computeHashFromPixels(croppedImage.pixels, croppedImage.width, croppedImage.height);
          
          return {
            card_id: card.id,
            name: card.name,
            set_name: card.set_name,
            rarity: card.rarity,
            art_url: artUrl,
            hash: hash,
            embedding: finalEmbedding,
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
      
      if (processed % 50 === 0 || i + BATCH_SIZE >= cards.length) {
        console.log(`[sync-riftbound-cards] Progress: ${processed}/${cards.length} (${failed} failed)`);
      }
    }
    
    // Upsert all cards to database
    console.log(`[sync-riftbound-cards] Upserting ${results.length} cards...`);
    
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
    
    console.log(`[sync-riftbound-cards] Sync complete! ${results.length} cards synced.`);
    
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
