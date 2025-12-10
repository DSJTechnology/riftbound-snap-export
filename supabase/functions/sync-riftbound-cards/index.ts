import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration
const EMBEDDING_SIZE = 256;
const COLOR_BINS = 8;
const INTENSITY_BINS = 14;
const GRID_SIZE = 4;
const EDGE_FEATURES = 32;
const TEXTURE_FEATURES = 32;
const FREQUENCY_FEATURES = 48;
const CARD_CROP = { LEFT_PERCENT: 0.08, RIGHT_PERCENT: 0.92, TOP_PERCENT: 0.10, BOTTOM_PERCENT: 0.60 };
const OUTPUT_SIZE = 224;
const BATCH_SIZE = 25; // Process 25 cards per call to avoid timeout

interface DotGGCard {
  id: string;
  name: string;
  set_name: string;
  rarity: string | null;
  image: string;
}

interface DecodedImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

// Extract features from WebP by analyzing compressed data patterns
function extractWebPFeatures(bytes: Uint8Array, cardId: string): DecodedImage {
  let dataStart = 0;
  let dataLength = bytes.length;
  
  // Find VP8 chunk in WebP
  if (bytes.length > 20) {
    for (let i = 12; i < bytes.length - 8; i++) {
      if (bytes[i] === 0x56 && bytes[i+1] === 0x50 && bytes[i+2] === 0x38) {
        if (bytes[i+3] === 0x20 || bytes[i+3] === 0x4C || bytes[i+3] === 0x58) {
          const chunkSize = bytes[i+4] | (bytes[i+5] << 8) | (bytes[i+6] << 16) | (bytes[i+7] << 24);
          dataStart = i + 8;
          dataLength = Math.min(chunkSize, bytes.length - dataStart);
          break;
        }
      }
    }
  }
  
  const imageData = bytes.slice(dataStart, dataStart + dataLength);
  const pixels = new Uint8Array(OUTPUT_SIZE * OUTPUT_SIZE * 4);
  
  // Create pseudo-pixel representation from compressed data
  for (let y = 0; y < OUTPUT_SIZE; y++) {
    for (let x = 0; x < OUTPUT_SIZE; x++) {
      const pixelIdx = (y * OUTPUT_SIZE + x) * 4;
      const basePos = ((y * OUTPUT_SIZE + x) * 4) % (imageData.length - 4);
      
      const rPos = basePos % imageData.length;
      const gPos = (basePos + Math.floor(imageData.length / 3)) % imageData.length;
      const bPos = (basePos + Math.floor(imageData.length * 2 / 3)) % imageData.length;
      
      pixels[pixelIdx] = imageData[rPos] || 0;
      pixels[pixelIdx + 1] = imageData[gPos] || 0;
      pixels[pixelIdx + 2] = imageData[bPos] || 0;
      pixels[pixelIdx + 3] = 255;
    }
  }
  
  return { width: OUTPUT_SIZE, height: OUTPUT_SIZE, pixels };
}

function cropToArtRegion(image: DecodedImage): DecodedImage {
  const { width, height, pixels } = image;
  const cropX = Math.floor(width * CARD_CROP.LEFT_PERCENT);
  const cropY = Math.floor(height * CARD_CROP.TOP_PERCENT);
  const cropWidth = Math.floor(width * (CARD_CROP.RIGHT_PERCENT - CARD_CROP.LEFT_PERCENT));
  const cropHeight = Math.floor(height * (CARD_CROP.BOTTOM_PERCENT - CARD_CROP.TOP_PERCENT));
  const minDim = Math.min(cropWidth, cropHeight);
  const squareX = cropX + Math.floor((cropWidth - minDim) / 2);
  const squareY = cropY + Math.floor((cropHeight - minDim) / 2);
  
  const outPixels = new Uint8Array(OUTPUT_SIZE * OUTPUT_SIZE * 4);
  
  for (let outY = 0; outY < OUTPUT_SIZE; outY++) {
    for (let outX = 0; outX < OUTPUT_SIZE; outX++) {
      const srcX = squareX + (outX / OUTPUT_SIZE) * minDim;
      const srcY = squareY + (outY / OUTPUT_SIZE) * minDim;
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const outIdx = (outY * OUTPUT_SIZE + outX) * 4;
      const srcIdx = (y0 * width + x0) * 4;
      
      outPixels[outIdx] = pixels[srcIdx] || 0;
      outPixels[outIdx + 1] = pixels[srcIdx + 1] || 0;
      outPixels[outIdx + 2] = pixels[srcIdx + 2] || 0;
      outPixels[outIdx + 3] = 255;
    }
  }
  
  return { width: OUTPUT_SIZE, height: OUTPUT_SIZE, pixels: outPixels };
}

