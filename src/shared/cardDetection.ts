/**
 * Card detection and perspective warp utilities.
 * Detects card rectangles in images and warps them to a canonical view.
 * 
 * This module works in the browser using OpenCV.js for edge detection
 * and perspective transformation.
 */

// OpenCV.js will be loaded dynamically
declare const cv: any;

// Card aspect ratio (width / height)
export const CARD_ASPECT_RATIO = 500 / 700; // ~0.714

export interface Point {
  x: number;
  y: number;
}

export interface CardQuad {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export interface WarpConfig {
  outputWidth: number;  // e.g. 224
  outputHeight: number; // e.g. 224
  insetFraction?: number; // e.g. 0.05 = inset 5% to avoid sleeve borders
}

export interface WarpedCardImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray; // RGBA, length = width * height * 4
  canvas: HTMLCanvasElement;
}

export interface DetectionResult {
  quad: CardQuad | null;
  confidence: number; // 0-1
  message: string;
}

// Module state
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
      const checkReady = () => {
        if (typeof cv !== 'undefined' && cv.Mat) {
          opencvLoaded = true;
          console.log('[CardDetection] OpenCV.js loaded');
          resolve();
        } else {
          setTimeout(checkReady, 50);
        }
      };
      checkReady();
    };
    
    script.onerror = () => {
      console.error('[CardDetection] Failed to load OpenCV.js');
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
 * Order 4 corner points consistently: top-left, top-right, bottom-right, bottom-left
 */
function orderPoints(pts: Point[]): Point[] {
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
 * Detect card quadrilateral in an image using OpenCV edge detection.
 * Returns the detected quad or null if no suitable card found.
 */
export function detectCardQuad(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): DetectionResult {
  if (!isOpenCVReady()) {
    return { quad: null, confidence: 0, message: 'OpenCV not ready' };
  }

  try {
    // Create a temporary canvas to use with OpenCV
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d')!;
    
    // Put pixel data onto canvas - ensure we have a proper Uint8ClampedArray
    const clampedPixels = pixels instanceof Uint8ClampedArray 
      ? new Uint8ClampedArray(pixels) 
      : new Uint8ClampedArray(pixels);
    const imageData = new ImageData(
      clampedPixels,
      width,
      height
    );
    tempCtx.putImageData(imageData, 0, 0);

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

    // Find the best quadrilateral contour
    let bestContour: any = null;
    let maxArea = 0;
    const minArea = (width * height) * 0.15; // Card should be at least 15% of frame
    const maxAreaLimit = (width * height) * 0.95; // But not the whole frame

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      
      if (area > minArea && area < maxAreaLimit && area > maxArea) {
        // Approximate to polygon
        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * peri, true);
        
        // Check if it's a quadrilateral
        if (approx.rows === 4) {
          // Check aspect ratio is reasonable for a card
          const pts: Point[] = [];
          for (let j = 0; j < 4; j++) {
            pts.push({
              x: approx.data32S[j * 2],
              y: approx.data32S[j * 2 + 1],
            });
          }
          
          const ordered = orderPoints(pts);
          const quadWidth = Math.max(
            Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y),
            Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y)
          );
          const quadHeight = Math.max(
            Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y),
            Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y)
          );
          
          const aspectRatio = quadWidth / quadHeight;
          
          // Accept if aspect ratio is close to card ratio (within 30%)
          if (aspectRatio >= CARD_ASPECT_RATIO * 0.7 && aspectRatio <= CARD_ASPECT_RATIO * 1.3) {
            maxArea = area;
            if (bestContour) bestContour.delete();
            bestContour = approx;
          } else {
            approx.delete();
          }
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
      return { quad: null, confidence: 0, message: 'No card contour found' };
    }

    // Extract corner points
    const corners: Point[] = [];
    for (let i = 0; i < 4; i++) {
      corners.push({
        x: bestContour.data32S[i * 2],
        y: bestContour.data32S[i * 2 + 1],
      });
    }
    bestContour.delete();

    // Order points consistently
    const ordered = orderPoints(corners);
    
    // Calculate confidence based on area coverage
    const confidence = Math.min(1, maxArea / (width * height * 0.5));

    return {
      quad: {
        topLeft: ordered[0],
        topRight: ordered[1],
        bottomRight: ordered[2],
        bottomLeft: ordered[3],
      },
      confidence,
      message: 'Card detected',
    };

  } catch (err) {
    console.error('[CardDetection] Error during detection:', err);
    return { quad: null, confidence: 0, message: `Detection error: ${err}` };
  }
}

