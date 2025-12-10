import { useRef, useState, useCallback, useEffect } from 'react';
import { createWorker, Worker } from 'tesseract.js';
import { CardData } from '@/data/cardDatabase';
import { FuzzyMatchResult } from '@/contexts/CardDatabaseContext';

// Tesseract PSM values as strings
const PSM_SINGLE_LINE = '7';

// Detection buffer entry for multi-frame confirmation
interface DetectionEntry {
  cardId: string;
  confidence: number;
  timestamp: number;
}

// Configuration constants - easily adjustable
const SCAN_INTERVAL_MS = 1000; // How often to scan (ms)
const DETECTION_WINDOW_MS = 2500; // Time window for multi-frame confirmation
const MIN_DETECTIONS_REQUIRED = 2; // Minimum detections to confirm
const MIN_CONFIDENCE_THRESHOLD = 50; // Minimum average confidence %
const DUPLICATE_COOLDOWN_MS = 3000; // Time before same card can be added again
const CARD_ID_REGEX = /[A-Z]{2,4}-\d{3}/g;
const FUZZY_MATCH_THRESHOLD = 0.6; // Minimum score to auto-accept
const MULTI_ATTEMPT_COUNT = 3; // Number of OCR attempts per scan
const MULTI_ATTEMPT_DELAY_MS = 100; // Delay between attempts

export interface UseAutoScannerOptions {
  onCardConfirmed: (card: CardData, cardId: string) => void;
  onSuggestionsFound: (suggestions: FuzzyMatchResult[], rawText: string) => void;
  findCardById: (cardId: string) => CardData | undefined;
  fuzzyMatchCardId: (rawText: string) => FuzzyMatchResult[];
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
  lastOcrText: string | null;
  lastOcrConfidence: number | null;
  recognizedCard: CardData | null;
  matchScore: number | null;
  matchCandidates: FuzzyMatchResult[];
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
  onSuggestionsFound,
  findCardById,
  fuzzyMatchCardId,
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
  const [lastOcrText, setLastOcrText] = useState<string | null>(null);
  const [lastOcrConfidence, setLastOcrConfidence] = useState<number | null>(null);
  const [recognizedCard, setRecognizedCard] = useState<CardData | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [matchCandidates, setMatchCandidates] = useState<FuzzyMatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Initialize Tesseract worker with optimized settings
  useEffect(() => {
    let mounted = true;

    const initWorker = async () => {
      try {
        console.log('[OCR] Initializing Tesseract worker...');
        const tesseractWorker = await createWorker('eng', 1, {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              // Silent during recognition
            } else {
              console.log('[OCR] Worker:', m.status);
            }
          },
        });

        // Configure for single-line alphanumeric card IDs
        await tesseractWorker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
          tessedit_pageseg_mode: PSM_SINGLE_LINE as any, // PSM 7: single text line
        });

