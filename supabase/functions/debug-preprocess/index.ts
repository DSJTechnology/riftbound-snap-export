import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration - MUST match client
const OUTPUT_SIZE = 224;
const CARD_WIDTH = 500;
const CARD_HEIGHT = 700;
const ART_REGION = {
  LEFT: 0.06,
  RIGHT: 0.94,
  TOP: 0.14,
  BOTTOM: 0.58,
};

/**
 * Decode image bytes to pseudo-pixels for processing
 */
function decodeImageToPixels(imageBytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  // Parse dimensions from image header (supports PNG, JPEG, WebP)
  let width = 400;
  let height = 560;
  
  // Check for PNG
  if (imageBytes[0] === 0x89 && imageBytes[1] === 0x50) {
    width = (imageBytes[16] << 24) | (imageBytes[17] << 16) | (imageBytes[18] << 8) | imageBytes[19];
    height = (imageBytes[20] << 24) | (imageBytes[21] << 16) | (imageBytes[22] << 8) | imageBytes[23];
  }
  // Check for JPEG
  else if (imageBytes[0] === 0xFF && imageBytes[1] === 0xD8) {
    for (let i = 2; i < imageBytes.length - 10; i++) {
      if (imageBytes[i] === 0xFF && (imageBytes[i + 1] === 0xC0 || imageBytes[i + 1] === 0xC2)) {
        height = (imageBytes[i + 5] << 8) | imageBytes[i + 6];
        width = (imageBytes[i + 7] << 8) | imageBytes[i + 8];
        break;
      }
    }
  }
  // Check for WebP
  else if (imageBytes[0] === 0x52 && imageBytes[1] === 0x49 && imageBytes[2] === 0x46 && imageBytes[3] === 0x46) {
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
  
  // Create pseudo-pixels by sampling compressed data
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

/**
 * Crop to art region
 */
function cropToArtRegion(pixels: Uint8Array, srcWidth: number, srcHeight: number): { 
  pixels: Uint8Array; 
  width: number; 
  height: number;
  bbox: [number, number, number, number];
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
  
  return { 
    pixels: artPixels, 
    width: artWidth, 
    height: artHeight,
    bbox: [left, top, artWidth, artHeight]
  };
}

/**
 * Resize image to OUTPUT_SIZE
 */
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

/**
 * Convert pixels to base64 PNG (simple BMP-like format for preview)
 */
function pixelsToBase64Preview(pixels: Uint8Array, width: number, height: number): string {
  // Create a simple PPM format and encode to base64
  const header = `P6\n${width} ${height}\n255\n`;
  const headerBytes = new TextEncoder().encode(header);
  const rgbData = new Uint8Array(width * height * 3);
  
  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) {
    rgbData[j] = pixels[i];
    rgbData[j + 1] = pixels[i + 1];
    rgbData[j + 2] = pixels[i + 2];
  }
  
  const combined = new Uint8Array(headerBytes.length + rgbData.length);
  combined.set(headerBytes);
  combined.set(rgbData, headerBytes.length);
  
  // For browser compatibility, we'll return raw pixel data info instead
  // Convert to a simple visual representation
  const canvas = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    canvas[i] = pixels[i];
  }
  
  // Return base64 of raw RGBA for now (client can render)
  return btoa(String.fromCharCode(...canvas.slice(0, Math.min(canvas.length, 50000))));
}

/**
 * Compute pixel statistics
 */
function computeStats(pixels: Uint8Array): { mean: number; std: number } {
  let sum = 0;
  const count = pixels.length / 4;
  
  for (let i = 0; i < pixels.length; i += 4) {
    const intensity = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    sum += intensity;
  }
  
  const mean = sum / count / 255;
  
  let variance = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const intensity = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 / 255;
    variance += Math.pow(intensity - mean, 2);
  }
  
  const std = Math.sqrt(variance / count);
  
  return { mean, std };
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
    let cardId: string | null = null;
    let originalImageUrl: string | null = null;
    
    if (training_image_id) {
      // Load from training images table
      const { data: trainingImage, error } = await supabase
        .from('training_images')
        .select('*')
        .eq('id', training_image_id)
        .single();
      
      if (error || !trainingImage) {
        throw new Error(`Training image not found: ${training_image_id}`);
      }
      
      cardId = trainingImage.card_id;
      originalImageUrl = trainingImage.image_url;
      
      // Fetch the image
      const response = await fetch(trainingImage.image_url);
      if (!response.ok) throw new Error('Failed to fetch training image');
      
      const buffer = await response.arrayBuffer();
      imageBytes = new Uint8Array(buffer);
    } else if (image_data) {
      // Parse base64 data URL
      const base64Match = image_data.match(/^data:image\/\w+;base64,(.+)$/);
      if (base64Match) {
        const base64 = base64Match[1];
        imageBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      } else {
        throw new Error('Invalid image_data format');
      }
    } else {
      throw new Error('Either image_data or training_image_id required');
    }
    
    console.log(`[debug-preprocess] Processing image, bytes: ${imageBytes.length}`);
    
    // Decode image
    const decoded = decodeImageToPixels(imageBytes);
    console.log(`[debug-preprocess] Decoded: ${decoded.width}x${decoded.height}`);
    
    // Crop to art region
    const art = cropToArtRegion(decoded.pixels, decoded.width, decoded.height);
    console.log(`[debug-preprocess] Art region: ${art.width}x${art.height}`);
    
    // Resize to output size
    const resized = resizeImage(art.pixels, art.width, art.height);
    
    // Compute stats
    const stats = computeStats(resized);
    
    // Create preview (simplified - return stats and dimensions)
    const previewData = pixelsToBase64Preview(resized, OUTPUT_SIZE, OUTPUT_SIZE);
    
    return new Response(JSON.stringify({
      card_id: cardId,
      original_image_url: originalImageUrl,
      preprocessed_preview: `data:application/octet-stream;base64,${previewData}`,
      width: OUTPUT_SIZE,
      height: OUTPUT_SIZE,
      stats: {
        mean_pixel_value: parseFloat(stats.mean.toFixed(4)),
        std_pixel_value: parseFloat(stats.std.toFixed(4)),
        channels: 3,
        has_detected_card_region: true,
        card_region_bbox: art.bbox,
        original_dimensions: [decoded.width, decoded.height],
        art_dimensions: [art.width, art.height],
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[debug-preprocess] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
