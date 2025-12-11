# Card Scanner Summary

## Architecture
- **Frontend flow (scan tab):** `AutoCardScanner` → `useEmbeddingScanner` → `normalizeCardFromVideoFrame` (OpenCV perspective correction) → resize to 224×224 → `computeEmbeddingFromCanvas` (CNN) → cosine similarity matching.
- **Embedding pipeline:** Uses **full card** (not art-only) to capture name bar, frame, art, and text for better card differentiation.
- **Multi-signal matching:** `multiSignalMatcher.ts` combines visual embeddings (70% weight) with OCR text matching (30% weight) using Fuse.js fuzzy search.
- **Feedback capture:** Confirmed scans are stored in `card_scan_samples` table for future training/calibration.
- **Data contexts:** `CardEmbeddingContext` loads and validates embeddings from `riftbound_cards` table (checks length=256, norm~1.0).
- **CNN Model:** MobileNet via TensorFlow.js, outputs 256-dim L2-normalized embeddings (sliced from larger feature vector).

## Key Files
- `src/embedding/cnnEmbedding.ts` - CNN embedding module (MobileNet + TensorFlow.js)
- `src/embedding/preprocess.ts` - Shared preprocessing: full card crop, resize to 224×224
- `src/utils/cardNormalization.ts` - OpenCV card detection + perspective correction
- `src/utils/ocrRecognition.ts` - Tesseract.js OCR for card name extraction
- `src/utils/multiSignalMatcher.ts` - Combines visual + OCR scores
- `src/utils/feedbackCapture.ts` - Stores scan samples for training
- `src/hooks/useEmbeddingScanner.ts` - Main scanner hook with auto/manual modes
- `src/contexts/CardEmbeddingContext.tsx` - Loads/validates embeddings with diagnostics
- `src/pages/EmbeddingAdmin.tsx` - Rebuild CNN embeddings for all cards

## Similarity & Thresholds
- **Cosine similarity:** Computed via dot product on L2-normalized vectors (0-1 range)
- **Thresholds:** EXCELLENT ≥0.85, GOOD ≥0.70, FAIR ≥0.55, MINIMUM ≥0.40
- **AUTO_CONFIRM:** 0.85 with margin check (top1-top2 ≥ 0.05)
- **Fusion weights:** 70% visual, 30% OCR

## Embedding Validation
- On load: Checks length=256, L2 norm in [0.95, 1.05]
- Re-normalizes if norm out of range
- Logs diagnostics: first 5 values + norm for sample cards
- Warns if first two embeddings appear identical

## Feedback Capture
- Table: `card_scan_samples` with visual_embedding, ocr_text, scores, was_correct, user_corrected_to
- Stored on every confirmed scan for future model improvement

## Running Diagnostics
1. **Sanity Tests page:** `/sanity-tests` - run preprocessing, same image, same card, different card tests
2. **Embedding Admin:** `/embedding-admin` - rebuild all card embeddings using CNN model
3. **Edge function logs:** Check Supabase logs for sync operations

## Preprocessing Pipeline (UNIFIED)
All embedding computation (sync, scanner, sanity tests) uses the same pipeline:
1. **Normalize card** - OpenCV perspective correction to 500×700 canvas
2. **Resize to 224×224** - Full card (not art-only) to capture all visual features
3. **CNN embedding** - MobileNet feature extraction, sliced to 256 dims, L2-normalized

## Known Limitations
- OCR disabled by default for speed (enable with `enableOCR: true` in useEmbeddingScanner)
- OpenCV fallback crop may produce lower quality matches (shows warning)
- CNN model takes ~2-3 seconds to load on first use
