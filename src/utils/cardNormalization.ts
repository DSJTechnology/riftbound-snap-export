/**
 * Card detection and perspective normalization utilities.
 * Uses OpenCV.js for card edge detection and perspective correction.
 */

// OpenCV.js will be loaded dynamically
declare const cv: any;

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

let opencvLoaded = false;
let opencvLoadPromise: Promise<void> | null = null;

/**
 * Load OpenCV.js dynamically
 */
export async function loadOpenCV(): Promise<void> {
  if (opencvLoaded) return;
  
  if (opencvLoadPromise) {
    await opencvLoadPromise;
    return;
  }

  opencvLoadPromise = new Promise((resolve, reject) => {
    // Check if already loaded
    if (typeof cv !== 'undefined' && cv.Mat) {
      opencvLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;
    
    script.onload = () => {
      // OpenCV.js needs time to initialize
      const checkReady = () => {
        if (typeof cv !== 'undefined' && cv.Mat) {
          opencvLoaded = true;
          console.log('[CardNormalization] OpenCV.js loaded');
          resolve();
        } else {
          setTimeout(checkReady, 50);
        }
      };
      checkReady();
    };
    
    script.onerror = () => {
      console.error('[CardNormalization] Failed to load OpenCV.js');
      reject(new Error('Failed to load OpenCV.js'));
    };
    
    document.head.appendChild(script);
  });

  await opencvLoadPromise;
}

/**
 * Check if OpenCV is loaded and ready
 */
export function isOpenCVReady(): boolean {
  return opencvLoaded && typeof cv !== 'undefined' && cv.Mat;
}

/**
 * Order 4 corner points in consistent order: top-left, top-right, bottom-right, bottom-left
 */
function orderPoints(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  // Sort by sum (x+y) to find TL and BR
  const sorted = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const tl = sorted[0];
  const br = sorted[3];
  
  // Sort by difference (y-x) to find TR and BL
  const sortedDiff = [...pts].sort((a, b) => (a.y - a.x) - (b.y - b.x));
  const tr = sortedDiff[0];
  const bl = sortedDiff[3];
  
  return [tl, tr, br, bl];
}

/**
 * Detect card edges and apply perspective correction.
 * Returns a canvas with the normalized card, or null if detection fails.
 */
export async function normalizeCardFromVideoFrame(
  video: HTMLVideoElement
): Promise<{ canvas: HTMLCanvasElement; success: boolean; message: string }> {
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = CARD_WIDTH;
  resultCanvas.height = CARD_HEIGHT;
  const resultCtx = resultCanvas.getContext('2d')!;

  // If OpenCV not ready, fall back to center crop
  if (!isOpenCVReady()) {
    console.log('[CardNormalization] OpenCV not ready, using fallback crop');
    return fallbackCrop(video, resultCanvas, resultCtx);
  }

  try {
    // Capture frame from video
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.drawImage(video, 0, 0);

    // Convert to OpenCV Mat
    const src = cv.imread(tempCanvas);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const edges = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();

    // Convert to grayscale
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    
    // Apply Gaussian blur
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    
    // Canny edge detection
    cv.Canny(blurred, edges, 50, 150);
    
    // Dilate to close gaps
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, edges, kernel);
    
    // Find contours
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // Find the largest 4-sided contour
    let bestContour: any = null;
    let maxArea = 0;
    const minArea = (video.videoWidth * video.videoHeight) * 0.1; // Card should be at least 10% of frame

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      
      if (area > minArea && area > maxArea) {
        // Approximate to polygon
        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * peri, true);
        
        // Check if it's a quadrilateral
        if (approx.rows === 4) {
          maxArea = area;
          if (bestContour) bestContour.delete();
          bestContour = approx;
        } else {
          approx.delete();
        }
      }
    }

    // Clean up intermediate mats
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    kernel.delete();
    hierarchy.delete();
    
    for (let i = 0; i < contours.size(); i++) {
      contours.get(i).delete();
    }
    contours.delete();

    if (!bestContour) {
      console.log('[CardNormalization] No card contour found, using fallback');
      return fallbackCrop(video, resultCanvas, resultCtx);
    }

    // Extract corner points
    const corners: { x: number; y: number }[] = [];
    for (let i = 0; i < 4; i++) {
      corners.push({
        x: bestContour.data32S[i * 2],
        y: bestContour.data32S[i * 2 + 1],
      });
    }
    bestContour.delete();

    // Order points consistently
    const orderedCorners = orderPoints(corners);

    // Create perspective transform
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      orderedCorners[0].x, orderedCorners[0].y,
      orderedCorners[1].x, orderedCorners[1].y,
      orderedCorners[2].x, orderedCorners[2].y,
      orderedCorners[3].x, orderedCorners[3].y,
    ]);

    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      CARD_WIDTH, 0,
      CARD_WIDTH, CARD_HEIGHT,
      0, CARD_HEIGHT,
    ]);

    const M = cv.getPerspectiveTransform(srcPts, dstPts);
    
    // Read source again for warping
    const srcForWarp = cv.imread(tempCanvas);
    const warped = new cv.Mat();
    
    cv.warpPerspective(srcForWarp, warped, M, new cv.Size(CARD_WIDTH, CARD_HEIGHT));
    
    // Write to result canvas
    cv.imshow(resultCanvas, warped);

    // Clean up
    srcPts.delete();
    dstPts.delete();
    M.delete();
    srcForWarp.delete();
    warped.delete();

    console.log('[CardNormalization] Card detected and normalized');
    return { canvas: resultCanvas, success: true, message: 'Card detected' };

  } catch (err) {
    console.error('[CardNormalization] Error during detection:', err);
    return fallbackCrop(video, resultCanvas, resultCtx);
  }
}

/**
 * Fallback: center crop assuming card is roughly centered
 */
function fallbackCrop(
  video: HTMLVideoElement,
  resultCanvas: HTMLCanvasElement,
  resultCtx: CanvasRenderingContext2D
): { canvas: HTMLCanvasElement; success: boolean; message: string } {
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
