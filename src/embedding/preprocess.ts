/**
 * Image preprocessing utilities for card embedding.
 * Provides consistent cropping and resizing for both scanner and training.
 * 
 * IMPORTANT: This module uses FULL CARD cropping (not art-only) for embeddings
 * to capture name bar, frame, and text that differentiate cards.
 */

import { MODEL_INPUT_SIZE } from './cnnEmbedding';

// Card aspect ratio (width / height) - standard card dimensions
export const CARD_ASPECT_RATIO = 500 / 700; // ~0.714

// Legacy art region percentages (kept for reference, NOT used in embeddings)
export const ART_REGION = {
  LEFT: 0.06,
  RIGHT: 0.94,
  TOP: 0.14,
  BOTTOM: 0.58,
} as const;

export interface DrawOptions {
  useArtRegion?: boolean; // Deprecated: should always be false for embeddings
  targetSize?: number;
}

/**
 * Load an image from a URL and return it as an HTMLImageElement
 */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error(`Failed to load image: ${url}`));
    
    img.src = url;
  });
}

/**
 * Draw a card image to a canvas, resizing to MODEL_INPUT_SIZE x MODEL_INPUT_SIZE.
 * 
 * FULL CARD mode (default, useArtRegion=false):
 * - Crops to maintain card aspect ratio (centered)
 * - Resizes to targetSize x targetSize
 * - Captures full card including name, frame, art, text
 * 
 * Art region mode (useArtRegion=true, deprecated):
 * - Crops to just the art window
 * - Not recommended for embeddings
 */
export function drawCardToCanvas(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  options: DrawOptions = {}
): HTMLCanvasElement {
  const { useArtRegion = false, targetSize = MODEL_INPUT_SIZE } = options;
  
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  let sourceWidth: number;
  let sourceHeight: number;
  
  if (source instanceof HTMLVideoElement) {
    sourceWidth = source.videoWidth;
    sourceHeight = source.videoHeight;
  } else {
    sourceWidth = source.width;
    sourceHeight = source.height;
  }
  
  if (useArtRegion) {
    // Legacy: Crop to art region only (deprecated for embeddings)
    const sx = Math.floor(sourceWidth * ART_REGION.LEFT);
    const sy = Math.floor(sourceHeight * ART_REGION.TOP);
    const sw = Math.floor(sourceWidth * (ART_REGION.RIGHT - ART_REGION.LEFT));
    const sh = Math.floor(sourceHeight * (ART_REGION.BOTTOM - ART_REGION.TOP));
    
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, targetSize, targetSize);
  } else {
    // FULL CARD: Crop to card aspect ratio, centered
    const sourceAspect = sourceWidth / sourceHeight;
    
    let sx: number, sy: number, sw: number, sh: number;
    
    if (sourceAspect > CARD_ASPECT_RATIO) {
      // Source is wider than card - crop left/right
      sh = sourceHeight;
      sw = sh * CARD_ASPECT_RATIO;
      sx = (sourceWidth - sw) / 2;
      sy = 0;
    } else {
      // Source is taller than card - crop top/bottom
      sw = sourceWidth;
      sh = sw / CARD_ASPECT_RATIO;
      sx = 0;
      sy = (sourceHeight - sh) / 2;
    }
    
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, targetSize, targetSize);
  }
  
  return canvas;
}

/**
 * Get preprocessing stats from a canvas
 */
export function getCanvasStats(canvas: HTMLCanvasElement): {
  width: number;
  height: number;
  meanBrightness: number;
  stdBrightness: number;
  minPixel: number;
  maxPixel: number;
} {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { width: 0, height: 0, meanBrightness: 0, stdBrightness: 0, minPixel: 0, maxPixel: 0 };
  }
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  
  let sum = 0;
  let min = 255;
  let max = 0;
  const intensities: number[] = [];
  
  for (let i = 0; i < pixels.length; i += 4) {
    const intensity = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    intensities.push(intensity);
    sum += intensity;
    min = Math.min(min, intensity);
    max = Math.max(max, intensity);
  }
  
  const mean = sum / intensities.length;
  const variance = intensities.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / intensities.length;
  const std = Math.sqrt(variance);
  
  return {
    width: canvas.width,
    height: canvas.height,
    meanBrightness: mean / 255,
    stdBrightness: std / 255,
    minPixel: min / 255,
    maxPixel: max / 255,
  };
}

/**
 * Convert canvas to data URL for preview
 */
export function canvasToDataUrl(canvas: HTMLCanvasElement, type = 'image/png'): string {
  return canvas.toDataURL(type);
}
