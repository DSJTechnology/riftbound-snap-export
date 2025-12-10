/**
 * React hook for loading and managing the MobileNet model for feature extraction.
 * Uses TensorFlow.js to run MobileNet in the browser for computing image embeddings.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';

interface UseMobilenetModelReturn {
  model: mobilenet.MobileNet | null;
  isLoading: boolean;
  isReady: boolean;
  error: string | null;
  getEmbedding: (tensor: tf.Tensor4D) => Promise<number[] | null>;
}

export function useMobilenetModel(): UseMobilenetModelReturn {
  const [model, setModel] = useState<mobilenet.MobileNet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    const loadModel = async () => {
      try {
        console.log('[MobileNet] Loading model...');
        setIsLoading(true);
        setError(null);

        // Ensure TensorFlow.js is ready
        await tf.ready();
        console.log('[MobileNet] TensorFlow.js ready, backend:', tf.getBackend());

        // Load MobileNet v2 with alpha 1.0 for best accuracy
        const loadedModel = await mobilenet.load({
          version: 2,
          alpha: 1.0,
        });

        console.log('[MobileNet] Model loaded successfully');
        setModel(loadedModel);
      } catch (err) {
        console.error('[MobileNet] Failed to load model:', err);
        setError(err instanceof Error ? err.message : 'Failed to load MobileNet model');
      } finally {
        setIsLoading(false);
      }
    };

    loadModel();

    // Cleanup on unmount
    return () => {
      // Note: MobileNet model doesn't have a dispose method,
      // but we can clean up any tensors if needed
    };
  }, []);

  /**
   * Extracts an embedding vector from a preprocessed image tensor.
   * The tensor should be shape [1, 224, 224, 3] with values in [0, 1].
   */
  const getEmbedding = useCallback(async (tensor: tf.Tensor4D): Promise<number[] | null> => {
    if (!model) {
      console.warn('[MobileNet] Model not loaded yet');
      return null;
    }

    try {
      // Use infer with embedding=true to get feature vector instead of classification
      const embedding = model.infer(tensor, true) as tf.Tensor;
      
      // Convert to regular array
      const data = await embedding.data();
      const result = Array.from(data);
      
      // Clean up the embedding tensor
      embedding.dispose();
      
      return result;
    } catch (err) {
      console.error('[MobileNet] Failed to compute embedding:', err);
      return null;
    }
  }, [model]);

  return {
    model,
    isLoading,
    isReady: model !== null && !isLoading,
    error,
    getEmbedding,
  };
}
