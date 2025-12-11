import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration - MUST match client and sync function exactly
const EMBEDDING_SIZE = 256;
const OUTPUT_SIZE = 224;
const ART_REGION = { LEFT: 0.06, RIGHT: 0.94, TOP: 0.14, BOTTOM: 0.58 };
const COLOR_BINS = 8;
const INTENSITY_BINS = 14;
const GRID_SIZE = 4;
const EDGE_FEATURES = 32;
const TEXTURE_FEATURES = 32;
const FREQUENCY_FEATURES = 48;

function decodeImageToPixels(imageBytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  let width = 400, height = 560;
  
  if (imageBytes[0] === 0x89 && imageBytes[1] === 0x50) {
    width = (imageBytes[16] << 24) | (imageBytes[17] << 16) | (imageBytes[18] << 8) | imageBytes[19];
    height = (imageBytes[20] << 24) | (imageBytes[21] << 16) | (imageBytes[22] << 8) | imageBytes[23];
  } else if (imageBytes[0] === 0xFF && imageBytes[1] === 0xD8) {
    for (let i = 2; i < imageBytes.length - 10; i++) {
      if (imageBytes[i] === 0xFF && (imageBytes[i + 1] === 0xC0 || imageBytes[i + 1] === 0xC2)) {
        height = (imageBytes[i + 5] << 8) | imageBytes[i + 6];
        width = (imageBytes[i + 7] << 8) | imageBytes[i + 8];
        break;
      }
    }
  } else if (imageBytes[0] === 0x52 && imageBytes[1] === 0x49) {
    for (let i = 12; i < Math.min(imageBytes.length - 10, 100); i++) {
      if (imageBytes[i] === 0x56 && imageBytes[i+1] === 0x50 && imageBytes[i+2] === 0x38) {
        if (imageBytes[i+3] === 0x20) {
          const frameTag = i + 8 + 3;
          if (frameTag + 6 < imageBytes.length) {
            width = (imageBytes[frameTag + 1] | (imageBytes[frameTag + 2] << 8)) & 0x3fff;
            height = (imageBytes[frameTag + 3] | (imageBytes[frameTag + 4] << 8)) & 0x3fff;
          }
        } else if (imageBytes[i+3] === 0x4C) {
          const sigOffset = i + 8 + 1;
          if (sigOffset + 4 < imageBytes.length) {
            const bits = imageBytes[sigOffset] | (imageBytes[sigOffset + 1] << 8) | 
                        (imageBytes[sigOffset + 2] << 16) | (imageBytes[sigOffset + 3] << 24);
            width = (bits & 0x3fff) + 1;
            height = ((bits >> 14) & 0x3fff) + 1;
          }
        }
        break;
      }
    }
  }
  
  const pixels = new Uint8Array(width * height * 4);
  const dataStart = Math.min(50, Math.floor(imageBytes.length * 0.05));
  const dataLen = imageBytes.length - dataStart;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = (y * width + x) * 4;
      const normalizedX = x / width;
      const normalizedY = y / height;
      
      const rPos = dataStart + Math.floor(normalizedY * normalizedX * dataLen) % dataLen;
      const gPos = dataStart + Math.floor((1 - normalizedY) * normalizedX * dataLen) % dataLen;
      const bPos = dataStart + Math.floor(normalizedY * (1 - normalizedX) * dataLen) % dataLen;
      const localOffset = Math.floor((x + y * 7) % Math.max(1, dataLen / 100)) * 3;
      
      pixels[pixelIdx] = imageBytes[(rPos + localOffset) % imageBytes.length] || 128;
      pixels[pixelIdx + 1] = imageBytes[(gPos + localOffset) % imageBytes.length] || 128;
      pixels[pixelIdx + 2] = imageBytes[(bPos + localOffset) % imageBytes.length] || 128;
      pixels[pixelIdx + 3] = 255;
    }
  }
  
  return { width, height, pixels };
}

