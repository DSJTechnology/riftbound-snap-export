/**
 * Card detection and perspective normalization utilities.
 * Uses OpenCV.js via the shared cardDetection module.
 */

import {
  loadOpenCV as loadOpenCVShared,
  isOpenCVReady as isOpenCVReadyShared,
  detectAndWarpCard,
  drawQuadOverlay,
  CardQuad,
  CARD_ASPECT_RATIO,
} from '@/shared/cardDetection';

// Canonical card dimensions (3.5" x 2.5" ratio = 7:5 = 700:500 or similar)
export const CARD_WIDTH = 500;
export const CARD_HEIGHT = 700;

// Art region percentages on normalized card
export const ART_REGION = {
  LEFT: 0.06,
  RIGHT: 0.94,
  TOP: 0.14,
  BOTTOM: 0.58,
} as const;

// Default inset fraction to avoid sleeve borders
const INSET_FRACTION = 0.05;

// Re-export shared functions
export const loadOpenCV = loadOpenCVShared;
export const isOpenCVReady = isOpenCVReadyShared;

// Export CardQuad type for consumers
export type { CardQuad };

export interface NormalizeResult {
  canvas: HTMLCanvasElement;
  success: boolean;
  message: string;
  detectedQuad?: CardQuad;
}

/**
 * Detect card edges and apply perspective correction.
 * Returns a canvas with the normalized card, or null if detection fails.
 */
export async function normalizeCardFromVideoFrame(
  video: HTMLVideoElement
): Promise<NormalizeResult> {
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = CARD_WIDTH;
  resultCanvas.height = CARD_HEIGHT;
  const resultCtx = resultCanvas.getContext('2d')!;

  // Capture frame from video
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = video.videoWidth;
  tempCanvas.height = video.videoHeight;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.drawImage(video, 0, 0);

  // Use shared detection and warp with inset
  const { warped, detection } = detectAndWarpCard(tempCanvas, {
    outputWidth: CARD_WIDTH,
    outputHeight: CARD_HEIGHT,
    insetFraction: INSET_FRACTION,
  });

  // Copy warped result to our result canvas
  resultCtx.drawImage(warped.canvas, 0, 0);

  return {
    canvas: resultCanvas,
    success: detection.quad !== null,
    message: detection.message,
    detectedQuad: detection.quad || undefined,
  };
}

/**
 * Fallback: center crop assuming card is roughly centered
 */
export function fallbackCrop(
  video: HTMLVideoElement,
  resultCanvas: HTMLCanvasElement,
  resultCtx: CanvasRenderingContext2D
): NormalizeResult {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  
  // Assume card takes up ~60% of the frame, centered
  const cardAspect = CARD_WIDTH / CARD_HEIGHT;
  const frameAspect = vw / vh;
  
  let cropW: number, cropH: number, cropX: number, cropY: number;
  
  if (frameAspect > cardAspect) {
    // Frame is wider, fit by height
    cropH = vh * 0.7;
    cropW = cropH * cardAspect;
  } else {
    // Frame is taller, fit by width
    cropW = vw * 0.7;
    cropH = cropW / cardAspect;
  }
  
  cropX = (vw - cropW) / 2;
  cropY = (vh - cropH) / 2;

  resultCtx.drawImage(
    video,
    cropX, cropY, cropW, cropH,
    0, 0, CARD_WIDTH, CARD_HEIGHT
  );

  return { 
    canvas: resultCanvas, 
    success: false, 
    message: 'Could not detect card edges. Try holding the card flatter against a contrasting background.' 
  };
}

/**
 * Extract art region from a normalized card canvas.
 */
export function extractArtRegion(cardCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = cardCanvas.width;
  const h = cardCanvas.height;
  
  const left = Math.floor(w * ART_REGION.LEFT);
  const right = Math.floor(w * ART_REGION.RIGHT);
  const top = Math.floor(h * ART_REGION.TOP);
  const bottom = Math.floor(h * ART_REGION.BOTTOM);
  
  const artW = right - left;
  const artH = bottom - top;
  
  const artCanvas = document.createElement('canvas');
  artCanvas.width = artW;
  artCanvas.height = artH;
  
  const ctx = artCanvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(
      cardCanvas,
      left, top, artW, artH,
      0, 0, artW, artH
    );
  }
  
  return artCanvas;
}

/**
 * Draw debug overlay showing the crop regions on a canvas
 */
export function drawDebugOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  // Draw card detection guide box
  const cardAspect = CARD_WIDTH / CARD_HEIGHT;
  let guideW: number, guideH: number;
  
  if (width / height > cardAspect) {
    guideH = height * 0.7;
    guideW = guideH * cardAspect;
  } else {
    guideW = width * 0.7;
    guideH = guideW / cardAspect;
  }
  
  const guideX = (width - guideW) / 2;
  const guideY = (height - guideH) / 2;
  
  // Outer card guide
  ctx.strokeStyle = 'rgba(0, 255, 0, 0.7)';
  ctx.lineWidth = 2;
  ctx.strokeRect(guideX, guideY, guideW, guideH);
  
  // Art region within card
  const artLeft = guideX + guideW * ART_REGION.LEFT;
  const artTop = guideY + guideH * ART_REGION.TOP;
  const artRight = guideX + guideW * ART_REGION.RIGHT;
  const artBottom = guideY + guideH * ART_REGION.BOTTOM;
  
  ctx.strokeStyle = 'rgba(255, 255, 0, 0.7)';
  ctx.lineWidth = 2;
  ctx.strokeRect(artLeft, artTop, artRight - artLeft, artBottom - artTop);
  
  // Labels
  ctx.fillStyle = 'rgba(0, 255, 0, 0.9)';
  ctx.font = '12px sans-serif';
  ctx.fillText('Card', guideX + 4, guideY + 14);
  
  ctx.fillStyle = 'rgba(255, 255, 0, 0.9)';
  ctx.fillText('Art Region', artLeft + 4, artTop + 14);
}

/**
 * Draw detected quad overlay on a canvas
 */
export function drawDetectedQuadOverlay(
  ctx: CanvasRenderingContext2D,
  quad: CardQuad,
  color: string = '#00ff00'
): void {
  drawQuadOverlay(ctx, quad, color, 3);
}
