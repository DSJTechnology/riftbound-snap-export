# Card Scanner Summary

## Architecture
- **Frontend flow (scan tab):** `src/components/AutoCardScanner.tsx` drives the camera UI and uses `useEmbeddingScanner` (`src/hooks/useEmbeddingScanner.ts`). The hook opens the camera, tries OpenCV-based perspective correction (`normalizeCardFromVideoFrame`, `src/utils/cardNormalization.ts`), crops the art region (`extractArtRegion`), extracts a handcrafted 256-d embedding (`extractEmbeddingFromArtCanvas`, `src/utils/artEmbedding.ts`), ranks candidates via `findTopMatches`, applies similarity gates from `SIMILARITY_THRESHOLDS` (`src/utils/embeddingConfig.ts`), and prompts for confirmation before adding to the collection.
- **Other scan paths present:** `useImageScanner` (hash/Hamming flow using `CardHashContext`) and `CardScanner`/`useAutoScanner` (OCR on card ID text). These are still in the codebase but the auto scanner UI currently wires to the embedding flow.
- **Data/context:** Card metadata comes from `CardDatabaseContext` (Supabase fetch with localStorage fallback to `src/data/cardDatabase.ts`). Embeddings load via `CardEmbeddingContext` from Supabase `riftbound_cards` table. Hash context exists but hashes are empty in the current sync.
- **Similarity:** `cosineSimilarity` in `src/utils/artEmbedding.ts:222` and `src/utils/imagePreprocess.ts:344` return a raw dot product (assumes pre-normalized vectors). `findTopMatches` ranks by that score. Thresholds define excellent/good/fair and auto-confirm at ≥0.80 (`src/utils/embeddingConfig.ts`).

## Backend / Edge Flow
- **Sync function:** `supabase/functions/sync-riftbound-cards/index.ts` (Deno edge function) fetches cards from dotGG, downloads card images, uploads them to the `riftbound-cards` bucket, computes a 256-d art-focused embedding (`computeCardEmbedding` → crop art region → resize to 224×224 → `extractFeaturesFromPixels` → `l2Normalize`), and upserts into `riftbound_cards` with fields `card_id`, `name`, `set_name`, `rarity`, `art_url`, `embedding`, and an empty `hash`.
- **Schema:** `supabase/migrations/*` create `riftbound_cards` with `card_id`, `name`, `set_name`, `rarity`, `art_url`, `hash`, `embedding jsonb`, plus public read policies and the storage bucket.

## Current Issues / Likely Causes of 0.80–0.86 Clustering
- **Cosine similarity not actually normalized:** `cosineSimilarity` (`src/utils/artEmbedding.ts:222`, `src/utils/imagePreprocess.ts:344`) returns only the dot product and skips norm checks. This assumes every stored embedding is perfectly L2-normalized; if any aren’t (or lengths differ), scores inflate and cluster in a narrow band.
- **No embedding integrity checks on load:** `CardEmbeddingContext` parses JSON and trusts the values without validating length, norm, or uniqueness. Identical or malformed embeddings would silently enter the index and yield uniform scores.
- **Weak/duplicate preprocessing paths:** There are two different preprocessing stacks:
  - Active scan path: `cardNormalization.ts` (ART_REGION 6–94% width, 14–58% height) → `artEmbedding.ts`.
  - Unused-but-present path: `imagePreprocess.ts` (CARD_CROP 8–92% width, 10–60% height, quality checks) with its own cosine implementation.
  The mismatch invites drift between edge generation and live scans and makes it easy to call the wrong helper.
- **Fallback crops still advance scanning:** If OpenCV fails, `fallbackCrop` (`src/utils/cardNormalization.ts:247`) still produces a centered crop and the pipeline proceeds, likely creating very similar embeddings across different cards and biasing toward a frequent top card (“Boots of Swiftness” symptom).
- **Edge embedding quality risk:** The edge function’s `decodeWebPToPixels` fabricates “pseudo-pixels” from compressed bytes when real decoding fails. That can yield nearly identical embeddings across cards, again compressing similarity spread.
- **Hash path unusable:** The sync writes `hash: ''` for every card; `useImageScanner` would compare against empty hashes, so that matcher cannot work correctly.
- **No score distribution validation:** There is no script/test to confirm that each card’s own art is top-1 with a healthy top1–top2 margin, so clustered scores go unnoticed.

## Plan to Fix Recognition Quality and Add Validations
- **Normalize and validate embeddings:** Rework cosine to the proper normalized form (with length/norm guards), and enforce L2-normalization plus length checks when loading/saving embeddings. Add a diagnostics script/endpoint to log sample embeddings, norms, and first values per card.
- **Unify preprocessing:** Pick one canonical pipeline for both edge generation and live scans (same crop percentages, resize to 224×224, normalization). Eliminate or gate the outdated helper set and ensure OpenCV fallback either retries or blocks auto-confirm instead of producing low-signal crops.
- **Score validation harness:** Add a dev script/test that uses each stored card image as a query, computes similarities against all embeddings, reports self-match accuracy/top1-top2 gap, and fails when metrics fall below thresholds.
- **Multi-signal matching:** Add OCR over the name/rules region (tesseract.js is already present) and fuse text score with visual similarity (e.g., weighted or text-first tie-break). Surface low-confidence cases by showing top-k choices and requiring confirmation when scores are close or below minimum.
- **Runtime thresholds & UI feedback:** Introduce configurable minimum similarity and margin checks; when violated, present “low confidence” messaging instead of auto-picking. Include top-k debug view (scores + OCR text) in dev mode.
- **Feedback capture:** When the user confirms a scan, store the embedding + OCR text + chosen cardId (e.g., `card_scan_samples`) to enable future fine-tuning or calibration of per-card confusions.
- **Tests/metrics:** Unit tests for preprocessing (crop math, normalization), cosine similarity, text normalization/fuzzy match, and integration tests for the self-match harness. Keep CSV export and collection flows intact while refactoring the recognition stack.