/**
 * Detect card from a canvas element
 */
export function detectCardQuadFromCanvas(canvas: HTMLCanvasElement): DetectionResult {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { quad: null, confidence: 0, message: 'Could not get canvas context' };
  }
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return detectCardQuad(imageData.data, canvas.width, canvas.height);
}

/**
 * Inset a card quad by a fraction to avoid sleeve borders.
 * Moves each edge inward by the specified fraction of the card dimensions.
 */
export function insetCardQuad(quad: CardQuad, insetFraction: number = 0.05): CardQuad {
  // Calculate center point
  const centerX = (quad.topLeft.x + quad.topRight.x + quad.bottomRight.x + quad.bottomLeft.x) / 4;
  const centerY = (quad.topLeft.y + quad.topRight.y + quad.bottomRight.y + quad.bottomLeft.y) / 4;
  
  // Scale each corner toward center
  const scale = 1 - insetFraction * 2;
  
  const insetPoint = (pt: Point): Point => ({
    x: centerX + (pt.x - centerX) * scale,
    y: centerY + (pt.y - centerY) * scale,
  });
  
  return {
    topLeft: insetPoint(quad.topLeft),
    topRight: insetPoint(quad.topRight),
    bottomRight: insetPoint(quad.bottomRight),
    bottomLeft: insetPoint(quad.bottomLeft),
  };
}

/**
 * Warp a quadrilateral region to a rectangle using perspective transform.
 * Uses OpenCV for perspective transformation.
 */
export function warpQuadToRect(
  sourceCanvas: HTMLCanvasElement,
  quad: CardQuad,
  config: WarpConfig
): WarpedCardImage {
  const { outputWidth, outputHeight, insetFraction = 0 } = config;
  
  // Apply inset if specified
  const finalQuad = insetFraction > 0 ? insetCardQuad(quad, insetFraction) : quad;
  
  // Create result canvas
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = outputWidth;
  resultCanvas.height = outputHeight;
  const resultCtx = resultCanvas.getContext('2d')!;
  
  if (!isOpenCVReady()) {
    // Fallback: simple crop and scale without perspective correction
    console.warn('[CardDetection] OpenCV not ready for warp, using simple crop');
    
    // Get bounding box of quad
    const minX = Math.min(finalQuad.topLeft.x, finalQuad.bottomLeft.x);
    const maxX = Math.max(finalQuad.topRight.x, finalQuad.bottomRight.x);
    const minY = Math.min(finalQuad.topLeft.y, finalQuad.topRight.y);
    const maxY = Math.max(finalQuad.bottomLeft.y, finalQuad.bottomRight.y);
    
    resultCtx.drawImage(
      sourceCanvas,
      minX, minY, maxX - minX, maxY - minY,
      0, 0, outputWidth, outputHeight
    );
    
    const imageData = resultCtx.getImageData(0, 0, outputWidth, outputHeight);
    return {
      width: outputWidth,
      height: outputHeight,
      pixels: imageData.data,
      canvas: resultCanvas,
    };
  }
  
  try {
    // Create source points
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      finalQuad.topLeft.x, finalQuad.topLeft.y,
      finalQuad.topRight.x, finalQuad.topRight.y,
      finalQuad.bottomRight.x, finalQuad.bottomRight.y,
      finalQuad.bottomLeft.x, finalQuad.bottomLeft.y,
    ]);
    
    // Create destination points (rectangle)
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      outputWidth, 0,
      outputWidth, outputHeight,
      0, outputHeight,
    ]);
    
    // Get perspective transform matrix
    const M = cv.getPerspectiveTransform(srcPts, dstPts);
    
    // Read source canvas into OpenCV
    const src = cv.imread(sourceCanvas);
    const warped = new cv.Mat();
    
    // Apply warp
    cv.warpPerspective(src, warped, M, new cv.Size(outputWidth, outputHeight));
    
    // Write to result canvas
    cv.imshow(resultCanvas, warped);
    
    // Clean up
    srcPts.delete();
    dstPts.delete();
    M.delete();
    src.delete();
    warped.delete();
    
    const imageData = resultCtx.getImageData(0, 0, outputWidth, outputHeight);
    return {
      width: outputWidth,
      height: outputHeight,
      pixels: imageData.data,
      canvas: resultCanvas,
    };
    
  } catch (err) {
    console.error('[CardDetection] Warp error:', err);
    
    // Fallback on error
    resultCtx.drawImage(sourceCanvas, 0, 0, outputWidth, outputHeight);
    const imageData = resultCtx.getImageData(0, 0, outputWidth, outputHeight);
    return {
      width: outputWidth,
      height: outputHeight,
      pixels: imageData.data,
      canvas: resultCanvas,
    };
  }
}

