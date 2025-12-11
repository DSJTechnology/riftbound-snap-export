import { supabase } from '@/integrations/supabase/client';

export interface TrainingImage {
  id: string;
  card_id: string;
  source: 'scan_confirm' | 'scan_correction' | 'web_training';
  image_url: string;
  created_at: string;
  used_in_model: boolean;
}

export interface WebImageResult {
  thumbnailUrl: string;
  originalUrl: string;
  title: string;
}

export interface TrainingStats {
  scan_confirm: number;
  scan_correction: number;
  web_training: number;
  total: number;
}

/**
 * Save a labeled training image from scanner confirmation or correction
 */
export async function saveTrainingLabel(
  cardId: string,
  source: 'scan_confirm' | 'scan_correction',
  imageData: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('training-label', {
      body: {
        card_id: cardId,
        source,
        image_data: imageData,
      },
    });

    if (error) {
      console.error('[trainingService] Label save error:', error);
      return { success: false, error: error.message };
    }

    if (data?.error) {
      return { success: false, error: data.error };
    }

    return { success: true };
  } catch (err) {
    console.error('[trainingService] Label save exception:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Search for web images of a card
 */
export async function searchWebImages(
  cardId?: string,
  cardName?: string
): Promise<{ results: WebImageResult[]; cardName?: string; error?: string }> {
  try {
    const params = new URLSearchParams();
    if (cardId) params.set('card_id', cardId);
    if (cardName) params.set('card_name', cardName);

    const { data, error } = await supabase.functions.invoke('training-search-images', {
      body: null,
      method: 'GET',
    });

    // For GET requests with params, we need to use a different approach
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/training-search-images?${params.toString()}`,
      {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      }
    );

    const responseData = await response.json();

    if (responseData.error) {
      return { results: [], error: responseData.error };
    }

    return { 
      results: responseData.results || [], 
      cardName: responseData.card_name,
    };
  } catch (err) {
    console.error('[trainingService] Search error:', err);
    return { results: [], error: String(err) };
  }
}

/**
 * Confirm and save selected web images as training data
 */
export async function confirmWebImages(
  cardId: string,
  imageUrls: string[]
): Promise<{ success: boolean; savedCount: number; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('training-web-confirm', {
      body: {
        card_id: cardId,
        image_urls: imageUrls,
      },
    });

    if (error) {
      console.error('[trainingService] Web confirm error:', error);
      return { success: false, savedCount: 0, error: error.message };
    }

    if (data?.error) {
      return { success: false, savedCount: 0, error: data.error };
    }

    return { success: true, savedCount: data?.saved_count || 0 };
  } catch (err) {
    console.error('[trainingService] Web confirm exception:', err);
    return { success: false, savedCount: 0, error: String(err) };
  }
}

/**
 * Get training images with optional filters
 */
export async function getTrainingImages(options?: {
  cardId?: string;
  source?: string;
  limit?: number;
  offset?: number;
}): Promise<{ images: TrainingImage[]; total: number; stats?: TrainingStats; error?: string }> {
  try {
    const params = new URLSearchParams();
    if (options?.cardId) params.set('card_id', options.cardId);
    if (options?.source) params.set('source', options.source);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/training-images?${params.toString()}`,
      {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      }
    );

    const data = await response.json();

    if (data.error) {
      return { images: [], total: 0, error: data.error };
    }

    return { 
      images: data.images || [], 
      total: data.total || 0,
      stats: data.stats,
    };
  } catch (err) {
    console.error('[trainingService] Get images error:', err);
    return { images: [], total: 0, error: String(err) };
  }
}

/**
 * Capture the current video frame as a base64 JPEG
 */
export function captureVideoFrame(
  videoElement: HTMLVideoElement,
  canvas?: HTMLCanvasElement
): string | null {
  try {
    const targetCanvas = canvas || document.createElement('canvas');
    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return null;

    targetCanvas.width = videoElement.videoWidth;
    targetCanvas.height = videoElement.videoHeight;
    ctx.drawImage(videoElement, 0, 0);

    return targetCanvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    console.error('[trainingService] Frame capture error:', err);
    return null;
  }
}
