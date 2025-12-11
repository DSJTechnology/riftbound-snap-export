import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { decode as decodePng } from "https://deno.land/x/pngs@0.1.1/mod.ts";
import { decode as decodeJpeg } from "https://esm.sh/jpeg-js@0.4.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration - MUST match client
const OUTPUT_SIZE = 224;
const ART_REGION = {
  LEFT: 0.06,
  RIGHT: 0.94,
  TOP: 0.14,
  BOTTOM: 0.58,
};

/**
 * Detect image format from bytes
 */
function detectImageFormat(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | 'unknown' {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    return 'jpeg';
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return 'webp';
  }
  return 'unknown';
}

/**
 * Decode image bytes to RGBA pixels using proper decoders
 */
function decodeImageToPixels(imageBytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  const format = detectImageFormat(imageBytes);
  console.log(`[debug-preprocess] Detected format: ${format}`);
  
  if (format === 'png') {
    try {
      const decoded = decodePng(imageBytes);
      // pngs returns {width, height, image} where image is RGBA Uint8Array
      console.log(`[debug-preprocess] PNG decoded: ${decoded.width}x${decoded.height}`);
      return {
        width: decoded.width,
        height: decoded.height,
        pixels: new Uint8Array(decoded.image),
      };
    } catch (e) {
      console.error('[debug-preprocess] PNG decode error:', e);
      throw new Error(`PNG decode failed: ${e}`);
    }
  }
  
  if (format === 'jpeg') {
    try {
      const decoded = decodeJpeg(imageBytes, { useTArray: true, formatAsRGBA: true });
      console.log(`[debug-preprocess] JPEG decoded: ${decoded.width}x${decoded.height}`);
      return {
        width: decoded.width,
        height: decoded.height,
        pixels: new Uint8Array(decoded.data),
      };
    } catch (e) {
      console.error('[debug-preprocess] JPEG decode error:', e);
      throw new Error(`JPEG decode failed: ${e}`);
    }
  }
  
  // For WebP and unknown formats, try JPEG decoder as fallback
  // (some images mislabeled, or we can convert via fetch)
  throw new Error(`Unsupported image format: ${format}. Please use PNG or JPEG.`);
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
 * Resize image to OUTPUT_SIZE using bilinear interpolation
 */
function resizeImage(pixels: Uint8Array, srcWidth: number, srcHeight: number): Uint8Array {
  const resized = new Uint8Array(OUTPUT_SIZE * OUTPUT_SIZE * 4);
  
  const xRatio = srcWidth / OUTPUT_SIZE;
  const yRatio = srcHeight / OUTPUT_SIZE;
  
  for (let y = 0; y < OUTPUT_SIZE; y++) {
    for (let x = 0; x < OUTPUT_SIZE; x++) {
      // Use bilinear interpolation for smoother results
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const y1 = Math.min(y0 + 1, srcHeight - 1);
      
      const xFrac = srcX - x0;
      const yFrac = srcY - y0;
      
      const dstIdx = (y * OUTPUT_SIZE + x) * 4;
      
      for (let c = 0; c < 4; c++) {
        const v00 = pixels[(y0 * srcWidth + x0) * 4 + c] || 0;
        const v01 = pixels[(y0 * srcWidth + x1) * 4 + c] || 0;
        const v10 = pixels[(y1 * srcWidth + x0) * 4 + c] || 0;
        const v11 = pixels[(y1 * srcWidth + x1) * 4 + c] || 0;
        
        const v0 = v00 * (1 - xFrac) + v01 * xFrac;
        const v1 = v10 * (1 - xFrac) + v11 * xFrac;
        const v = v0 * (1 - yFrac) + v1 * yFrac;
        
        resized[dstIdx + c] = Math.round(v);
      }
    }
  }
  
  return resized;
}

/**
 * Convert RGBA pixels to base64 BMP format (browser-displayable)
 */
function pixelsToBMP(pixels: Uint8Array, width: number, height: number): string {
  // Calculate row padding (rows must be multiple of 4 bytes)
  const rowPadding = (4 - (width * 3) % 4) % 4;
  const pixelDataSize = (width * 3 + rowPadding) * height;
  const fileSize = 54 + pixelDataSize;
  
  // BMP file header (14 bytes)
  const bmpFileHeader = new Uint8Array([
    0x42, 0x4D,                           // "BM"
    fileSize & 0xFF, (fileSize >> 8) & 0xFF, (fileSize >> 16) & 0xFF, (fileSize >> 24) & 0xFF,
    0, 0, 0, 0,                           // Reserved
    54, 0, 0, 0                           // Offset to pixel data
  ]);

  // DIB header (40 bytes)
  const dibHeader = new Uint8Array([
    40, 0, 0, 0,                          // DIB header size
    width & 0xFF, (width >> 8) & 0xFF, (width >> 16) & 0xFF, (width >> 24) & 0xFF,
    height & 0xFF, (height >> 8) & 0xFF, (height >> 16) & 0xFF, (height >> 24) & 0xFF,
    1, 0,                                 // Planes
    24, 0,                                // Bits per pixel
    0, 0, 0, 0,                           // No compression
    0, 0, 0, 0,                           // Image size (can be 0 for uncompressed)
    0, 0, 0, 0,                           // X pixels per meter
    0, 0, 0, 0,                           // Y pixels per meter
    0, 0, 0, 0,                           // Colors in color table
    0, 0, 0, 0                            // Important colors
  ]);

  const pixelData = new Uint8Array(pixelDataSize);

  // BMP stores rows bottom-to-top, BGR format
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y; // Flip vertically
    for (let x = 0; x < width; x++) {
      const srcIdx = (srcY * width + x) * 4;
      const dstIdx = y * (width * 3 + rowPadding) + x * 3;
      pixelData[dstIdx] = pixels[srcIdx + 2];     // B
      pixelData[dstIdx + 1] = pixels[srcIdx + 1]; // G
      pixelData[dstIdx + 2] = pixels[srcIdx];     // R
    }
  }

  // Combine all parts
  const bmp = new Uint8Array(54 + pixelDataSize);
  bmp.set(bmpFileHeader);
  bmp.set(dibHeader, 14);
  bmp.set(pixelData, 54);

  // Convert to base64
  let binary = '';
  for (let i = 0; i < bmp.length; i++) {
    binary += String.fromCharCode(bmp[i]);
  }
  return btoa(binary);
}