        if (mounted) {
          workerRef.current = tesseractWorker;
          setIsWorkerReady(true);
          console.log('[OCR] Tesseract worker ready');
        }
      } catch (err) {
        console.error('[OCR] Failed to initialize:', err);
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
    sourceCanvas: HTMLCanvasElement
  ): HTMLCanvasElement => {
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;

    // Crop bottom 20-25% where card ID is located
    const cropY = Math.floor(height * 0.78);
    const cropHeight = Math.floor(height * 0.22);

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

    // Apply preprocessing: grayscale + binary threshold
    const imageData = croppedCtx.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
    const data = imageData.data;
    const threshold = 140; // Fixed threshold for consistent results

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Convert to grayscale
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      // Apply binary threshold
      const v = gray > threshold ? 255 : 0;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }

    croppedCtx.putImageData(imageData, 0, 0);
    return croppedCanvas;
  }, []);

  // Try OCR on both normal and 180° rotated versions
  const runOCRWithRotation = useCallback(async (
    canvas: HTMLCanvasElement
  ): Promise<{ text: string; cardId: string | null; confidence: number }> => {
    if (!workerRef.current) return { text: '', cardId: null, confidence: 0 };

    const tryOCR = async (rotated: boolean): Promise<{ text: string; cardId: string | null; confidence: number }> => {
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
        const rawText = data.text.trim();
        const text = rawText.toUpperCase();
        const matches = text.match(CARD_ID_REGEX);

        console.log(`[OCR] ${rotated ? 'Rotated' : 'Normal'} - Raw: "${rawText}" | Confidence: ${data.confidence?.toFixed(1)}%`);

        if (matches && matches.length > 0) {
          return {
            text: rawText,
            cardId: matches[0],
            confidence: data.confidence || 0,
          };
        }

        return { text: rawText, cardId: null, confidence: data.confidence || 0 };
      } catch (err) {
        console.error('[OCR] Recognition error:', err);
        return { text: '', cardId: null, confidence: 0 };
      }
    };

    // Try normal orientation first
    const normalResult = await tryOCR(false);
    if (normalResult.cardId && normalResult.confidence > MIN_CONFIDENCE_THRESHOLD) {
      return normalResult;
    }

    // Try rotated if normal didn't work well
    const rotatedResult = await tryOCR(true);
    if (rotatedResult.cardId && rotatedResult.confidence > normalResult.confidence) {
      return rotatedResult;
    }

    // Return best result even if no card ID found
    return normalResult.confidence >= rotatedResult.confidence ? normalResult : rotatedResult;
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

          console.log(`[Scanner] Card confirmed: ${cardId} (avg confidence: ${avgConfidence.toFixed(1)}%)`);

          // Try exact match first
          const exactCard = findCardById(cardId);
          if (exactCard) {
            // Clear buffer for this card
            detectionBufferRef.current = detectionBufferRef.current.filter(e => e.cardId !== cardId);
            lastAddedCardRef.current = { cardId, timestamp: now };
            setLastDetectedId(cardId);
            setCurrentCandidate(null);
            onCardConfirmed(exactCard, cardId);
            return;
          }

          // Try fuzzy match
          const fuzzyResults = fuzzyMatchCardId(cardId);
          console.log(`[Scanner] Fuzzy results for "${cardId}":`, fuzzyResults.map(r => `${r.card.cardId} (${r.score.toFixed(2)})`));
          
          if (fuzzyResults.length > 0) {
            const bestMatch = fuzzyResults[0];
            
            if (bestMatch.score >= FUZZY_MATCH_THRESHOLD) {
              // Good enough match - auto-accept
              detectionBufferRef.current = detectionBufferRef.current.filter(e => e.cardId !== cardId);
              lastAddedCardRef.current = { cardId: bestMatch.card.cardId, timestamp: now };
              setLastDetectedId(bestMatch.card.cardId);
              setCurrentCandidate(null);
              onCardConfirmed(bestMatch.card, bestMatch.card.cardId);
              return;
            } else if (fuzzyResults.length > 0) {
              // Show suggestions to user
              console.log(`[Scanner] Low confidence match, showing suggestions`);
              onSuggestionsFound(fuzzyResults, cardId);
              detectionBufferRef.current = []; // Clear buffer to avoid repeat suggestions
              return;
            }
          }
          
          // No match found
          console.log(`[Scanner] No match found for "${cardId}" in database`);
        }
      }
    }

    // Update current candidate display
    if (cardCounts.size > 0) {
      const topCandidate = [...cardCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
      setCurrentCandidate(topCandidate[0]);
    }
  }, [findCardById, fuzzyMatchCardId, onCardConfirmed, onSuggestionsFound]);

  // Helper to capture a single frame
  const captureFrame = useCallback((): HTMLCanvasElement | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    
    const ctx = canvas.getContext('2d');
    if (!ctx || video.readyState < 2) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    
    // Return a copy of the canvas
    const frameCopy = document.createElement('canvas');
    frameCopy.width = canvas.width;
    frameCopy.height = canvas.height;
    const copyCtx = frameCopy.getContext('2d');
    copyCtx?.drawImage(canvas, 0, 0);
    return frameCopy;
  }, []);

  // Multi-attempt scan: take N frames, pick best confidence
  const scanFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !workerRef.current) return;
    if (isScanningRef.current) return; // Skip if already scanning

    isScanningRef.current = true;
    setIsScanning(true);

    try {
      const results: Array<{ text: string; cardId: string | null; confidence: number }> = [];

      // Take multiple OCR attempts
      for (let attempt = 0; attempt < MULTI_ATTEMPT_COUNT; attempt++) {
        const frame = captureFrame();
        if (!frame) continue;

        const preprocessed = preprocessImage(frame);
        const result = await runOCRWithRotation(preprocessed);
        results.push(result);

        console.log(`[OCR] Attempt ${attempt + 1}/${MULTI_ATTEMPT_COUNT}: "${result.text}" (${result.confidence.toFixed(1)}%)`);

        // Small delay between attempts
        if (attempt < MULTI_ATTEMPT_COUNT - 1) {
          await new Promise(resolve => setTimeout(resolve, MULTI_ATTEMPT_DELAY_MS));
        }
      }

      // Pick the result with highest confidence
      const bestResult = results.reduce(
        (best, current) => (current.confidence > best.confidence ? current : best),
        { text: '', cardId: null, confidence: 0 }
      );

      // Clean the text: uppercase, only alphanumeric + dash
      const cleanedText = bestResult.text
        .toUpperCase()
        .replace(/[^A-Z0-9\-]/g, '')
        .trim();

      // Update debug info
      setLastOcrText(cleanedText || bestResult.text);
      setLastOcrConfidence(bestResult.confidence);

      console.log(`[OCR] Best result: "${cleanedText}" (confidence: ${bestResult.confidence.toFixed(1)}%)`);

      // Extract card ID from cleaned text
      const cardIdMatch = cleanedText.match(/[A-Z]{2,4}-\d{3}/);
      const detectedCardId = cardIdMatch ? cardIdMatch[0] : bestResult.cardId;

      // Always try to match and show what card we think it is
      if (detectedCardId) {
        // Try exact match first
        const exactCard = findCardById(detectedCardId);
        if (exactCard) {
          setRecognizedCard(exactCard);
          setMatchScore(1.0);
          setMatchCandidates([]);
          console.log(`[Match] Exact match found: ${exactCard.name} (${exactCard.cardId})`);
        } else {
          // Try fuzzy match
          const fuzzyResults = fuzzyMatchCardId(detectedCardId);
          if (fuzzyResults.length > 0) {
            const best = fuzzyResults[0];
            setRecognizedCard(best.card);
            setMatchScore(best.score);
            setMatchCandidates(fuzzyResults.slice(0, 3));
            console.log(`[Match] Fuzzy match: ${best.card.name} (${best.card.cardId}) - score: ${(best.score * 100).toFixed(0)}%`);
          } else {
            setRecognizedCard(null);
            setMatchScore(null);
            setMatchCandidates([]);
          }
        }

        // Only add to buffer if confidence is good enough for auto-add
        if (bestResult.confidence >= MIN_CONFIDENCE_THRESHOLD) {
          detectionBufferRef.current.push({
            cardId: detectedCardId,
            confidence: bestResult.confidence,
            timestamp: Date.now(),
          });
          processDetectionBuffer();
        }
      } else if (cleanedText) {
        // No card ID pattern found - try matching by name
        const nameResults = fuzzyMatchCardId(cleanedText); // This will try name matching via fuzzyMatch
        if (nameResults.length > 0 && nameResults[0].score >= 0.5) {
          setRecognizedCard(nameResults[0].card);
          setMatchScore(nameResults[0].score);
          setMatchCandidates(nameResults.slice(0, 3));
        } else {
          setRecognizedCard(null);
          setMatchScore(null);
          setMatchCandidates([]);
        }
        console.log(`[OCR] Low confidence (${bestResult.confidence.toFixed(1)}%) or no card ID found in: "${cleanedText}"`);
      }
    } catch (err) {
      console.error('[Scanner] Scan frame error:', err);
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  }, [captureFrame, preprocessImage, runOCRWithRotation, processDetectionBuffer]);

  // Start/stop auto-scan loop
  useEffect(() => {
    if (enabled && autoScanEnabled && isVideoReady && isWorkerReady) {
      console.log('[Scanner] Starting auto-scan loop');
      scanIntervalRef.current = window.setInterval(scanFrame, SCAN_INTERVAL_MS);
    } else {
      if (scanIntervalRef.current) {
        console.log('[Scanner] Stopping auto-scan loop');
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
      setLastOcrText(null);
      setLastOcrConfidence(null);
      detectionBufferRef.current = [];

      console.log('[Camera] Requesting camera access...');
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
      console.log('[Camera] Stream acquired');

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
        console.log('[Camera] Video playing');
      }
    } catch (err) {
      console.error('[Camera] Access error:', err);
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
    console.log('[Camera] Closing camera');
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
    setLastOcrText(null);
    setLastOcrConfidence(null);
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
      console.log('[Camera] Video ready');
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
    lastOcrText,
    lastOcrConfidence,
    recognizedCard,
    matchScore,
    matchCandidates,
    error,
    openCamera,
    closeCamera,
    toggleAutoScan,
    manualScan,
    handleVideoReady,
    handleVideoError,
  };
}