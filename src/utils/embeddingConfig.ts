/**
 * Shared configuration for card embedding preprocessing.
 * These constants MUST match between edge function and client.
 */

// Embedding vector size
export const EMBEDDING_SIZE = 256;

// Feature extraction parameters
export const COLOR_BINS = 8;
export const INTENSITY_BINS = 14;
export const GRID_SIZE = 4;
export const EDGE_FEATURES = 32;
export const TEXTURE_FEATURES = 32;
export const FREQUENCY_FEATURES = 48;

// Card dimensions for normalization (must match edge function)
export const CARD_WIDTH = 500;
export const CARD_HEIGHT = 700;

// Art region percentages on normalized card - MUST match edge function
export const ART_REGION = {
  LEFT: 0.06,
  RIGHT: 0.94,
  TOP: 0.14,
  BOTTOM: 0.58,
} as const;

// Standard output size after preprocessing
export const OUTPUT_SIZE = 224;

// Quality thresholds for image gating
export const QUALITY_THRESHOLDS = {
  MIN_BRIGHTNESS: 0.15,  // Reject if average luminance below this
  MAX_BRIGHTNESS: 0.90,  // Reject if average luminance above this
  MIN_SHARPNESS: 50,     // Laplacian variance threshold for blur detection
} as const;

// Recognition thresholds - configurable
export const SIMILARITY_THRESHOLDS = {
  EXCELLENT: 0.85,      // High confidence - can auto-confirm
  GOOD: 0.70,           // Medium confidence - show modal
  FAIR: 0.55,           // Low confidence - show warning
  MINIMUM: 0.40,        // Below this, don't even suggest
  AUTO_CONFIRM: 0.85,   // Threshold for auto-confirmation in auto-scan
  MARGIN_REQUIRED: 0.05, // Minimum gap between top-1 and top-2 for high confidence
} as const;

// Multi-signal fusion weights
export const FUSION_WEIGHTS = {
  VISUAL: 0.7,          // Weight for visual embedding similarity
  OCR: 0.3,             // Weight for OCR text match
} as const;

// Validation thresholds
export const EMBEDDING_VALIDATION = {
  MIN_NORM: 0.95,       // L2 norm should be close to 1
  MAX_NORM: 1.05,
  EXPECTED_LENGTH: EMBEDDING_SIZE,
} as const;

/**
 * Validate an embedding vector
 */
export function validateEmbedding(embedding: number[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  if (!Array.isArray(embedding)) {
    return { valid: false, issues: ['Embedding is not an array'] };
  }
  
  if (embedding.length !== EMBEDDING_VALIDATION.EXPECTED_LENGTH) {
    issues.push(`Length ${embedding.length} != expected ${EMBEDDING_VALIDATION.EXPECTED_LENGTH}`);
  }
  
  const norm = Math.sqrt(embedding.reduce((a, b) => a + b * b, 0));
  if (norm < EMBEDDING_VALIDATION.MIN_NORM || norm > EMBEDDING_VALIDATION.MAX_NORM) {
    issues.push(`L2 norm ${norm.toFixed(4)} outside valid range [${EMBEDDING_VALIDATION.MIN_NORM}, ${EMBEDDING_VALIDATION.MAX_NORM}]`);
  }
  
  // Check for all zeros or NaN
  const hasValidValues = embedding.some(v => v !== 0 && !isNaN(v));
  if (!hasValidValues) {
    issues.push('Embedding contains no valid non-zero values');
  }
  
  return { valid: issues.length === 0, issues };
}

/**
 * Get confidence level label based on score
 */
export function getConfidenceLevel(score: number): 'excellent' | 'good' | 'fair' | 'low' {
  if (score >= SIMILARITY_THRESHOLDS.EXCELLENT) return 'excellent';
  if (score >= SIMILARITY_THRESHOLDS.GOOD) return 'good';
  if (score >= SIMILARITY_THRESHOLDS.FAIR) return 'fair';
  return 'low';
}

/**
 * Check if match has sufficient margin over runner-up
 */
export function hasAdequateMargin(topScore: number, secondScore: number): boolean {
  return (topScore - secondScore) >= SIMILARITY_THRESHOLDS.MARGIN_REQUIRED;
}
