# Card Scanner Summary

## Architecture
- **Frontend flow (scan tab):** `AutoCardScanner` → `useEmbeddingScanner` → `normalizeCardFromVideoFrame` (OpenCV perspective correction) → `extractArtRegion` → `extractEmbeddingFromArtCanvas` → `multiSignalMatch` (visual + optional OCR) → thresholds in `embeddingConfig.ts`.
- **Multi-signal matching:** `multiSignalMatcher.ts` combines visual embeddings (70% weight) with OCR text matching (30% weight) using Fuse.js fuzzy search.
- **Feedback capture:** Confirmed scans are stored in `card_scan_samples` table for future training/calibration.
- **Data contexts:** `CardEmbeddingContext` loads and validates embeddings from `riftbound_cards` table (checks length=256, norm~1.0).
- **Edge sync:** `sync-riftbound-cards` processes cards in batches of 25, computes 256-d embeddings from art region crops.

## Key Files
- `src/utils/embeddingConfig.ts` - All shared constants, thresholds, validation helpers
- `src/utils/artEmbedding.ts` - CANONICAL feature extraction pipeline (must match edge function)
- `src/utils/cardNormalization.ts` - OpenCV card detection + perspective correction
- `src/utils/ocrRecognition.ts` - Tesseract.js OCR for card name extraction
- `src/utils/multiSignalMatcher.ts` - Combines visual + OCR scores
- `src/utils/feedbackCapture.ts` - Stores scan samples for training
- `src/hooks/useEmbeddingScanner.ts` - Main scanner hook with auto/manual modes
- `src/contexts/CardEmbeddingContext.tsx` - Loads/validates embeddings with diagnostics

## Similarity & Thresholds
- **Cosine similarity:** Proper implementation in `artEmbedding.ts` handles non-normalized vectors
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
1. **Check embedding diversity:** Browser console shows `[CardEmbeddingContext] Embedding diagnostics` on load
2. **Check scan matches:** Console logs top 5 matches with scores on each scan
3. **Edge function logs:** Check Supabase logs for `DIAGNOSTIC` entries showing per-card embedding samples

## Known Limitations
- Edge function WebP decode creates pseudo-pixels from compressed data (not true decode)
- OCR disabled by default for speed (enable with `enableOCR: true` in useEmbeddingScanner)
- OpenCV fallback crop may produce lower quality matches (shows warning)
