/**
 * Image preprocessing utilities for MobileNet-based card recognition.
 * This module provides a shared preprocessing pipeline used both for:
 * 1. Precomputing embeddings for reference card images
 * 2. Processing camera snapshots during scanning
 */

import * as tf from '@tensorflow/tfjs';

/**
 * Configuration for image preprocessing
 */
const MOBILENET_SIZE = 224;
const CENTER_CROP_RATIO = 0.75; // Take central 75% of image (remove outer 12.5% on each side)
const BORDER_TRIM_RATIO = 0.90; // After center crop, take 90% (trim another 5% from each edge)

/**
 * Preprocesses an image source for MobileNet feature extraction.
 * Applies center cropping, border trimming, resizing, and normalization.
 * 
 * @param source - HTMLImageElement or HTMLCanvasElement containing the image
 * @returns A tensor suitable for MobileNet: shape [1, 224, 224, 3] with values in [0, 1]
 */
export async function preprocessToMobilenetTensor(
  source: HTMLImageElement | HTMLCanvasElement
): Promise<tf.Tensor4D> {
  // Create an offscreen canvas for processing
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Could not get canvas 2D context');
  }

  // Get source dimensions
  const srcWidth = source instanceof HTMLImageElement 
    ? source.naturalWidth || source.width 
    : source.width;
  const srcHeight = source instanceof HTMLImageElement 
    ? source.naturalHeight || source.height 
    : source.height;

  // Step 1: Calculate center crop region (remove outer borders)
  const centerCropWidth = Math.floor(srcWidth * CENTER_CROP_RATIO);
  const centerCropHeight = Math.floor(srcHeight * CENTER_CROP_RATIO);
  const centerCropX = Math.floor((srcWidth - centerCropWidth) / 2);
  const centerCropY = Math.floor((srcHeight - centerCropHeight) / 2);

  // Step 2: Calculate border trim within center crop
  const trimWidth = Math.floor(centerCropWidth * BORDER_TRIM_RATIO);
  const trimHeight = Math.floor(centerCropHeight * BORDER_TRIM_RATIO);
  const trimX = centerCropX + Math.floor((centerCropWidth - trimWidth) / 2);
  const trimY = centerCropY + Math.floor((centerCropHeight - trimHeight) / 2);

  // Step 3: Draw cropped and trimmed region to canvas at MobileNet size
  canvas.width = MOBILENET_SIZE;
  canvas.height = MOBILENET_SIZE;
  
  ctx.drawImage(
    source,
    trimX, trimY, trimWidth, trimHeight, // Source rectangle
    0, 0, MOBILENET_SIZE, MOBILENET_SIZE  // Destination rectangle
  );

  // Step 4: Convert to tensor and normalize to [0, 1]
  const tensor = tf.browser.fromPixels(canvas);
  const normalized = tensor.toFloat().div(255);
  const batched = normalized.expandDims(0) as tf.Tensor4D;
  
  // Clean up intermediate tensor
  tensor.dispose();
  normalized.dispose();
  
  return batched;
}

/**
 * Preprocesses a video frame for MobileNet feature extraction.
 * Optimized for camera scanning where we want to focus on the card art region.
 * 
 * @param video - HTMLVideoElement containing the camera stream
 * @param canvas - Optional canvas to reuse for better performance
 * @returns A tensor suitable for MobileNet: shape [1, 224, 224, 3] with values in [0, 1]
 */
export async function preprocessVideoFrame(
  video: HTMLVideoElement,
  canvas?: HTMLCanvasElement
): Promise<tf.Tensor4D> {
  const workCanvas = canvas || document.createElement('canvas');
  const ctx = workCanvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Could not get canvas 2D context');
  }

  const videoWidth = video.videoWidth || 640;
  const videoHeight = video.videoHeight || 480;

  // For camera frames, we want to capture the center region where the card should be
  // This matches the overlay frame shown in the UI
  const cropWidth = Math.floor(videoWidth * CENTER_CROP_RATIO);
  const cropHeight = Math.floor(videoHeight * CENTER_CROP_RATIO);
  const cropX = Math.floor((videoWidth - cropWidth) / 2);
  const cropY = Math.floor((videoHeight - cropHeight) / 2);

  // Apply additional border trim
  const trimWidth = Math.floor(cropWidth * BORDER_TRIM_RATIO);
  const trimHeight = Math.floor(cropHeight * BORDER_TRIM_RATIO);
  const trimX = cropX + Math.floor((cropWidth - trimWidth) / 2);
  const trimY = cropY + Math.floor((cropHeight - trimHeight) / 2);

  // Draw to MobileNet size
  workCanvas.width = MOBILENET_SIZE;
  workCanvas.height = MOBILENET_SIZE;
  
  ctx.drawImage(
    video,
    trimX, trimY, trimWidth, trimHeight,
    0, 0, MOBILENET_SIZE, MOBILENET_SIZE
  );

  // Convert to normalized tensor
  const tensor = tf.browser.fromPixels(workCanvas);
  const normalized = tensor.toFloat().div(255);
  const batched = normalized.expandDims(0) as tf.Tensor4D;
  
  tensor.dispose();
  normalized.dispose();
  
  return batched;
}

/**
 * Computes cosine similarity between two embedding vectors.
 * 
 * @param a - First embedding vector
 * @param b - Second embedding vector
 * @returns Cosine similarity score between -1 and 1 (higher is more similar)
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
 * 
 * @param queryEmbedding - The embedding to search for
 * @param candidates - Array of objects with embedding arrays
 * @param topN - Number of top matches to return (default: 5)
 * @returns Sorted array of candidates with their similarity scores
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

  // Sort by score descending (higher similarity = better match)
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topN);
}
