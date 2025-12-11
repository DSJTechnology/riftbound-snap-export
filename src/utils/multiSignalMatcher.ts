/**
 * Multi-signal card matching - combines visual embeddings with OCR
 */

import { EmbeddedCard } from '@/contexts/CardEmbeddingContext';
import { findTopMatches, cosineSimilarity, l2Normalize } from './artEmbedding';
import { recognizeCardName, findOCRMatches, computeTextMatchScore } from './ocrRecognition';
import { 
  SIMILARITY_THRESHOLDS, 
  FUSION_WEIGHTS,
  getConfidenceLevel,
  hasAdequateMargin 
} from './embeddingConfig';

export interface MultiSignalMatch {
  card: EmbeddedCard;
  visualScore: number;
  ocrScore: number;
  combinedScore: number;
  confidence: 'excellent' | 'good' | 'fair' | 'low';
  hasMargin: boolean;
}

export interface MultiSignalResult {
  matches: MultiSignalMatch[];
  ocrText: string;
  ocrConfidence: number;
  needsConfirmation: boolean;
  ambiguous: boolean;
  message: string;
}

/**
 * Perform multi-signal matching using both visual embedding and OCR
 */
export async function multiSignalMatch(
  cardCanvas: HTMLCanvasElement,
  queryEmbedding: number[],
  candidates: EmbeddedCard[],
  enableOCR: boolean = true
): Promise<MultiSignalResult> {
  // Get visual matches
  const normalizedQuery = l2Normalize(queryEmbedding);
  const visualMatches = findTopMatches(normalizedQuery, candidates, 10);
  
  // Get OCR matches if enabled
  let ocrText = '';
  let ocrConfidence = 0;
  let ocrMatches: Array<{ item: EmbeddedCard; score: number }> = [];
  
  if (enableOCR) {
    try {
      const ocrResult = await recognizeCardName(cardCanvas);
      ocrText = ocrResult.text;
      ocrConfidence = ocrResult.confidence;
      
      if (ocrText && ocrConfidence > 0.3) {
        ocrMatches = findOCRMatches(ocrText, candidates, 10);
      }
    } catch (err) {
      console.warn('[MultiSignal] OCR failed:', err);
    }
  }
  
  // Combine scores
  const combinedScores = new Map<string, MultiSignalMatch>();
  
  // Add visual matches
  for (const vm of visualMatches) {
    const ocrMatch = ocrMatches.find(om => om.item.cardId === vm.item.cardId);
    const ocrScore = ocrMatch?.score || 0;
    
    const combinedScore = 
      FUSION_WEIGHTS.VISUAL * vm.score + 
      FUSION_WEIGHTS.OCR * ocrScore;
    
    combinedScores.set(vm.item.cardId, {
      card: vm.item,
      visualScore: vm.score,
      ocrScore,
      combinedScore,
      confidence: getConfidenceLevel(combinedScore),
      hasMargin: false, // Will be set later
    });
  }
  
  // Add OCR-only matches that visual might have missed
  for (const om of ocrMatches) {
    if (!combinedScores.has(om.item.cardId)) {
      // Compute visual score for this card
      const visualScore = cosineSimilarity(normalizedQuery, om.item.embedding);
      const combinedScore = 
        FUSION_WEIGHTS.VISUAL * visualScore + 
        FUSION_WEIGHTS.OCR * om.score;
      
      combinedScores.set(om.item.cardId, {
        card: om.item,
        visualScore,
        ocrScore: om.score,
        combinedScore,
        confidence: getConfidenceLevel(combinedScore),
        hasMargin: false,
      });
    }
  }
  
  // Sort by combined score
  const matches = Array.from(combinedScores.values())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, 5);
  
  // Check margin for top match
  if (matches.length >= 2) {
    matches[0].hasMargin = hasAdequateMargin(matches[0].combinedScore, matches[1].combinedScore);
  } else if (matches.length === 1) {
    matches[0].hasMargin = matches[0].combinedScore >= SIMILARITY_THRESHOLDS.EXCELLENT;
  }
  
  // Determine if confirmation is needed
  const topMatch = matches[0];
  const needsConfirmation = !topMatch || 
    topMatch.combinedScore < SIMILARITY_THRESHOLDS.AUTO_CONFIRM ||
    !topMatch.hasMargin;
  
  // Check for ambiguity (top 2 are very close)
  const ambiguous = matches.length >= 2 && 
    (matches[0].combinedScore - matches[1].combinedScore) < 0.03;
  
  // Generate message
  let message = '';
  if (!topMatch || topMatch.combinedScore < SIMILARITY_THRESHOLDS.MINIMUM) {
    message = 'No confident match found. Try repositioning the card.';
  } else if (ambiguous) {
    message = 'Multiple similar cards detected. Please select the correct one.';
  } else if (topMatch.confidence === 'low') {
    message = 'Low confidence match. Please verify.';
  } else if (!topMatch.hasMargin) {
    message = 'Close match detected. Please confirm.';
  }
  
  return {
    matches,
    ocrText,
    ocrConfidence,
    needsConfirmation,
    ambiguous,
    message,
  };
}

/**
 * Quick visual-only match (for auto-scan where speed matters)
 */
export function quickVisualMatch(
  queryEmbedding: number[],
  candidates: EmbeddedCard[],
  topN = 5
): MultiSignalMatch[] {
  const normalizedQuery = l2Normalize(queryEmbedding);
  const visualMatches = findTopMatches(normalizedQuery, candidates, topN);
  
  const matches: MultiSignalMatch[] = visualMatches.map((vm, idx) => ({
    card: vm.item,
    visualScore: vm.score,
    ocrScore: 0,
    combinedScore: vm.score, // Visual only
    confidence: getConfidenceLevel(vm.score),
    hasMargin: idx === 0 && visualMatches.length >= 2 
      ? hasAdequateMargin(vm.score, visualMatches[1].score)
      : vm.score >= SIMILARITY_THRESHOLDS.EXCELLENT,
  }));
  
  return matches;
}