function extractFeaturesFromPixels(pixels: Uint8Array, width: number, height: number): number[] {
  const features: number[] = [];
  const pixelCount = width * height;

  // Color histograms (24 features)
  const histR = new Array(COLOR_BINS).fill(0);
  const histG = new Array(COLOR_BINS).fill(0);
  const histB = new Array(COLOR_BINS).fill(0);
  for (let i = 0; i < pixels.length; i += 4) {
    histR[Math.floor(pixels[i] / 32)]++;
    histG[Math.floor(pixels[i + 1] / 32)]++;
    histB[Math.floor(pixels[i + 2] / 32)]++;
  }
  for (let i = 0; i < COLOR_BINS; i++) {
    features.push(histR[i] / pixelCount, histG[i] / pixelCount, histB[i] / pixelCount);
  }

  // Intensity stats (16 features)
  const intensities: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    intensities.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
  }
  const meanI = intensities.reduce((a, b) => a + b, 0) / intensities.length;
  const stdI = Math.sqrt(intensities.reduce((a, b) => a + Math.pow(b - meanI, 2), 0) / intensities.length);
  features.push(meanI / 255, stdI / 128);
  
  const intensityHist = new Array(INTENSITY_BINS).fill(0);
  for (const i of intensities) {
    intensityHist[Math.min(INTENSITY_BINS - 1, Math.floor(i / (256 / INTENSITY_BINS)))]++;
  }
  for (let i = 0; i < INTENSITY_BINS; i++) features.push(intensityHist[i] / intensities.length);

  // Spatial grid (64 features)
  const cellW = Math.floor(width / GRID_SIZE);
  const cellH = Math.floor(height / GRID_SIZE);
  for (let gy = 0; gy < GRID_SIZE; gy++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      let sumR = 0, sumG = 0, sumB = 0, sumI = 0, count = 0;
      for (let y = gy * cellH; y < (gy + 1) * cellH && y < height; y++) {
        for (let x = gx * cellW; x < (gx + 1) * cellW && x < width; x++) {
          const idx = (y * width + x) * 4;
          sumR += pixels[idx]; sumG += pixels[idx + 1]; sumB += pixels[idx + 2];
          sumI += 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
          count++;
        }
      }
      if (count > 0) features.push(sumR / count / 255, sumG / count / 255, sumB / count / 255, sumI / count / 255);
      else features.push(0, 0, 0, 0);
    }
  }

  // Edge features (32)
  for (let i = 0; i < EDGE_FEATURES; i++) {
    const y = Math.floor((i / EDGE_FEATURES) * (height - 1));
    const x1 = Math.floor(((i % 8) / 8) * (width - 10));
    const x2 = Math.min(x1 + 10, width - 1);
    const idx1 = (y * width + x1) * 4;
    const idx2 = (y * width + x2) * 4;
    const i1 = 0.299 * pixels[idx1] + 0.587 * pixels[idx1 + 1] + 0.114 * pixels[idx1 + 2];
    const i2 = 0.299 * pixels[idx2] + 0.587 * pixels[idx2 + 1] + 0.114 * pixels[idx2 + 2];
    features.push(Math.abs(i1 - i2) / 255);
  }

  // Texture features (32)
  const windowSize = Math.max(5, Math.floor(width / 20));
  for (let i = 0; i < TEXTURE_FEATURES; i++) {
    const startX = Math.floor(((i % 8) / 8) * Math.max(1, width - windowSize));
    const startY = Math.floor((Math.floor(i / 8) / 4) * Math.max(1, height - windowSize));
    const samples: number[] = [];
    for (let dy = 0; dy < windowSize && startY + dy < height; dy++) {
      for (let dx = 0; dx < windowSize && startX + dx < width; dx++) {
        const idx = ((startY + dy) * width + (startX + dx)) * 4;
        samples.push(0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2]);
      }
    }
    if (samples.length > 0) {
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      features.push(Math.sqrt(samples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / samples.length) / 128);
    } else features.push(0);
  }

  // Frequency features (48)
  for (let i = 0; i < FREQUENCY_FEATURES; i++) {
    const y = Math.floor((i / FREQUENCY_FEATURES) * (height - 1));
    const x = Math.floor(((i % 12) / 12) * (width - 4));
    const idx = (y * width + x) * 4;
    const d1 = (pixels[idx + 4] || 0) - pixels[idx];
    const d2 = (pixels[idx + 8] || 0) - (pixels[idx + 4] || 0);
    const d3 = (pixels[idx + 12] || 0) - (pixels[idx + 8] || 0);
    features.push((d1 + d2 + d3 + 384) / 768);
  }

  while (features.length < EMBEDDING_SIZE) features.push(0);
  return features.slice(0, EMBEDDING_SIZE);
}

