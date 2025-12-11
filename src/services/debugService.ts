import { supabase } from '@/integrations/supabase/client';

export interface PreprocessResult {
  card_id: string | null;
  original_image_url: string | null;
  preprocessed_preview: string;
  width: number;
  height: number;
  stats: {
    mean_pixel_value: number;
    std_pixel_value: number;
    channels: number;
    has_detected_card_region: boolean;
    card_region_bbox: [number, number, number, number];
    original_dimensions?: [number, number];
    art_dimensions?: [number, number];
  };
}

export interface EncodeResult {
  dimension: number;
  norm: number;
  embedding: number[];
  trailing_zero_count: number;
  sample_values: {
    first_10: number[];
    last_10: number[];
  };
}

export interface CompareResult {
  embedding1: {
    norm: number;
    dimension: number;
    trailing_zero_count: number;
  };
  embedding2: {
    norm: number;
    dimension: number;
    trailing_zero_count: number;
  };
  cosine_similarity: number;
  dot_product: number;
}

export interface TrainingImageInfo {
  id: string;
  image_url: string;
  source: string;
  created_at: string;
}

export interface CardTrainingImages {
  card_id: string;
  images: TrainingImageInfo[];
}

// Sanity test thresholds
export const SANITY_THRESHOLDS = {
  SAME_IMAGE: {
    PASS: 0.99,
    WARN: 0.97,
  },
  SAME_CARD: {
    PASS: 0.90,
    WARN: 0.80,
  },
  DIFFERENT_CARD: {
    PASS: 0.75,  // Should be BELOW this for pass
    WARN: 0.85,  // Should be BELOW this for warn
  },
};

export type TestStatus = 'pass' | 'warn' | 'fail' | 'pending' | 'error';

export interface TestResult {
  status: TestStatus;
  message: string;
  details?: Record<string, any>;
}

/**
 * Run preprocessing on an image
 */
export async function preprocessImage(
  input: { image_data?: string; training_image_id?: string }
): Promise<{ data: PreprocessResult | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('debug-preprocess', {
      body: input,
    });
    
    if (error) {
      return { data: null, error: error.message };
    }
    
    if (data.error) {
      return { data: null, error: data.error };
    }
    
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Encode an image to embedding
 */
export async function encodeImage(
  input: { image_data?: string; training_image_id?: string }
): Promise<{ data: EncodeResult | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('debug-encode', {
      body: input,
    });
    
    if (error) {
      return { data: null, error: error.message };
    }
    
    if (data.error) {
      return { data: null, error: data.error };
    }
    
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Compare two images via embeddings
 */
export async function compareImages(
  image1: { training_image_id?: string; image_data?: string },
  image2: { training_image_id?: string; image_data?: string }
): Promise<{ data: CompareResult | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('debug-compare', {
      body: { image1, image2 },
    });
    
    if (error) {
      return { data: null, error: error.message };
    }
    
    if (data.error) {
      return { data: null, error: data.error };
    }
    
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Get training images for a card
 */
export async function getCardTrainingImages(
  cardId: string,
  limit = 10
): Promise<{ data: CardTrainingImages | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('debug-training-images', {
      body: null,
      method: 'GET',
    });
    
    // Use direct fetch since invoke doesn't support query params well for GET
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/debug-training-images?card_id=${encodeURIComponent(cardId)}&limit=${limit}`;
    
    const response = await fetch(url, {
      headers: {
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { data: null, error: errorData.error || `HTTP ${response.status}` };
    }
    
    const result = await response.json();
    
    if (result.error) {
      return { data: null, error: result.error };
    }
    
    return { data: result, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Evaluate same-image test result
 */
export function evaluateSameImageTest(similarity: number): TestResult {
  if (similarity >= SANITY_THRESHOLDS.SAME_IMAGE.PASS) {
    return {
      status: 'pass',
      message: `Same image encodes consistently (cosine ${(similarity * 100).toFixed(1)}%)`,
      details: { similarity },
    };
  } else if (similarity >= SANITY_THRESHOLDS.SAME_IMAGE.WARN) {
    return {
      status: 'warn',
      message: `Same image has minor variation (cosine ${(similarity * 100).toFixed(1)}%)`,
      details: { similarity },
    };
  } else {
    return {
      status: 'fail',
      message: `Same image encodes inconsistently (cosine ${(similarity * 100).toFixed(1)}%). Check preprocessing/encoder.`,
      details: { similarity },
    };
  }
}

/**
 * Evaluate same-card test result
 */
export function evaluateSameCardTest(similarity: number): TestResult {
  if (similarity >= SANITY_THRESHOLDS.SAME_CARD.PASS) {
    return {
      status: 'pass',
      message: `Different photos of same card match well (cosine ${(similarity * 100).toFixed(1)}%)`,
      details: { similarity },
    };
  } else if (similarity >= SANITY_THRESHOLDS.SAME_CARD.WARN) {
    return {
      status: 'warn',
      message: `Same card photos have moderate similarity (cosine ${(similarity * 100).toFixed(1)}%)`,
      details: { similarity },
    };
  } else {
    return {
      status: 'fail',
      message: `Same card photos have low similarity (cosine ${(similarity * 100).toFixed(1)}%). May cause recognition issues.`,
      details: { similarity },
    };
  }
}

/**
 * Evaluate different-card test result
 */
export function evaluateDifferentCardTest(similarity: number): TestResult {
  if (similarity <= SANITY_THRESHOLDS.DIFFERENT_CARD.PASS) {
    return {
      status: 'pass',
      message: `Different cards are well separated (cosine ${(similarity * 100).toFixed(1)}%)`,
      details: { similarity },
    };
  } else if (similarity <= SANITY_THRESHOLDS.DIFFERENT_CARD.WARN) {
    return {
      status: 'warn',
      message: `Different cards have moderate overlap (cosine ${(similarity * 100).toFixed(1)}%)`,
      details: { similarity },
    };
  } else {
    return {
      status: 'fail',
      message: `Different cards are too similar (cosine ${(similarity * 100).toFixed(1)}%). May cause false matches.`,
      details: { similarity },
    };
  }
}

/**
 * Evaluate preprocessing test result
 */
export function evaluatePreprocessTest(result: PreprocessResult): TestResult {
  const issues: string[] = [];
  
  if (!result.stats.has_detected_card_region) {
    issues.push('No card region detected');
  }
  
  if (result.stats.mean_pixel_value < 0.1 || result.stats.mean_pixel_value > 0.9) {
    issues.push(`Abnormal brightness (mean: ${result.stats.mean_pixel_value.toFixed(2)})`);
  }
  
  if (result.stats.std_pixel_value < 0.05) {
    issues.push(`Low contrast (std: ${result.stats.std_pixel_value.toFixed(2)})`);
  }
  
  if (issues.length === 0) {
    return {
      status: 'pass',
      message: `Preprocessing produced valid ${result.width}x${result.height} image with card region detected.`,
      details: result.stats,
    };
  } else if (issues.length === 1 && result.stats.has_detected_card_region) {
    return {
      status: 'warn',
      message: `Preprocessing completed with warning: ${issues[0]}`,
      details: result.stats,
    };
  } else {
    return {
      status: 'fail',
      message: `Preprocessing failed: ${issues.join(', ')}`,
      details: result.stats,
    };
  }
}
