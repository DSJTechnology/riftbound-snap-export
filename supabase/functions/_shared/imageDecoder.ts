/**
 * Shared image decoder for edge functions
 * Properly decodes PNG and JPEG to RGBA pixels
 * For WebP, we convert to PNG via external service or skip
 */

import { decode as decodePng } from "https://deno.land/x/pngs@0.1.1/mod.ts";
import { decode as decodeJpeg } from "https://esm.sh/jpeg-js@0.4.4";

/**
 * Detect image format from bytes
 */
export function detectImageFormat(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | 'unknown' {
  if (bytes.length < 12) return 'unknown';
  
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return 'png';
  }
  // JPEG: FF D8
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    return 'jpeg';
  }
  // WebP: RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'webp';
  }
  return 'unknown';
}

/**
 * Parse WebP dimensions from header for VP8/VP8L/VP8X formats
 */
function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  
  // Check for VP8 chunk (lossy)
  if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x20) {
    if (bytes.length >= 30) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3FFF;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3FFF;
      return { width, height };
    }
  }
  
  // Check for VP8L chunk (lossless)  
  if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x4C) {
    if (bytes.length >= 25) {
      const signature = bytes[21];
      if (signature === 0x2F) {
        const bits = bytes[22] | (bytes[23] << 8) | (bytes[24] << 16) | (bytes[25] << 24);
        const width = (bits & 0x3FFF) + 1;
        const height = ((bits >> 14) & 0x3FFF) + 1;
        return { width, height };
      }
    }
  }
  
  // Check for VP8X extended format  
  if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58) {
    if (bytes.length >= 30) {
      const width = ((bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) & 0xFFFFFF) + 1;
      const height = ((bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) & 0xFFFFFF) + 1;
      return { width, height };
    }
  }
  
  return null;
}

/**
 * Decode WebP by fetching as small PNG from wsrv.nl image proxy
 * Request 300px wide image to reduce memory usage
 */
