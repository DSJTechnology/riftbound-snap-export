/**
 * CNN-based embedding extraction using TensorFlow.js and MobileNet.
 * This module provides consistent embeddings computed in the browser.
 */

import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';

export const EMBEDDING_SIZE = 256;
export const MODEL_INPUT_SIZE = 224;

// Module-level cache for the model
let cachedModel: mobilenet.MobileNet | null = null;
let isLoading = false;
let loadPromise: Promise<void> | null = null;

/**
 * Load the MobileNet model (lazy, cached)
 */
export async function loadEmbeddingModel(): Promise<void> {
  if (cachedModel) {
    return;
  }
  
  if (isLoading && loadPromise) {
    return loadPromise;
  }
  
  isLoading = true;
  loadPromise = (async () => {
    try {
      console.log('[CNN Embedding] Loading MobileNet model...');
      await tf.ready();
      console.log('[CNN Embedding] TensorFlow.js ready, backend:', tf.getBackend());
      
      // Load MobileNet v2 with alpha 1.0 for best feature quality
      cachedModel = await mobilenet.load({
        version: 2,
        alpha: 1.0,
      });
      
      console.log('[CNN Embedding] MobileNet model loaded successfully');
    } catch (err) {
      console.error('[CNN Embedding] Failed to load model:', err);
      throw err;
    } finally {
      isLoading = false;
    }
  })();
  
  return loadPromise;
}

/**
 * Check if model is loaded
 */
export function isModelLoaded(): boolean {
  return cachedModel !== null;
}

/**
 * Get model loading status
 */
export function getModelStatus(): { loaded: boolean; loading: boolean } {
  return { loaded: cachedModel !== null, loading: isLoading };
}

/**
 * L2 normalize a vector
 */
export function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map(v => v / norm);
}

/**
 * Compute embedding from a canvas element.
 * The canvas should contain the preprocessed card/art image.
 * Returns a 256-dimensional L2-normalized vector.
 */
export async function computeEmbeddingFromCanvas(
  canvas: HTMLCanvasElement
): Promise<number[]> {
  // Ensure model is loaded
  await loadEmbeddingModel();
  
  if (!cachedModel) {
    throw new Error('Model failed to load');
  }
  
  let inputTensor: tf.Tensor3D | null = null;
  let resizedTensor: tf.Tensor3D | null = null;
  let batchedTensor: tf.Tensor4D | null = null;
  let embeddingTensor: tf.Tensor | null = null;
  
  try {
    // Convert canvas to tensor
    inputTensor = tf.browser.fromPixels(canvas);
    
    // Resize to model input size (224x224)
    resizedTensor = tf.image.resizeBilinear(inputTensor, [MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
    
    // Add batch dimension
    batchedTensor = resizedTensor.expandDims(0) as tf.Tensor4D;
    
    // Get feature embedding using infer with embedding=true
    // This returns the global average pooled features (1280-dim for MobileNet v2)
    embeddingTensor = cachedModel.infer(batchedTensor, true) as tf.Tensor;
    
    // Convert to array
    const fullEmbedding = await embeddingTensor.data();
    const embeddingArray = Array.from(fullEmbedding);
    
    // Take first 256 elements and L2 normalize
    const truncated = embeddingArray.slice(0, EMBEDDING_SIZE);
    
    // Pad if needed (unlikely for MobileNet which outputs 1280)
    while (truncated.length < EMBEDDING_SIZE) {
      truncated.push(0);
    }
    
    return l2Normalize(truncated);
  } finally {
    // Clean up tensors
    if (inputTensor) inputTensor.dispose();
    if (resizedTensor) resizedTensor.dispose();
    if (batchedTensor) batchedTensor.dispose();
    if (embeddingTensor) embeddingTensor.dispose();
  }
}

/**
 * Compute embedding from an HTMLImageElement
 */
export async function computeEmbeddingFromImage(
  image: HTMLImageElement
): Promise<number[]> {
  // Create a canvas and draw the image
  const canvas = document.createElement('canvas');
  canvas.width = MODEL_INPUT_SIZE;
  canvas.height = MODEL_INPUT_SIZE;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  ctx.drawImage(image, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  
  return computeEmbeddingFromCanvas(canvas);
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  
  const minLen = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < minLen; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  
  return dot / denom;
}

/**
 * Compute L2 norm of a vector
 */
export function computeNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((a, b) => a + b * b, 0));
}
