import { useRef, useState, useCallback, useEffect } from 'react';
import { createWorker, Worker } from 'tesseract.js';
import { CardData } from '@/data/cardDatabase';

// Tesseract PSM values as strings
const PSM_SINGLE_LINE = '7';

// Detection buffer entry for multi-frame confirmation
interface DetectionEntry {
  cardId: string;
  confidence: number;
  timestamp: number;
}

// Configuration constants - easily adjustable
const SCAN_INTERVAL_MS = 600; // How often to scan (ms)
const DETECTION_WINDOW_MS = 2000; // Time window for multi-frame confirmation
const MIN_DETECTIONS_REQUIRED = 2; // Minimum detections to confirm
const MIN_CONFIDENCE_THRESHOLD = 55; // Minimum average confidence %
const DUPLICATE_COOLDOWN_MS = 3000; // Time before same card can be added again
const CARD_ID_REGEX = /[A-Z]{2,4}-\d{3}/g;

export interface UseAutoScannerOptions {
  onCardConfirmed: (card: CardData, cardId: string) => void;
  findCardById: (cardId: string) => CardData | undefined;
  enabled?: boolean;
}

export interface UseAutoScannerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isWorkerReady: boolean;
  isStreaming: boolean;
  isVideoReady: boolean;
  isScanning: boolean;
  autoScanEnabled: boolean;
  lastDetectedId: string | null;
  currentCandidate: string | null;
  error: string | null;
  openCamera: () => Promise<void>;
  closeCamera: () => void;
  toggleAutoScan: () => void;
  manualScan: () => Promise<void>;
  handleVideoReady: () => void;
  handleVideoError: () => void;
}

