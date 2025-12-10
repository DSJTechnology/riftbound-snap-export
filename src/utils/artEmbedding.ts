/**
 * Art-focused embedding extraction.
 * This module provides consistent feature extraction for both client and edge function.
 */

// Shared constants - MUST match edge function
export const EMBEDDING_SIZE = 256;
export const OUTPUT_SIZE = 224;

// Feature extraction configuration
const COLOR_BINS = 8;
const INTENSITY_BINS = 14;
const GRID_SIZE = 4;
const EDGE_FEATURES = 32;
const TEXTURE_FEATURES = 32;
const FREQUENCY_FEATURES = 48;

/**
 * Extract a 256-dimensional feature vector from pixel data.
 * This algorithm MUST match the edge function exactly.
 */
export function extractFeaturesFromPixels(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): number[] {
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

  // 4. Edge/gradient features (32 features)
  for (let i = 0; i < EDGE_FEATURES; i++) {
    const y = Math.floor((i / EDGE_FEATURES) * (height - 1));
    const x1 = Math.floor(((i % 8) / 8) * Math.max(1, width - 10));
    const x2 = Math.min(x1 + 10, width - 1);

    const idx1 = (y * width + x1) * 4;
    const idx2 = (y * width + x2) * 4;

    if (idx1 + 2 < pixels.length && idx2 + 2 < pixels.length) {
      const intensity1 = 0.299 * pixels[idx1] + 0.587 * pixels[idx1 + 1] + 0.114 * pixels[idx1 + 2];
      const intensity2 = 0.299 * pixels[idx2] + 0.587 * pixels[idx2 + 1] + 0.114 * pixels[idx2 + 2];
      features.push(Math.abs(intensity1 - intensity2) / 255);
    } else {
      features.push(0);
    }
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
        if (idx + 2 < pixels.length) {
          const intensity = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
          samples.push(intensity);
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

  // 6. Frequency-like features (48 features)
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

  // Pad or truncate to exact EMBEDDING_SIZE
  while (features.length < EMBEDDING_SIZE) {
    features.push(0);
  }

  return features.slice(0, EMBEDDING_SIZE);
}

/**
 * L2 normalize a vector.
 */
export function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((a, b) => a + b * b, 0));
  if (norm === 0) return vector;
  return vector.map(v => v / norm);
}

/**
 * Resize an image canvas to OUTPUT_SIZE x OUTPUT_SIZE
 */
export function resizeToOutputSize(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const resized = document.createElement('canvas');
  resized.width = OUTPUT_SIZE;
  resized.height = OUTPUT_SIZE;
  
  const ctx = resized.getContext('2d');
  if (ctx) {
    ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  }
  
  return resized;
}

/**
 * Extract embedding from art canvas (client-side)
 */
export function extractEmbeddingFromArtCanvas(artCanvas: HTMLCanvasElement): number[] {
  // Resize to standard size
  const resized = resizeToOutputSize(artCanvas);
  
  const ctx = resized.getContext('2d');
  if (!ctx) {
    return new Array(EMBEDDING_SIZE).fill(0);
  }
  
  const imageData = ctx.getImageData(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  const features = extractFeaturesFromPixels(imageData.data, OUTPUT_SIZE, OUTPUT_SIZE);
  
  return l2Normalize(features);
}

/**
 * Compute cosine similarity between two L2-normalized vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Find top N matches from candidates
 */
export function findTopMatches<T extends { embedding: number[] }>(
  queryEmbedding: number[],
  candidates: T[],
  topN = 5
): Array<{ item: T; score: number }> {
  const scored = candidates.map(item => ({
    item,
    score: cosineSimilarity(queryEmbedding, item.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