/**
 * Full detection and warp pipeline.
 * Takes a source canvas, detects the card, and returns a warped canonical view.
 */
export function detectAndWarpCard(
  sourceCanvas: HTMLCanvasElement,
  config: WarpConfig
): { warped: WarpedCardImage; detection: DetectionResult } {
  const detection = detectCardQuadFromCanvas(sourceCanvas);
  
  if (detection.quad) {
    const warped = warpQuadToRect(sourceCanvas, detection.quad, config);
    return { warped, detection };
  }
  
  // Fallback: centered card crop
  const { outputWidth, outputHeight } = config;
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = outputWidth;
  resultCanvas.height = outputHeight;
  const resultCtx = resultCanvas.getContext('2d')!;
  
  const srcWidth = sourceCanvas.width;
  const srcHeight = sourceCanvas.height;
  const srcAspect = srcWidth / srcHeight;
  
  let sx: number, sy: number, sw: number, sh: number;
  
  if (srcAspect > CARD_ASPECT_RATIO) {
    // Source is wider than card - crop left/right
    sh = srcHeight * 0.8;
    sw = sh * CARD_ASPECT_RATIO;
    sx = (srcWidth - sw) / 2;
    sy = (srcHeight - sh) / 2;
  } else {
    // Source is taller than card - crop top/bottom
    sw = srcWidth * 0.8;
    sh = sw / CARD_ASPECT_RATIO;
    sx = (srcWidth - sw) / 2;
    sy = (srcHeight - sh) / 2;
  }
  
  resultCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
  
  const imageData = resultCtx.getImageData(0, 0, outputWidth, outputHeight);
  return {
    warped: {
      width: outputWidth,
      height: outputHeight,
      pixels: imageData.data,
      canvas: resultCanvas,
    },
    detection: {
      ...detection,
      message: detection.message + ' (using fallback crop)',
    },
  };
}

/**
 * Compute the area coverage of a quad relative to the region dimensions.
 * Uses the shoelace formula for polygon area.
 * Returns a value between 0 and 1.
 */
export function computeQuadCoverage(
  quad: CardQuad,
  regionWidth: number,
  regionHeight: number
): number {
  const pts = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let area = 0;
  
  // Shoelace formula
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  area = Math.abs(area) / 2;
  
  const regionArea = regionWidth * regionHeight || 1;
  return Math.min(1, area / regionArea);
}

/**
 * Draw detected quad overlay on a canvas for visualization.
 */
export function drawQuadOverlay(
  ctx: CanvasRenderingContext2D,
  quad: CardQuad,
  color: string = '#00ff00',
  lineWidth: number = 2
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  
  ctx.beginPath();
  ctx.moveTo(quad.topLeft.x, quad.topLeft.y);
  ctx.lineTo(quad.topRight.x, quad.topRight.y);
  ctx.lineTo(quad.bottomRight.x, quad.bottomRight.y);
  ctx.lineTo(quad.bottomLeft.x, quad.bottomLeft.y);
  ctx.closePath();
  ctx.stroke();
  
  // Draw corner circles
  ctx.fillStyle = color;
  const corners = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  for (const corner of corners) {
    ctx.beginPath();
    ctx.arc(corner.x, corner.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.restore();
}
