/**
 * Image preprocessing utilities for card recognition.
 * This module provides a preprocessing pipeline that extracts features
 * matching the edge function's embedding format.
 */

// Configuration matching edge function
const EMBEDDING_SIZE = 256;
const COLOR_BINS = 8;
const GRID_SIZE = 4;

/**
 * Extract features from a canvas to match the edge function's embedding format.
 * This processes camera frames to create embeddings comparable to stored card embeddings.
 */
export function extractFeaturesFromCanvas(canvas: HTMLCanvasElement): number[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new Array(EMBEDDING_SIZE).fill(0);
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const features: number[] = [];

  // 1. Color histogram features (3 channels × COLOR_BINS bins = 24 features)
  const histR = new Array(COLOR_BINS).fill(0);
  const histG = new Array(COLOR_BINS).fill(0);
  const histB = new Array(COLOR_BINS).fill(0);

  const pixelCount = data.length / 4;
  const sampleStep = Math.max(1, Math.floor(pixelCount / 10000));

  for (let i = 0; i < data.length; i += 4 * sampleStep) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    histR[Math.floor(r / 32)]++;
    histG[Math.floor(g / 32)]++;
    histB[Math.floor(b / 32)]++;
  }

  // Normalize histograms
  const totalSamples = histR.reduce((a, b) => a + b, 1);
  for (let i = 0; i < COLOR_BINS; i++) {
    features.push(histR[i] / totalSamples);
    features.push(histG[i] / totalSamples);
    features.push(histB[i] / totalSamples);
  }

  // 2. Intensity distribution features (16 features)
  const intensities: number[] = [];
  for (let i = 0; i < data.length; i += 4 * sampleStep) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const intensity = 0.299 * r + 0.587 * g + 0.114 * b;
    intensities.push(intensity);
  }

  const meanIntensity = intensities.reduce((a, b) => a + b, 0) / intensities.length;
  const variance = intensities.reduce((a, b) => a + Math.pow(b - meanIntensity, 2), 0) / intensities.length;
  const stdDev = Math.sqrt(variance);

  features.push(meanIntensity / 255);
  features.push(stdDev / 128);

  // Intensity histogram (14 bins)
  const intensityHist = new Array(14).fill(0);
  for (const intensity of intensities) {
    const bin = Math.min(13, Math.floor(intensity / 18.3));
    intensityHist[bin]++;
  }
  for (let i = 0; i < 14; i++) {
    features.push(intensityHist[i] / intensities.length);
  }

  // 3. Spatial grid features (GRID_SIZE × GRID_SIZE × 4 = 64 features)
  const cellWidth = Math.floor(canvas.width / GRID_SIZE);
  const cellHeight = Math.floor(canvas.height / GRID_SIZE);

  for (let gy = 0; gy < GRID_SIZE; gy++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      let sumR = 0, sumG = 0, sumB = 0, sumI = 0, count = 0;

      const startX = gx * cellWidth;
      const startY = gy * cellHeight;
      const endX = Math.min(startX + cellWidth, canvas.width);
      const endY = Math.min(startY + cellHeight, canvas.height);

      for (let y = startY; y < endY; y += 3) {
        for (let x = startX; x < endX; x += 3) {
          const idx = (y * canvas.width + x) * 4;
          sumR += data[idx];
          sumG += data[idx + 1];
          sumB += data[idx + 2];
          sumI += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
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

  // 4. Edge/gradient-like features (32 features)
  for (let i = 0; i < 32; i++) {
    const y = Math.floor((i / 32) * canvas.height);
    const x1 = Math.floor((i % 8) / 8 * canvas.width);
    const x2 = Math.min(x1 + 10, canvas.width - 1);

    const idx1 = (y * canvas.width + x1) * 4;
    const idx2 = (y * canvas.width + x2) * 4;

    const intensity1 = 0.299 * data[idx1] + 0.587 * data[idx1 + 1] + 0.114 * data[idx1 + 2];
    const intensity2 = 0.299 * data[idx2] + 0.587 * data[idx2 + 1] + 0.114 * data[idx2 + 2];

    features.push(Math.abs(intensity1 - intensity2) / 255);
  }

  // 5. Texture features using local variance (32 features)
  const windowSize = Math.max(5, Math.floor(canvas.width / 20));
  for (let i = 0; i < 32; i++) {
    const startX = Math.floor((i % 8) / 8 * (canvas.width - windowSize));
    const startY = Math.floor((i / 8) / 4 * (canvas.height - windowSize));

    const samples: number[] = [];
    for (let dy = 0; dy < windowSize; dy += 2) {
      for (let dx = 0; dx < windowSize; dx += 2) {
        const idx = ((startY + dy) * canvas.width + (startX + dx)) * 4;
        const intensity = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        samples.push(intensity);
      }
    }

    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const localVar = samples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / samples.length;
    features.push(Math.sqrt(localVar) / 128);
  }

  // 6. Frequency-like features (48 features)
  for (let i = 0; i < 48; i++) {
    const y = Math.floor((i / 48) * canvas.height);
    const x = Math.floor((i % 12) / 12 * canvas.width);

    const idx = (y * canvas.width + x) * 4;
    const idx1 = Math.min(idx + 4, data.length - 4);
    const idx2 = Math.min(idx + 8, data.length - 4);
    const idx3 = Math.min(idx + 12, data.length - 4);

    const d1 = data[idx1] - data[idx];
    const d2 = data[idx2] - data[idx1];
    const d3 = data[idx3] - data[idx2];

    features.push((d1 + d2 + d3 + 384) / 768);
  }

  // Pad or truncate to exact EMBEDDING_SIZE
  while (features.length < EMBEDDING_SIZE) {
    features.push(0);
  }

  // L2 normalize the feature vector
  const norm = Math.sqrt(features.reduce((a, b) => a + b * b, 0)) || 1;
  return features.slice(0, EMBEDDING_SIZE).map(f => f / norm);
}

/**
 * Preprocess video frame: crop center region and extract features
 */
export function preprocessVideoFrame(
  video: HTMLVideoElement,
  canvas?: HTMLCanvasElement
): number[] {
  const workCanvas = canvas || document.createElement('canvas');
  const ctx = workCanvas.getContext('2d');

  if (!ctx) {
    return new Array(EMBEDDING_SIZE).fill(0);
  }

  const videoWidth = video.videoWidth || 640;
  const videoHeight = video.videoHeight || 480;

  // Crop center 75% and trim borders
  const cropRatio = 0.75;
  const trimRatio = 0.90;

  const cropWidth = Math.floor(videoWidth * cropRatio);
  const cropHeight = Math.floor(videoHeight * cropRatio);
  const cropX = Math.floor((videoWidth - cropWidth) / 2);
  const cropY = Math.floor((videoHeight - cropHeight) / 2);

  const trimWidth = Math.floor(cropWidth * trimRatio);
  const trimHeight = Math.floor(cropHeight * trimRatio);
  const trimX = cropX + Math.floor((cropWidth - trimWidth) / 2);
  const trimY = cropY + Math.floor((cropHeight - trimHeight) / 2);

  // Resize to a standard size for consistent feature extraction
  const outputSize = 128;
  workCanvas.width = outputSize;
  workCanvas.height = outputSize;

  ctx.drawImage(
    video,
    trimX, trimY, trimWidth, trimHeight,
    0, 0, outputSize, outputSize
  );

  return extractFeaturesFromCanvas(workCanvas);
}

/**
 * Computes cosine similarity between two embedding vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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
