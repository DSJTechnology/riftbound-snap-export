/**
 * OCR-based text recognition for card names using Tesseract.js
 */

import Tesseract from 'tesseract.js';
import Fuse from 'fuse.js';
import { ART_REGION, CARD_WIDTH, CARD_HEIGHT } from './embeddingConfig';

// Text region on card (below the art, where name/rules are)
const TEXT_REGION = {
  LEFT: 0.08,
  RIGHT: 0.92,
  TOP: 0.60,  // Start below art region
  BOTTOM: 0.75, // Name area (not full rules text)
} as const;

let tesseractWorker: Tesseract.Worker | null = null;
let workerInitializing = false;

/**
 * Initialize Tesseract worker (lazy loaded)
 */
async function getWorker(): Promise<Tesseract.Worker> {
  if (tesseractWorker) return tesseractWorker;
  
  if (workerInitializing) {
    // Wait for initialization
    while (workerInitializing) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (tesseractWorker) return tesseractWorker;
  }
  
  workerInitializing = true;
  try {
    tesseractWorker = await Tesseract.createWorker('eng', 1, {
      logger: () => {}, // Suppress logs
    });
    
    await tesseractWorker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -\'',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });
    
    console.log('[OCR] Tesseract worker initialized');
    return tesseractWorker;
  } finally {
    workerInitializing = false;
  }
}

/**
 * Extract the name/text region from a normalized card canvas
 */
export function extractTextRegion(cardCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = cardCanvas.width;
  const h = cardCanvas.height;
  
  const left = Math.floor(w * TEXT_REGION.LEFT);
  const right = Math.floor(w * TEXT_REGION.RIGHT);
  const top = Math.floor(h * TEXT_REGION.TOP);
  const bottom = Math.floor(h * TEXT_REGION.BOTTOM);
  
  const textW = right - left;
  const textH = bottom - top;
  
  const textCanvas = document.createElement('canvas');
  textCanvas.width = textW;
  textCanvas.height = textH;
  
  const ctx = textCanvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(
      cardCanvas,
      left, top, textW, textH,
      0, 0, textW, textH
    );
    
    // Apply preprocessing for better OCR
    preprocessForOCR(ctx, textW, textH);
  }
  
  return textCanvas;
}

/**
 * Preprocess image for better OCR accuracy
 */
function preprocessForOCR(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  // Convert to grayscale and apply thresholding
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    // Binary threshold for cleaner text
    const value = gray > 140 ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Perform OCR on a card canvas to extract the name
 */
export async function recognizeCardName(cardCanvas: HTMLCanvasElement): Promise<{
  text: string;
  confidence: number;
  rawText: string;
}> {
  try {
    const textCanvas = extractTextRegion(cardCanvas);
    const worker = await getWorker();
    
    const { data } = await worker.recognize(textCanvas);
    
    const rawText = data.text.trim();
    const confidence = data.confidence / 100; // Convert to 0-1 range
    
    // Clean up recognized text
    const text = normalizeText(rawText);
    
    console.log(`[OCR] Recognized: "${text}" (confidence: ${(confidence * 100).toFixed(1)}%)`);
    
    return { text, confidence, rawText };
  } catch (err) {
    console.error('[OCR] Recognition error:', err);
    return { text: '', confidence: 0, rawText: '' };
  }
}

/**
 * Normalize text for matching (lowercase, remove extra spaces, etc.)
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars except hyphen
    .replace(/\s+/g, ' ')         // Normalize spaces
    .trim();
}

/**
 * Compute fuzzy match score between OCR text and card name
 */
export function computeTextMatchScore(ocrText: string, cardName: string): number {
  if (!ocrText || !cardName) return 0;
  
  const normalizedOcr = normalizeText(ocrText);
  const normalizedCard = normalizeText(cardName);
  
  if (normalizedOcr === normalizedCard) return 1.0;
  
  // Use Levenshtein-based similarity
  const distance = levenshteinDistance(normalizedOcr, normalizedCard);
  const maxLen = Math.max(normalizedOcr.length, normalizedCard.length);
  
  if (maxLen === 0) return 0;
  
  return Math.max(0, 1 - distance / maxLen);
}

/**
 * Levenshtein distance for fuzzy matching
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  
  return matrix[a.length][b.length];
}

/**
 * Find best OCR matches from a list of card names
 */
export function findOCRMatches<T extends { name: string }>(
  ocrText: string,
  candidates: T[],
  topN = 5
): Array<{ item: T; score: number }> {
  if (!ocrText || candidates.length === 0) {
    return [];
  }
  
  // Use Fuse.js for fuzzy search
  const fuse = new Fuse(candidates, {
    keys: ['name'],
    includeScore: true,
    threshold: 0.6,
    ignoreLocation: true,
  });
  
  const results = fuse.search(ocrText);
  
  return results.slice(0, topN).map(r => ({
    item: r.item,
    score: 1 - (r.score || 0), // Fuse score is 0 (perfect) to 1 (worst)
  }));
}

/**
 * Cleanup worker on app unmount
 */
export async function terminateOCRWorker(): Promise<void> {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
  }
}
