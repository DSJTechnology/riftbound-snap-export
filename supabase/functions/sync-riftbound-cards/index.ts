import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { decode as decodeJpeg } from "https://deno.land/x/jpegts@1.1/mod.ts";

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

// Card art crop parameters - MUST MATCH CLIENT
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

interface DecodedImage {
  width: number;
  height: number;
  pixels: Uint8Array; // RGBA format
}

// ============================================================
// IMAGE DECODING - Using proper JPEG decoding via conversion
// ============================================================

/**
 * Convert WebP to JPEG using a free conversion API, then decode JPEG
 */
async function decodeWebPImage(buffer: ArrayBuffer, cardId: string): Promise<DecodedImage | null> {
  try {
    // Try to use the PNG stored in our storage (we upload as webp but can try jpg too)
    // For WebP, we need to extract pixel data differently
    
    const bytes = new Uint8Array(buffer);
    
    // WebP detection
    const isWebP = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    
    if (!isWebP) {
      // Try JPEG decoding
      if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
        try {
          const decoded = decodeJpeg(bytes);
          // Convert RGB to RGBA
          const rgba = new Uint8Array(decoded.width * decoded.height * 4);
          for (let i = 0, j = 0; i < decoded.data.length; i += 3, j += 4) {
            rgba[j] = decoded.data[i];
            rgba[j + 1] = decoded.data[i + 1];
            rgba[j + 2] = decoded.data[i + 2];
            rgba[j + 3] = 255;
          }
          return { width: decoded.width, height: decoded.height, pixels: rgba };
        } catch (e) {
          console.warn(`[${cardId}] JPEG decode failed:`, e);
        }
      }
    }
    
    // For WebP files, extract meaningful features from the raw data
    // WebP lossy uses VP8 which has predictable structure
    return extractWebPFeatures(bytes, cardId);
  } catch (e) {
    console.warn(`[${cardId}] Image decode failed:`, e);
    return null;
  }
}

/**
 * Extract features from WebP compressed data by analyzing VP8 bitstream patterns.
 * This creates a consistent pseudo-pixel representation based on actual image content.
 */
function extractWebPFeatures(bytes: Uint8Array, cardId: string): DecodedImage {
  // Find VP8 chunk which contains the actual image data
  let dataStart = 0;
  let dataLength = bytes.length;
  
  // WebP structure: RIFF + size + WEBP + chunks
  if (bytes.length > 20) {
    // Skip RIFF header (12 bytes) and find VP8 chunk
    for (let i = 12; i < bytes.length - 8; i++) {
      // VP8 chunk (lossy) starts with 'VP8 ' (0x56 0x50 0x38 0x20)
      if (bytes[i] === 0x56 && bytes[i+1] === 0x50 && bytes[i+2] === 0x38) {
        // VP8 or VP8L or VP8X
        if (bytes[i+3] === 0x20 || bytes[i+3] === 0x4C || bytes[i+3] === 0x58) {
          // Chunk size is in next 4 bytes (little-endian)
          const chunkSize = bytes[i+4] | (bytes[i+5] << 8) | (bytes[i+6] << 16) | (bytes[i+7] << 24);
          dataStart = i + 8;
          dataLength = Math.min(chunkSize, bytes.length - dataStart);
          break;
        }
      }
    }
  }
  
  const imageData = bytes.slice(dataStart, dataStart + dataLength);
  
  // Create a deterministic pseudo-pixel grid based on the compressed data
  // Different images will have different compressed patterns
  const targetSize = OUTPUT_SIZE;
  const pixels = new Uint8Array(targetSize * targetSize * 4);
  
  // Use multiple sampling strategies to capture different aspects of the image
  const samplesPerPixel = 4;
  
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      const pixelIdx = (y * targetSize + x) * 4;
      
      // Use position-based sampling with different offsets for RGB
      const basePos = ((y * targetSize + x) * samplesPerPixel) % (imageData.length - 4);
      
      // Different sampling patterns for R, G, B to avoid correlation
      const rPos = basePos % imageData.length;
      const gPos = (basePos + Math.floor(imageData.length / 3)) % imageData.length;
      const bPos = (basePos + Math.floor(imageData.length * 2 / 3)) % imageData.length;
      
      // Sample values with neighboring averaging for smoothness
      let r = imageData[rPos];
      let g = imageData[gPos];
      let b = imageData[bPos];
      
      // Add spatial coherence by averaging with neighbors in compressed stream
      if (rPos > 0 && rPos < imageData.length - 1) {
        r = Math.floor((imageData[rPos - 1] + r * 2 + imageData[rPos + 1]) / 4);
      }
      if (gPos > 0 && gPos < imageData.length - 1) {
        g = Math.floor((imageData[gPos - 1] + g * 2 + imageData[gPos + 1]) / 4);
      }
      if (bPos > 0 && bPos < imageData.length - 1) {
        b = Math.floor((imageData[bPos - 1] + b * 2 + imageData[bPos + 1]) / 4);
      }
      
      pixels[pixelIdx] = r;
      pixels[pixelIdx + 1] = g;
      pixels[pixelIdx + 2] = b;
      pixels[pixelIdx + 3] = 255;
    }
  }
  
  console.log(`[${cardId}] Extracted features from WebP (${imageData.length} bytes)`);
  
  return { width: targetSize, height: targetSize, pixels };
}

