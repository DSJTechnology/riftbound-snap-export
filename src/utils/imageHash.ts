/**
 * Perceptual hashing utilities for image-based card recognition
 */

/**
 * Computes a simple perceptual hash (aHash) from a canvas
 * by downscaling to NxN, converting to grayscale, and comparing to mean
 */
export function getImageHashFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  bits = 8
): string {
  const size = bits;
  const tmp = document.createElement('canvas');
  tmp.width = size;
  tmp.height = size;

  const ctx = tmp.getContext('2d');
  if (!ctx) return '';

  // Draw scaled down version
  ctx.drawImage(sourceCanvas, 0, 0, size, size);

  const { data } = ctx.getImageData(0, 0, size, size);
  const grays: number[] = [];

  // Convert to grayscale values
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    grays.push(gray);
  }

  // Calculate mean
  const avg = grays.reduce((sum, v) => sum + v, 0) / Math.max(grays.length, 1);

  // Build binary string (1 if above avg, 0 if below)
  let bitsStr = '';
  for (const g of grays) {
    bitsStr += g > avg ? '1' : '0';
  }

  // Convert to hex
  let hex = '';
  for (let i = 0; i < bitsStr.length; i += 4) {
    const nibble = bitsStr.slice(i, i + 4);
    hex += parseInt(nibble, 2).toString(16);
  }

  return hex;
}

/**
 * Computes Hamming distance between two hex hash strings
 */
export function hammingDistanceHex(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let dist = 0;

  for (let i = 0; i < len; i++) {
    const n1 = parseInt(a[i], 16);
    const n2 = parseInt(b[i], 16);
    let x = n1 ^ n2;
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }

  // Add penalty for length mismatch
  const extraA = a.length - len;
  const extraB = b.length - len;
  if (extraA > 0) dist += extraA * 4;
  if (extraB > 0) dist += extraB * 4;

  return dist;
}

/**
 * Loads an image from URL and returns a canvas with the image drawn
 */
export async function loadImageToCanvas(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    
    img.onerror = () => {
      reject(new Error(`Failed to load image: ${url}`));
    };
    
    img.src = url;
  });
}

/**
 * Computes hash directly from an image URL
 */
export async function getImageHashFromUrl(url: string, bits = 8): Promise<string> {
  const canvas = await loadImageToCanvas(url);
  return getImageHashFromCanvas(canvas, bits);
}
