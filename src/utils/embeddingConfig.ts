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

// Preprocessing crop parameters for card art region
// These values extract the art-only portion of a full card image
export const CARD_CROP = {
  // Horizontal: keep from 8% to 92% of width (84% of width, centered)
  LEFT_PERCENT: 0.08,
  RIGHT_PERCENT: 0.92,
  // Vertical: keep from 10% to 60% of height (top portion with art)
  TOP_PERCENT: 0.10,
  BOTTOM_PERCENT: 0.60,
} as const;

// Standard output size after preprocessing
export const OUTPUT_SIZE = 224;

// Quality thresholds for image gating
export const QUALITY_THRESHOLDS = {
  MIN_BRIGHTNESS: 0.15,  // Reject if average luminance below this
  MAX_BRIGHTNESS: 0.90,  // Reject if average luminance above this
  MIN_SHARPNESS: 50,     // Laplacian variance threshold for blur detection
} as const;

// Recognition thresholds
export const SIMILARITY_THRESHOLDS = {
  EXCELLENT: 0.80,    // High confidence
  GOOD: 0.70,         // Medium-high confidence
  FAIR: 0.55,         // Low confidence
  AUTO_CONFIRM: 0.80, // Threshold for auto-confirmation
} as const;