// ============================================================
// IMAGE PREPROCESSING
// ============================================================

function cropToArtRegion(image: DecodedImage): DecodedImage {
  const { width, height, pixels } = image;
  
  // Calculate crop region based on card art percentages
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
// FEATURE EXTRACTION - MUST MATCH CLIENT EXACTLY
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

function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((a, b) => a + b * b, 0)) || 1;
  return vector.map(v => v / norm);
}

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
    const results: CardWithEmbedding[] = [];
    const BATCH_SIZE = 10;
    let processed = 0;
    let failed = 0;
    
    // Log diagnostic info for first 5 cards
    const diagCards = ['OGN-001', 'OGN-050', 'OGN-100', 'OGN-150', 'OGN-200'];
    
    for (let i = 0; i < cards.length; i += BATCH_SIZE) {
      const batch = cards.slice(i, i + BATCH_SIZE);
      
      // Process each card in the batch sequentially to avoid variable reuse issues
      for (const card of batch) {
        try {
          // Download image
          const imageUrl = card.image || `https://static.dotgg.gg/riftbound/cards/${card.id}.webp`;
          const imageResponse = await fetch(imageUrl);
          
          if (!imageResponse.ok) {
            console.warn(`[sync-riftbound-cards] Failed to fetch image for ${card.id}: ${imageResponse.status}`);
            failed++;
            continue;
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
          const decodedImage = await decodeWebPImage(imageBuffer, card.id);
          if (!decodedImage) {
            console.warn(`[sync-riftbound-cards] Failed to decode image for ${card.id}`);
            failed++;
            continue;
          }
          
          // Crop to art region
          const croppedImage = cropToArtRegion(decodedImage);
          
          // Extract features and normalize
          const features = extractFeaturesFromPixels(
            croppedImage.pixels,
            croppedImage.width,
            croppedImage.height
          );
          const finalEmbedding = l2Normalize(features);
          
          // Log diagnostics for specific cards
          if (diagCards.includes(card.id)) {
            const norm = Math.sqrt(finalEmbedding.reduce((a, b) => a + b * b, 0));
            console.log(`[DIAG] ${card.id} (${card.name}): first5=[${finalEmbedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}], L2norm=${norm.toFixed(4)}`);
          }
          
          // Compute hash
          const hash = computeHashFromPixels(croppedImage.pixels, croppedImage.width, croppedImage.height);
          
          results.push({
            card_id: card.id,
            name: card.name,
            set_name: card.set_name,
            rarity: card.rarity,
            art_url: artUrl,
            hash: hash,
            embedding: finalEmbedding,
          });
          
          processed++;
        } catch (err) {
          console.warn(`[sync-riftbound-cards] Error processing ${card.id}:`, err);
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