/**
 * Compute pixel statistics on the resized RGB image (pre-normalized)
 */
function computeStats(pixels: Uint8Array): { mean: number; std: number; min: number; max: number } {
  let sum = 0;
  let min = 1;
  let max = 0;
  const values: number[] = [];
  const count = pixels.length / 4;
  
  for (let i = 0; i < pixels.length; i += 4) {
    // Average RGB to get intensity (0-1 range)
    const intensity = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 / 255;
    values.push(intensity);
    sum += intensity;
    if (intensity < min) min = intensity;
    if (intensity > max) max = intensity;
  }
  
  const mean = sum / count;
  
  let variance = 0;
  for (const v of values) {
    variance += Math.pow(v - mean, 2);
  }
  
  const std = Math.sqrt(variance / count);
  
  return { mean, std, min, max };
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
    
    // Decode image to proper RGBA pixels
    const decoded = decodeImageToPixels(imageBytes);
    console.log(`[debug-preprocess] Decoded: ${decoded.width}x${decoded.height}`);
    
    // Crop to art region
    const art = cropToArtRegion(decoded.pixels, decoded.width, decoded.height);
    console.log(`[debug-preprocess] Art region: ${art.width}x${art.height}`);
    
    // Resize to output size (this is the pre-normalized RGB image)
    const resized = resizeImage(art.pixels, art.width, art.height);
    
    // Compute stats on the resized image (0-1 normalized values for stats)
    const stats = computeStats(resized);
    
    // Create preview as BMP image from the resized RGB (pre-normalized)
    const previewBmp = pixelsToBMP(resized, OUTPUT_SIZE, OUTPUT_SIZE);
    
    return new Response(JSON.stringify({
      card_id: cardId,
      original_image_url: originalImageUrl,
      preprocessed_preview: `data:image/bmp;base64,${previewBmp}`,
      width: OUTPUT_SIZE,
      height: OUTPUT_SIZE,
      stats: {
        min_pixel: parseFloat(stats.min.toFixed(4)),
        max_pixel: parseFloat(stats.max.toFixed(4)),
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