export async function fetchImageAsPng(imageUrl: string): Promise<Uint8Array | null> {
  try {
    // Use wsrv.nl with width resize to keep memory low (300px is enough for 224px output)
    const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(imageUrl)}&w=300&output=png`;
    console.log(`[imageDecoder] Fetching via proxy (300px): ${proxyUrl.substring(0, 100)}...`);
    
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      console.error(`[imageDecoder] Proxy fetch failed: ${response.status}`);
      return null;
    }
    
    const buffer = await response.arrayBuffer();
    console.log(`[imageDecoder] Proxy returned ${buffer.byteLength} bytes`);
    return new Uint8Array(buffer);
  } catch (e) {
    console.error(`[imageDecoder] Proxy fetch error:`, e);
    return null;
  }
}

/**
 * Decode image bytes to RGBA pixels
 * Returns null if decoding fails
 */
export async function decodeImageToPixels(
  imageBytes: Uint8Array
): Promise<{ width: number; height: number; pixels: Uint8Array } | null> {
  const format = detectImageFormat(imageBytes);
  console.log(`[imageDecoder] Detected format: ${format}, bytes: ${imageBytes.length}`);
  
  try {
    // PNG - use pngs
    if (format === 'png') {
      try {
        const decoded = decodePng(imageBytes);
        console.log(`[imageDecoder] PNG decoded: ${decoded.width}x${decoded.height}`);
        return {
          width: decoded.width,
          height: decoded.height,
          pixels: new Uint8Array(decoded.image),
        };
      } catch (e) {
        console.error('[imageDecoder] PNG decode error:', e);
      }
    }
    
    // JPEG - use jpeg-js
    if (format === 'jpeg') {
      try {
        const decoded = decodeJpeg(imageBytes, { useTArray: true, formatAsRGBA: true });
        console.log(`[imageDecoder] JPEG decoded: ${decoded.width}x${decoded.height}`);
        return {
          width: decoded.width,
          height: decoded.height,
          pixels: new Uint8Array(decoded.data),
        };
      } catch (e) {
        console.error('[imageDecoder] JPEG decode error:', e);
      }
    }
    
    // WebP - log dimensions but can't decode natively
    if (format === 'webp') {
      const dims = parseWebpDimensions(imageBytes);
      console.log(`[imageDecoder] WebP detected, dimensions: ${dims?.width}x${dims?.height} - use fetchAndDecodeImage() instead`);
    }
    
    console.error(`[imageDecoder] Cannot decode format: ${format}`);
    return null;
    
  } catch (err) {
    console.error(`[imageDecoder] Decode error:`, err);
    return null;
  }
}

/**
 * Fetch image from URL and decode to pixels
 * For WebP, uses proxy to convert to PNG first
 */
export async function fetchAndDecodeImage(
  imageUrl: string
): Promise<{ width: number; height: number; pixels: Uint8Array } | null> {
  console.log(`[imageDecoder] Fetching image: ${imageUrl}`);
  
  // First try direct fetch
  const response = await fetch(imageUrl);
  if (!response.ok) {
    console.error(`[imageDecoder] Fetch failed: ${response.status}`);
    return null;
  }
  
  const buffer = await response.arrayBuffer();
  const imageBytes = new Uint8Array(buffer);
  const format = detectImageFormat(imageBytes);
  
  // If it's WebP, use proxy to convert to PNG
  if (format === 'webp') {
    console.log(`[imageDecoder] WebP detected, converting via proxy...`);
    const pngBytes = await fetchImageAsPng(imageUrl);
    if (pngBytes) {
      return decodeImageToPixels(pngBytes);
    }
    console.error(`[imageDecoder] WebP proxy conversion failed`);
    return null;
  }
  
  // Otherwise decode directly
  return decodeImageToPixels(imageBytes);
}

// ============= SHARED PREPROCESSING =============

// Configuration - MUST match client
export const EMBEDDING_SIZE = 256;
export const OUTPUT_SIZE = 224;
export const ART_REGION = {
  LEFT: 0.06,
  RIGHT: 0.94,
  TOP: 0.14,
  BOTTOM: 0.58,
};

// Feature extraction config
export const COLOR_BINS = 8;
export const INTENSITY_BINS = 14;
export const GRID_SIZE = 4;
export const EDGE_FEATURES = 32;
export const TEXTURE_FEATURES = 32;
export const FREQUENCY_FEATURES = 48;

/**
 * Crop to art region from full card image
 */
export function cropToArtRegion(
  pixels: Uint8Array,
  srcWidth: number,
  srcHeight: number
): { pixels: Uint8Array; width: number; height: number; bbox: [number, number, number, number] } {
  const left = Math.floor(srcWidth * ART_REGION.LEFT);
  const right = Math.floor(srcWidth * ART_REGION.RIGHT);
  const top = Math.floor(srcHeight * ART_REGION.TOP);
  const bottom = Math.floor(srcHeight * ART_REGION.BOTTOM);
  
  const artWidth = right - left;
  const artHeight = bottom - top;
  
  const artPixels = new Uint8Array(artWidth * artHeight * 4);
  
  for (let y = 0; y < artHeight; y++) {
    for (let x = 0; x < artWidth; x++) {
      const srcX = left + x;
      const srcY = top + y;
      const srcIdx = (srcY * srcWidth + srcX) * 4;
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
 * Resize image to OUTPUT_SIZE x OUTPUT_SIZE using bilinear interpolation
 */
export function resizeImage(
  pixels: Uint8Array,
  srcWidth: number,
  srcHeight: number
): Uint8Array {
  const resized = new Uint8Array(OUTPUT_SIZE * OUTPUT_SIZE * 4);
  
  const xRatio = srcWidth / OUTPUT_SIZE;
  const yRatio = srcHeight / OUTPUT_SIZE;
  
  for (let y = 0; y < OUTPUT_SIZE; y++) {
    for (let x = 0; x < OUTPUT_SIZE; x++) {
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
 * Extract features from pixel data - MUST match client exactly
 */
export function extractFeaturesFromPixels(pixels: Uint8Array, width: number, height: number): number[] {
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

/**
 * L2 normalize a vector
 */
export function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((a, b) => a + b * b, 0));
  if (norm === 0) return vector;
  return vector.map(v => v / norm);
}

/**
 * Compute L2 norm
 */
export function computeNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((a, b) => a + b * b, 0));
}

/**
 * Count trailing zeros in embedding
 */
export function countTrailingZeros(vector: number[]): number {
  let count = 0;
  for (let i = vector.length - 1; i >= 0; i--) {
    if (vector[i] === 0) count++;
    else break;
  }
  return count;
}

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Dot product of two vectors
 */
export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Full pipeline: decode → crop → resize → extract → normalize
 */
export async function computeEmbedding(imageBytes: Uint8Array): Promise<number[] | null> {
  const decoded = await decodeImageToPixels(imageBytes);
  if (!decoded) {
    console.warn('[imageDecoder] Failed to decode image');
    return null;
  }
  
  const art = cropToArtRegion(decoded.pixels, decoded.width, decoded.height);
  const resized = resizeImage(art.pixels, art.width, art.height);
  const features = extractFeaturesFromPixels(resized, OUTPUT_SIZE, OUTPUT_SIZE);
  
  return l2Normalize(features);
}

/**
 * Full pipeline from URL: fetch → decode → crop → resize → extract → normalize
 * Handles WebP via proxy conversion
 */
export async function computeEmbeddingFromUrl(imageUrl: string): Promise<number[] | null> {
  const decoded = await fetchAndDecodeImage(imageUrl);
  if (!decoded) {
    console.warn('[imageDecoder] Failed to fetch/decode image from URL');
    return null;
  }
  
  const art = cropToArtRegion(decoded.pixels, decoded.width, decoded.height);
  const resized = resizeImage(art.pixels, art.width, art.height);
  const features = extractFeaturesFromPixels(resized, OUTPUT_SIZE, OUTPUT_SIZE);
  
  return l2Normalize(features);
}

/**
 * Convert RGBA pixels to base64 BMP (for previews)
 */
export function pixelsToBMP(pixels: Uint8Array, width: number, height: number): string {
  const rowPadding = (4 - (width * 3) % 4) % 4;
  const pixelDataSize = (width * 3 + rowPadding) * height;
  const fileSize = 54 + pixelDataSize;
  
  const bmpFileHeader = new Uint8Array([
    0x42, 0x4D,
    fileSize & 0xFF, (fileSize >> 8) & 0xFF, (fileSize >> 16) & 0xFF, (fileSize >> 24) & 0xFF,
    0, 0, 0, 0,
    54, 0, 0, 0
  ]);

  const dibHeader = new Uint8Array([
    40, 0, 0, 0,
    width & 0xFF, (width >> 8) & 0xFF, (width >> 16) & 0xFF, (width >> 24) & 0xFF,
    height & 0xFF, (height >> 8) & 0xFF, (height >> 16) & 0xFF, (height >> 24) & 0xFF,
    1, 0,
    24, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0
  ]);

  const pixelData = new Uint8Array(pixelDataSize);

  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const srcIdx = (srcY * width + x) * 4;
      const dstIdx = y * (width * 3 + rowPadding) + x * 3;
      pixelData[dstIdx] = pixels[srcIdx + 2];
      pixelData[dstIdx + 1] = pixels[srcIdx + 1];
      pixelData[dstIdx + 2] = pixels[srcIdx];
    }
  }

  const bmp = new Uint8Array(54 + pixelDataSize);
  bmp.set(bmpFileHeader);
  bmp.set(dibHeader, 14);
  bmp.set(pixelData, 54);

  let binary = '';
  for (let i = 0; i < bmp.length; i++) {
    binary += String.fromCharCode(bmp[i]);
  }
  return btoa(binary);
}

/**
 * Compute stats on pixel data
 */
export function computePixelStats(pixels: Uint8Array): { mean: number; std: number; min: number; max: number } {
  let sum = 0;
  let min = 1;
  let max = 0;
  const values: number[] = [];
  const count = pixels.length / 4;
  
  for (let i = 0; i < pixels.length; i += 4) {
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
