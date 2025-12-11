/**
 * Feedback capture for scan results - stores training samples for future calibration
 */

import { supabase } from '@/integrations/supabase/client';

export interface ScanFeedbackSample {
  cardId: string;
  visualEmbedding?: number[];
  ocrText?: string;
  ocrConfidence?: number;
  visualScore?: number;
  combinedScore?: number;
  wasCorrect: boolean;
  userCorrectedTo?: string;
}

/**
 * Store a scan feedback sample for training/calibration
 */
export async function storeScanFeedback(sample: ScanFeedbackSample): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('card_scan_samples')
      .insert({
        card_id: sample.cardId,
        visual_embedding: sample.visualEmbedding,
        ocr_text: sample.ocrText,
        ocr_confidence: sample.ocrConfidence,
        visual_score: sample.visualScore,
        combined_score: sample.combinedScore,
        was_correct: sample.wasCorrect,
        user_corrected_to: sample.userCorrectedTo,
        scan_timestamp: new Date().toISOString(),
      });
    
    if (error) {
      console.error('[FeedbackCapture] Failed to store sample:', error);
      return false;
    }
    
    console.log(`[FeedbackCapture] Stored sample for ${sample.cardId}`);
    return true;
  } catch (err) {
    console.error('[FeedbackCapture] Error:', err);
    return false;
  }
}

/**
 * Get scan sample statistics for analysis
 */
export async function getScanStats(): Promise<{
  totalSamples: number;
  correctCount: number;
  correctedCount: number;
  accuracy: number;
} | null> {
  try {
    const { data, error } = await supabase
      .from('card_scan_samples')
      .select('was_correct, user_corrected_to');
    
    if (error || !data) {
      console.error('[FeedbackCapture] Failed to fetch stats:', error);
      return null;
    }
    
    const totalSamples = data.length;
    const correctCount = data.filter(s => s.was_correct).length;
    const correctedCount = data.filter(s => s.user_corrected_to).length;
    const accuracy = totalSamples > 0 ? correctCount / totalSamples : 0;
    
    return { totalSamples, correctCount, correctedCount, accuracy };
  } catch (err) {
    console.error('[FeedbackCapture] Error fetching stats:', err);
    return null;
  }
}

/**
 * Get confusion matrix data for specific cards
 */
export async function getConfusionData(cardId: string): Promise<{
  timesScanned: number;
  timesCorrect: number;
  confusedWith: Array<{ cardId: string; count: number }>;
} | null> {
  try {
    const { data, error } = await supabase
      .from('card_scan_samples')
      .select('*')
      .or(`card_id.eq.${cardId},user_corrected_to.eq.${cardId}`);
    
    if (error || !data) return null;
    
    const timesScanned = data.filter(s => s.card_id === cardId).length;
    const timesCorrect = data.filter(s => s.card_id === cardId && s.was_correct).length;
    
    // Count confusions
    const confusions: Record<string, number> = {};
    for (const sample of data) {
      if (sample.card_id === cardId && sample.user_corrected_to) {
        confusions[sample.user_corrected_to] = (confusions[sample.user_corrected_to] || 0) + 1;
      }
    }
    
    const confusedWith = Object.entries(confusions)
      .map(([id, count]) => ({ cardId: id, count }))
      .sort((a, b) => b.count - a.count);
    
    return { timesScanned, timesCorrect, confusedWith };
  } catch (err) {
    console.error('[FeedbackCapture] Error:', err);
    return null;
  }
}