function cropToArtRegion(pixels: Uint8Array, srcWidth: number, srcHeight: number): { 
  pixels: Uint8Array; width: number; height: number;
} {
  const left = Math.floor(srcWidth * ART_REGION.LEFT);
  const right = Math.floor(srcWidth * ART_REGION.RIGHT);
  const top = Math.floor(srcHeight * ART_REGION.TOP);
  const bottom = Math.floor(srcHeight * ART_REGION.BOTTOM);
  
  const artWidth = right - left;
  const artHeight = bottom - top;
  const artPixels = new Uint8Array(artWidth * artHeight * 4);
  
  for (let y = 0; y < artHeight; y++) {
    for (let x = 0; x < artWidth; x++) {
      const srcIdx = ((top + y) * srcWidth + (left + x)) * 4;
      const dstIdx = (y * artWidth + x) * 4;
      artPixels[dstIdx] = pixels[srcIdx] || 0;
      artPixels[dstIdx + 1] = pixels[srcIdx + 1] || 0;
      artPixels[dstIdx + 2] = pixels[srcIdx + 2] || 0;
      artPixels[dstIdx + 3] = 255;
    }
  }
  
  return { pixels: artPixels, width: artWidth, height: artHeight };
}

function resizeImage(pixels: Uint8Array, srcWidth: number, srcHeight: number): Uint8Array {
  const resized = new Uint8Array(OUTPUT_SIZE * OUTPUT_SIZE * 4);
  
  for (let y = 0; y < OUTPUT_SIZE; y++) {
    for (let x = 0; x < OUTPUT_SIZE; x++) {
      const srcX = Math.floor((x / OUTPUT_SIZE) * srcWidth);
      const srcY = Math.floor((y / OUTPUT_SIZE) * srcHeight);
      const srcIdx = (srcY * srcWidth + srcX) * 4;
      const dstIdx = (y * OUTPUT_SIZE + x) * 4;
      
      resized[dstIdx] = pixels[srcIdx] || 0;
      resized[dstIdx + 1] = pixels[srcIdx + 1] || 0;
      resized[dstIdx + 2] = pixels[srcIdx + 2] || 0;
      resized[dstIdx + 3] = 255;
    }
  }
  
  return resized;
}

function extractFeaturesFromPixels(pixels: Uint8Array, width: number, height: number): number[] {
  const features: number[] = [];
  const pixelCount = width * height;

  // 1. Color histogram features (24 features)
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

  // 2. Intensity distribution (16 features)
  const intensities: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    intensities.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
  }

  const meanIntensity = intensities.reduce((a, b) => a + b, 0) / (intensities.length || 1);
  const variance = intensities.reduce((a, b) => a + Math.pow(b - meanIntensity, 2), 0) / (intensities.length || 1);
  const stdDev = Math.sqrt(variance);

  features.push(meanIntensity / 255);
  features.push(stdDev / 128);

  const intensityHist = new Array(INTENSITY_BINS).fill(0);
  for (const intensity of intensities) {
    const bin = Math.min(INTENSITY_BINS - 1, Math.floor(intensity / (256 / INTENSITY_BINS)));
    intensityHist[bin]++;
  }
  for (let i = 0; i < INTENSITY_BINS; i++) {
    features.push(intensityHist[i] / (intensities.length || 1));
  }

  // 3. Spatial grid features (64 features)
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
          if (idx + 2 < pixels.length) {
            sumR += pixels[idx];
            sumG += pixels[idx + 1];
            sumB += pixels[idx + 2];
            sumI += 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
            count++;
          }
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

  // 4. Edge features (32 features)
  for (let i = 0; i < EDGE_FEATURES; i++) {
    const y = Math.floor((i / EDGE_FEATURES) * (height - 1));
    const x1 = Math.floor(((i % 8) / 8) * Math.max(1, width - 10));
    const x2 = Math.min(x1 + 10, width - 1);

    const idx1 = (y * width + x1) * 4;
    const idx2 = (y * width + x2) * 4;

    if (idx1 + 2 < pixels.length && idx2 + 2 < pixels.length) {
      const i1 = 0.299 * pixels[idx1] + 0.587 * pixels[idx1 + 1] + 0.114 * pixels[idx1 + 2];
      const i2 = 0.299 * pixels[idx2] + 0.587 * pixels[idx2 + 1] + 0.114 * pixels[idx2 + 2];
      features.push(Math.abs(i1 - i2) / 255);
    } else {
      features.push(0);
    }
  }

  // 5. Texture features (32 features)
  const windowSize = Math.max(5, Math.floor(width / 20));
  for (let i = 0; i < TEXTURE_FEATURES; i++) {
    const startX = Math.floor(((i % 8) / 8) * Math.max(1, width - windowSize));
    const startY = Math.floor((Math.floor(i / 8) / 4) * Math.max(1, height - windowSize));

    const samples: number[] = [];
    for (let dy = 0; dy < windowSize && startY + dy < height; dy++) {
      for (let dx = 0; dx < windowSize && startX + dx < width; dx++) {
        const idx = ((startY + dy) * width + (startX + dx)) * 4;
        if (idx + 2 < pixels.length) {
          samples.push(0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2]);
        }
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

  // 6. Frequency features (48 features)
  for (let i = 0; i < FREQUENCY_FEATURES; i++) {
    const y = Math.floor((i / FREQUENCY_FEATURES) * (height - 1));
    const x = Math.floor(((i % 12) / 12) * Math.max(1, width - 4));

    const idx = (y * width + x) * 4;
    
    if (idx + 12 < pixels.length) {
      const d1 = (pixels[idx + 4] || 0) - pixels[idx];
      const d2 = (pixels[idx + 8] || 0) - (pixels[idx + 4] || 0);
      const d3 = (pixels[idx + 12] || 0) - (pixels[idx + 8] || 0);
      features.push((d1 + d2 + d3 + 384) / 768);
    } else {
      features.push(0.5);
    }
  }

  while (features.length < EMBEDDING_SIZE) features.push(0);
  return features.slice(0, EMBEDDING_SIZE);
}

function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((a, b) => a + b * b, 0));
  if (norm === 0) return vector;
  return vector.map(v => v / norm);
}

function computeNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((a, b) => a + b * b, 0));
}

function countTrailingZeros(vector: number[]): number {
  let count = 0;
  for (let i = vector.length - 1; i >= 0; i--) {
    if (vector[i] === 0) count++;
    else break;
  }
  return count;
}

async function encodeImage(imageBytes: Uint8Array): Promise<number[]> {
  const decoded = decodeImageToPixels(imageBytes);
  const art = cropToArtRegion(decoded.pixels, decoded.width, decoded.height);
  const resized = resizeImage(art.pixels, art.width, art.height);
  const features = extractFeaturesFromPixels(resized, OUTPUT_SIZE, OUTPUT_SIZE);
  return l2Normalize(features);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_data, training_image_id } = await req.json();
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    let imageBytes: Uint8Array;
    
    if (training_image_id) {
      const { data: trainingImage, error } = await supabase
        .from('training_images')
        .select('*')
        .eq('id', training_image_id)
        .single();
      
      if (error || !trainingImage) {
        throw new Error(`Training image not found: ${training_image_id}`);
      }
      
      const response = await fetch(trainingImage.image_url);
      if (!response.ok) throw new Error('Failed to fetch training image');
      
      const buffer = await response.arrayBuffer();
      imageBytes = new Uint8Array(buffer);
    } else if (image_data) {
      const base64Match = image_data.match(/^data:image\/\w+;base64,(.+)$/);
      if (base64Match) {
        imageBytes = Uint8Array.from(atob(base64Match[1]), c => c.charCodeAt(0));
      } else {
        throw new Error('Invalid image_data format');
      }
    } else {
      throw new Error('Either image_data or training_image_id required');
    }
    
    console.log(`[debug-encode] Processing image, bytes: ${imageBytes.length}`);
    
    const embedding = await encodeImage(imageBytes);
    const norm = computeNorm(embedding);
    const trailingZeros = countTrailingZeros(embedding);
    
    return new Response(JSON.stringify({
      dimension: EMBEDDING_SIZE,
      norm: parseFloat(norm.toFixed(6)),
      embedding,
      trailing_zero_count: trailingZeros,
      sample_values: {
        first_10: embedding.slice(0, 10).map(v => parseFloat(v.toFixed(6))),
        last_10: embedding.slice(-10).map(v => parseFloat(v.toFixed(6))),
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[debug-encode] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
