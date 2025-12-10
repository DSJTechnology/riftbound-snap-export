/**
 * Image preprocessing utilities for card recognition.
 * This module provides preprocessing that matches the edge function exactly.
 */

import {
  EMBEDDING_SIZE,
  COLOR_BINS,
  INTENSITY_BINS,
  GRID_SIZE,
  EDGE_FEATURES,
  TEXTURE_FEATURES,
  FREQUENCY_FEATURES,
  CARD_CROP,
  OUTPUT_SIZE,
  QUALITY_THRESHOLDS,
} from './embeddingConfig';

export interface QualityCheckResult {
  passed: boolean;
  brightness: number;
  sharpness: number;
  issues: string[];
}

/**
 * Check image quality (brightness and sharpness) before processing.
 */
export function checkImageQuality(canvas: HTMLCanvasElement): QualityCheckResult {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { passed: false, brightness: 0, sharpness: 0, issues: ['Cannot read canvas'] };
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const issues: string[] = [];

  // Calculate average brightness (luminance)
  let totalLuminance = 0;
  const pixelCount = data.length / 4;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    totalLuminance += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  
  const brightness = totalLuminance / pixelCount;

  // Calculate sharpness using Laplacian variance
  const grayData = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    grayData[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // Apply Laplacian kernel and compute variance
  let laplacianSum = 0;
  let laplacianSqSum = 0;
  let laplacianCount = 0;

  for (let y = 1; y < canvas.height - 1; y++) {
    for (let x = 1; x < canvas.width - 1; x++) {
      const idx = y * canvas.width + x;
      const laplacian = (
        grayData[idx - canvas.width] +
        grayData[idx - 1] +
        grayData[idx + 1] +
        grayData[idx + canvas.width] -
        4 * grayData[idx]
      );
      laplacianSum += Math.abs(laplacian);
      laplacianSqSum += laplacian * laplacian;
      laplacianCount++;
    }
  }

  const sharpness = laplacianCount > 0 ? laplacianSqSum / laplacianCount : 0;

  // Check thresholds
  if (brightness < QUALITY_THRESHOLDS.MIN_BRIGHTNESS) {
    issues.push('Image too dark. Please improve lighting.');
  }
  if (brightness > QUALITY_THRESHOLDS.MAX_BRIGHTNESS) {
    issues.push('Image too bright. Please reduce lighting or glare.');
  }
  if (sharpness < QUALITY_THRESHOLDS.MIN_SHARPNESS) {
    issues.push('Image too blurry. Please hold the card steady.');
  }

  return {
    passed: issues.length === 0,
    brightness,
    sharpness,
    issues,
  };
}

/**
 * Crop image to the card art region using standard crop parameters.
 * This matches the edge function preprocessing exactly.
 */
export function cropToArtRegion(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetCanvas: HTMLCanvasElement
): void {
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return;

  const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.height;

  // Calculate crop region
  const cropX = Math.floor(sourceWidth * CARD_CROP.LEFT_PERCENT);
  const cropY = Math.floor(sourceHeight * CARD_CROP.TOP_PERCENT);
  const cropWidth = Math.floor(sourceWidth * (CARD_CROP.RIGHT_PERCENT - CARD_CROP.LEFT_PERCENT));
  const cropHeight = Math.floor(sourceHeight * (CARD_CROP.BOTTOM_PERCENT - CARD_CROP.TOP_PERCENT));

  // Make it square (center crop)
  const minDim = Math.min(cropWidth, cropHeight);
  const squareX = cropX + Math.floor((cropWidth - minDim) / 2);
  const squareY = cropY + Math.floor((cropHeight - minDim) / 2);

  // Set target canvas to output size
  targetCanvas.width = OUTPUT_SIZE;
  targetCanvas.height = OUTPUT_SIZE;

  // Draw cropped and resized image
  ctx.drawImage(
    source,
    squareX, squareY, minDim, minDim,
    0, 0, OUTPUT_SIZE, OUTPUT_SIZE
  );
}

/**
 * Extract a 256-dimensional feature vector from pixel data.
 * This MUST match the edge function's extractFeaturesFromPixels exactly.
 */
export function extractFeaturesFromPixels(pixels: Uint8ClampedArray, width: number, height: number): number[] {
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
export function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((a, b) => a + b * b, 0)) || 1;
  return vector.map(v => v / norm);
}

/**
 * Extract features from a canvas (already cropped to art region).
 */
export function extractFeaturesFromCanvas(canvas: HTMLCanvasElement): number[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new Array(EMBEDDING_SIZE).fill(0);
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const features = extractFeaturesFromPixels(imageData.data, canvas.width, canvas.height);
  return l2Normalize(features);
}

/**
 * Preprocess video frame: crop to card art region and extract normalized embedding.
 */
export function preprocessVideoFrame(
  video: HTMLVideoElement,
  canvas?: HTMLCanvasElement
): number[] {
  const workCanvas = canvas || document.createElement('canvas');
  
  // Crop to art region (handles resize to OUTPUT_SIZE internally)
  cropToArtRegion(video, workCanvas);
  
  return extractFeaturesFromCanvas(workCanvas);
}

/**
 * Preprocess video frame with quality check.
 */
export function preprocessVideoFrameWithQuality(
  video: HTMLVideoElement,
  canvas?: HTMLCanvasElement
): { embedding: number[]; quality: QualityCheckResult } {
  const workCanvas = canvas || document.createElement('canvas');
  
  // Crop to art region
  cropToArtRegion(video, workCanvas);
  
  // Check quality
  const quality = checkImageQuality(workCanvas);
  
  // Extract features regardless of quality (let caller decide)
  const embedding = extractFeaturesFromCanvas(workCanvas);
  
  return { embedding, quality };
}

/**
 * Computes cosine similarity between two L2-normalized embedding vectors.
 * Since vectors are normalized, this is just the dot product.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }

  return dotProduct;
}

/**
 * Find the top N matches from a list of embeddings using cosine similarity.
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