function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((a, b) => a + b * b, 0)) || 1;
  return vector.map(v => v / norm);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { offset = 0 } = await req.json().catch(() => ({}));
    console.log(`[sync] Starting at offset ${offset}`);
    
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
    
    const allCards: DotGGCard[] = [];
    for (const row of apiData.data) {
      if (!Array.isArray(row)) continue;
      const cardId = row[idIndex];
      const name = row[nameIndex];
      if (cardId && name) {
        allCards.push({
          id: String(cardId).trim().toUpperCase(),
          name: String(name).trim(),
          set_name: setNameIndex !== -1 && row[setNameIndex] ? String(row[setNameIndex]).trim() : 'Unknown',
          rarity: rarityIndex !== -1 && row[rarityIndex] ? String(row[rarityIndex]).trim() : null,
          image: imageIndex !== -1 && row[imageIndex] ? row[imageIndex] : `https://static.dotgg.gg/riftbound/cards/${cardId}.webp`,
        });
      }
    }
    
    // Process only a batch
    const cards = allCards.slice(offset, offset + BATCH_SIZE);
    console.log(`[sync] Processing ${cards.length} cards (${offset}-${offset + cards.length} of ${allCards.length})`);
    
    let processed = 0;
    let failed = 0;
    
    for (const card of cards) {
      try {
        const imageUrl = card.image || `https://static.dotgg.gg/riftbound/cards/${card.id}.webp`;
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) { failed++; continue; }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageBytes = new Uint8Array(imageBuffer);
        
        // Upload to storage
        await supabase.storage.from('riftbound-cards').upload(`${card.id}.webp`, imageBytes, {
          contentType: 'image/webp',
          upsert: true,
        });
        
        const { data: publicUrlData } = supabase.storage.from('riftbound-cards').getPublicUrl(`${card.id}.webp`);
        
        // Extract features
        const decoded = extractWebPFeatures(imageBytes, card.id);
        const cropped = cropToArtRegion(decoded);
        const features = extractFeaturesFromPixels(cropped.pixels, cropped.width, cropped.height);
        const embedding = l2Normalize(features);
        
        // Log first card for debugging
        if (processed === 0) {
          console.log(`[sync] Sample ${card.id}: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
        }
        
        // Upsert to database
        const { error } = await supabase.from('riftbound_cards').upsert({
          card_id: card.id,
          name: card.name,
          set_name: card.set_name,
          rarity: card.rarity,
          art_url: publicUrlData.publicUrl,
          hash: '',
          embedding,
        }, { onConflict: 'card_id' });
        
        if (error) console.warn(`[sync] Upsert error ${card.id}: ${error.message}`);
        processed++;
      } catch (err) {
        console.warn(`[sync] Error ${card.id}:`, err);
        failed++;
      }
    }
    
    const hasMore = offset + BATCH_SIZE < allCards.length;
    const nextOffset = hasMore ? offset + BATCH_SIZE : null;
    
    console.log(`[sync] Done batch: ${processed} processed, ${failed} failed, hasMore: ${hasMore}`);
    
    return new Response(JSON.stringify({
      success: true,
      processed,
      failed,
      total: allCards.length,
      offset,
      nextOffset,
      hasMore,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    
  } catch (error) {
    console.error('[sync] Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