export function useAutoScanner({
  onCardConfirmed,
  findCardById,
  enabled = true,
}: UseAutoScannerOptions): UseAutoScannerReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const isScanningRef = useRef(false);
  const detectionBufferRef = useRef<DetectionEntry[]>([]);
  const lastAddedCardRef = useRef<{ cardId: string; timestamp: number } | null>(null);

  const [isWorkerReady, setIsWorkerReady] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [lastDetectedId, setLastDetectedId] = useState<string | null>(null);
  const [currentCandidate, setCurrentCandidate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize Tesseract worker with optimized settings
  useEffect(() => {
    let mounted = true;

    const initWorker = async () => {
      try {
        const tesseractWorker = await createWorker('eng', 1, {
          logger: () => {}, // Suppress logs
        });

        // Configure for single-line alphanumeric card IDs
        await tesseractWorker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
          tessedit_pageseg_mode: PSM_SINGLE_LINE as any, // PSM 7: single text line
        });

        if (mounted) {
          workerRef.current = tesseractWorker;
          setIsWorkerReady(true);
        }
      } catch (err) {
        console.error('Failed to initialize OCR:', err);
        if (mounted) {
          setError('OCR initialization failed. Please refresh the page.');
        }
      }
    };

    initWorker();

    return () => {
      mounted = false;
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Preprocess image for better OCR accuracy
  const preprocessImage = useCallback((
    sourceCanvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D
  ): HTMLCanvasElement => {
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;

    // Crop bottom 25% where card ID is located
    const cropY = Math.floor(height * 0.75);
    const cropHeight = Math.floor(height * 0.25);

    // Create cropped canvas at 2x scale for better OCR
    const scaleFactor = 2;
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = width * scaleFactor;
    croppedCanvas.height = cropHeight * scaleFactor;
    const croppedCtx = croppedCanvas.getContext('2d');

    if (!croppedCtx) return sourceCanvas;

    // Draw scaled crop
    croppedCtx.drawImage(
      sourceCanvas,
      0, cropY, width, cropHeight,
      0, 0, croppedCanvas.width, croppedCanvas.height
    );

    // Get image data for processing
    const imageData = croppedCtx.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
    const data = imageData.data;

    // Step 1: Convert to grayscale
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }

    // Step 2: Calculate histogram for adaptive threshold
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      histogram[Math.floor(data[i])]++;
    }

    // Otsu's method for optimal threshold
    const total = data.length / 4;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];

    let sumB = 0;
    let wB = 0;
    let maxVariance = 0;
    let threshold = 128;

    for (let i = 0; i < 256; i++) {
      wB += histogram[i];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;

      sumB += i * histogram[i];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) * (mB - mF);

      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = i;
      }
    }

    // Step 3: Apply binary threshold
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i] > threshold ? 255 : 0;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }

    croppedCtx.putImageData(imageData, 0, 0);
    return croppedCanvas;
  }, []);

  // Try OCR on both normal and 180° rotated versions
  const runOCRWithRotation = useCallback(async (
    canvas: HTMLCanvasElement
  ): Promise<{ cardId: string | null; confidence: number }> => {
    if (!workerRef.current) return { cardId: null, confidence: 0 };

    const tryOCR = async (rotated: boolean): Promise<{ cardId: string | null; confidence: number }> => {
      let targetCanvas = canvas;

      if (rotated) {
        // Create 180° rotated version
        const rotatedCanvas = document.createElement('canvas');
        rotatedCanvas.width = canvas.width;
        rotatedCanvas.height = canvas.height;
        const rotatedCtx = rotatedCanvas.getContext('2d');
        if (rotatedCtx) {
          rotatedCtx.translate(canvas.width, canvas.height);
          rotatedCtx.rotate(Math.PI);
          rotatedCtx.drawImage(canvas, 0, 0);
          targetCanvas = rotatedCanvas;
        }
      }

      try {
        const { data } = await workerRef.current!.recognize(targetCanvas);
        const text = data.text.toUpperCase();
        const matches = text.match(CARD_ID_REGEX);

        if (matches && matches.length > 0) {
          // Return the first valid match with confidence
          return {
            cardId: matches[0],
            confidence: data.confidence || 0,
          };
        }
      } catch (err) {
        console.error('OCR error:', err);
      }

      return { cardId: null, confidence: 0 };
    };

    // Try normal orientation first
    const normalResult = await tryOCR(false);
    if (normalResult.cardId && normalResult.confidence > MIN_CONFIDENCE_THRESHOLD) {
      return normalResult;
    }

    // Try rotated if normal didn't work well
    const rotatedResult = await tryOCR(true);
    if (rotatedResult.confidence > normalResult.confidence) {
      return rotatedResult;
    }

    return normalResult;
  }, []);

  // Process detection buffer for multi-frame confirmation
  const processDetectionBuffer = useCallback(() => {
    const now = Date.now();
    const buffer = detectionBufferRef.current;

    // Prune old entries
    detectionBufferRef.current = buffer.filter(
      entry => now - entry.timestamp < DETECTION_WINDOW_MS
    );

    // Count detections per cardId
    const cardCounts = new Map<string, { count: number; totalConfidence: number }>();
    for (const entry of detectionBufferRef.current) {
      const existing = cardCounts.get(entry.cardId) || { count: 0, totalConfidence: 0 };
      cardCounts.set(entry.cardId, {
        count: existing.count + 1,
        totalConfidence: existing.totalConfidence + entry.confidence,
      });
    }

    // Find card that meets threshold
    for (const [cardId, stats] of cardCounts) {
      if (stats.count >= MIN_DETECTIONS_REQUIRED) {
        const avgConfidence = stats.totalConfidence / stats.count;
        if (avgConfidence >= MIN_CONFIDENCE_THRESHOLD) {
          // Check duplicate cooldown
          const lastAdded = lastAddedCardRef.current;
          if (lastAdded && lastAdded.cardId === cardId && now - lastAdded.timestamp < DUPLICATE_COOLDOWN_MS) {
            continue; // Skip - recently added
          }

          // Confirmed! Look up the card
          const card = findCardById(cardId);
          if (card) {
            // Clear buffer for this card
            detectionBufferRef.current = detectionBufferRef.current.filter(e => e.cardId !== cardId);
            lastAddedCardRef.current = { cardId, timestamp: now };
            setLastDetectedId(cardId);
            setCurrentCandidate(null);
            onCardConfirmed(card, cardId);
            return;
          }
        }
      }
    }

    // Update current candidate display
    if (cardCounts.size > 0) {
      const topCandidate = [...cardCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
      setCurrentCandidate(topCandidate[0]);
    }
  }, [findCardById, onCardConfirmed]);

  // Single scan frame
  const scanFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !workerRef.current) return;
    if (isScanningRef.current) return; // Skip if already scanning

    isScanningRef.current = true;
    setIsScanning(true);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      if (!ctx || video.readyState < 2) {
        isScanningRef.current = false;
        setIsScanning(false);
        return;
      }

      // Set canvas to video dimensions
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Draw current frame
      ctx.drawImage(video, 0, 0);

      // Preprocess and run OCR
      const preprocessed = preprocessImage(canvas, ctx);
      const result = await runOCRWithRotation(preprocessed);

      if (result.cardId) {
        // Add to detection buffer
        detectionBufferRef.current.push({
          cardId: result.cardId,
          confidence: result.confidence,
          timestamp: Date.now(),
        });

        // Process buffer for confirmation
        processDetectionBuffer();
      }
    } catch (err) {
      console.error('Scan frame error:', err);
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  }, [preprocessImage, runOCRWithRotation, processDetectionBuffer]);

  // Start/stop auto-scan loop
  useEffect(() => {
    if (enabled && autoScanEnabled && isVideoReady && isWorkerReady) {
      scanIntervalRef.current = window.setInterval(scanFrame, SCAN_INTERVAL_MS);
    } else {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    }

    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    };
  }, [enabled, autoScanEnabled, isVideoReady, isWorkerReady, scanFrame]);

  const openCamera = useCallback(async () => {
    try {
      setError(null);
      setIsVideoReady(false);
      setLastDetectedId(null);
      setCurrentCandidate(null);
      detectionBufferRef.current = [];

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 720 },
          height: { ideal: 1280 },
        },
        audio: false,
      });

      streamRef.current = mediaStream;
      setIsStreaming(true);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error('Camera access error:', err);
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setError('Camera access denied. Please allow camera access in your browser settings.');
        } else if (err.name === 'NotFoundError') {
          setError('No camera found on this device.');
        } else {
          setError(`Camera error: ${err.message}`);
        }
      } else {
        setError('Failed to open camera.');
      }
    }
  }, []);

  const closeCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setIsVideoReady(false);
    setLastDetectedId(null);
    setCurrentCandidate(null);
    setError(null);
    detectionBufferRef.current = [];
  }, []);

  const toggleAutoScan = useCallback(() => {
    setAutoScanEnabled(prev => !prev);
  }, []);

  const manualScan = useCallback(async () => {
    await scanFrame();
  }, [scanFrame]);

  const handleVideoReady = useCallback(() => {
    if (videoRef.current && videoRef.current.readyState >= 2) {
      setIsVideoReady(true);
    }
  }, []);

  const handleVideoError = useCallback(() => {
    setError('Video playback error. Please try again.');
    setIsVideoReady(false);
  }, []);

  return {
    videoRef,
    canvasRef,
    isWorkerReady,
    isStreaming,
    isVideoReady,
    isScanning,
    autoScanEnabled,
    lastDetectedId,
    currentCandidate,
    error,
    openCamera,
    closeCamera,
    toggleAutoScan,
    manualScan,
    handleVideoReady,
    handleVideoError,
  };
}
