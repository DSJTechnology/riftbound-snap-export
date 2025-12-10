import { useRef, useState, useCallback, useEffect } from 'react';
import { CardData } from '@/data/cardDatabase';
import { useCardHashes, CardWithHash } from '@/contexts/CardHashContext';
import { getImageHashFromCanvas, hammingDistanceHex } from '@/utils/imageHash';

// Configuration constants
const SCAN_INTERVAL_MS = 800;
const HASH_BITS = 8;
const MAX_DISTANCE_AUTO_CONFIRM = 8;
const DUPLICATE_COOLDOWN_MS = 3000;

export interface ImageMatchResult {
  card: CardWithHash;
  distance: number;
}

export interface PendingMatch {
  card: CardWithHash;
  distance: number;
}

export interface RecentScan {
  card: CardWithHash;
  timestamp: number;
}

export interface UseImageScannerOptions {
  onCardConfirmed: (card: CardData, cardId: string) => void;
  enabled?: boolean;
}

export interface UseImageScannerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isIndexReady: boolean;
  isStreaming: boolean;
  isVideoReady: boolean;
  isScanning: boolean;
  autoScanEnabled: boolean;
  lastDetectedId: string | null;
  lastHash: string | null;
  bestMatch: CardWithHash | null;
  bestDistance: number | null;
  matchCandidates: ImageMatchResult[];
  indexProgress: { loaded: number; total: number };
  error: string | null;
  pendingMatch: PendingMatch | null;
  recentScans: RecentScan[];
  openCamera: () => Promise<void>;
  closeCamera: () => void;
  toggleAutoScan: () => void;
  manualScan: () => void;
  handleVideoReady: () => void;
  handleVideoError: () => void;
  confirmPendingMatch: () => void;
  cancelPendingMatch: () => void;
}

// Re-export CardWithHash for components that need it
export type { CardWithHash } from '@/contexts/CardHashContext';

export function useImageScanner({
  onCardConfirmed,
  enabled = true,
}: UseImageScannerOptions): UseImageScannerReturn {
  // Use global card hash context instead of loading hashes locally
  const { cardIndex, isIndexReady, indexProgress, error: hashError } = useCardHashes();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const isScanningRef = useRef(false);
  const lastConfirmTriggerRef = useRef<{ cardId: string; timestamp: number } | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [lastDetectedId, setLastDetectedId] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);
  const [bestMatch, setBestMatch] = useState<CardWithHash | null>(null);
  const [bestDistance, setBestDistance] = useState<number | null>(null);
  const [matchCandidates, setMatchCandidates] = useState<ImageMatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingMatch, setPendingMatch] = useState<PendingMatch | null>(null);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);

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

  // Scan the current camera frame - returns the result directly
  const scanFrameInternal = useCallback((): { bestMatch: CardWithHash | null; bestDistance: number | null } | null => {
    if (!videoRef.current || !canvasRef.current || cardIndex.length === 0) return null;

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      if (!ctx || video.readyState < 2) {
        return null;
      }

      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;

      // Draw full frame
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(video, 0, 0, width, height);

      // Crop to middle region where card art should be
      const cropWidth = Math.floor(width * 0.75);
      const cropHeight = Math.floor(height * 0.55);
      const sx = Math.floor((width - cropWidth) / 2);
      const sy = Math.floor(height * 0.1);

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropWidth;
      cropCanvas.height = cropHeight;
      const cropCtx = cropCanvas.getContext('2d');

      if (!cropCtx) return null;

      cropCtx.drawImage(
        canvas,
        sx, sy, cropWidth, cropHeight,
        0, 0, cropWidth, cropHeight
      );

      // Compute hash of cropped camera image
      const frameHash = getImageHashFromCanvas(cropCanvas, HASH_BITS);
      setLastHash(frameHash);

      // Find best match
      let best: CardWithHash | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      const candidates: ImageMatchResult[] = [];

      for (const entry of cardIndex) {
        const dist = hammingDistanceHex(frameHash, entry.hash);
        candidates.push({ card: entry, distance: dist });

        if (dist < bestDist) {
          bestDist = dist;
          best = entry;
        }
      }

      // Sort candidates by distance
      candidates.sort((a, b) => a.distance - b.distance);

      setBestMatch(best);
      setBestDistance(bestDist);
      setMatchCandidates(candidates.slice(0, 5));

      console.log(`[ImageScanner] Hash: ${frameHash} | Best: ${best?.cardId} (dist: ${bestDist})`);

      return { bestMatch: best, bestDistance: bestDist };
    } catch (err) {
      console.error('[ImageScanner] Scan frame error:', err);
      return null;
    }
  }, [cardIndex]);

  // Auto-scan frame with auto-confirm logic
  const autoScanFrame = useCallback(() => {
    if (isScanningRef.current) return;

    isScanningRef.current = true;
    setIsScanning(true);

    try {
      const result = scanFrameInternal();

      if (result?.bestMatch && result.bestDistance !== null && result.bestDistance <= MAX_DISTANCE_AUTO_CONFIRM) {
        const now = Date.now();
        const lastTrigger = lastConfirmTriggerRef.current;

        // Check duplicate cooldown
        if (!lastTrigger || lastTrigger.cardId !== result.bestMatch.cardId || now - lastTrigger.timestamp >= DUPLICATE_COOLDOWN_MS) {
          console.log(`[ImageScanner] Auto-triggering confirmation for: ${result.bestMatch.name} (${result.bestMatch.cardId})`);
          lastConfirmTriggerRef.current = { cardId: result.bestMatch.cardId, timestamp: now };
          setPendingMatch({ card: result.bestMatch, distance: result.bestDistance });
        }
      }
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  }, [scanFrameInternal]);

  // Start/stop auto-scan loop
  useEffect(() => {
    if (isStreaming && isVideoReady && autoScanEnabled && enabled && isIndexReady) {
      console.log('[ImageScanner] Starting auto-scan loop');
      scanIntervalRef.current = window.setInterval(autoScanFrame, SCAN_INTERVAL_MS);
    } else {
      if (scanIntervalRef.current) {
        console.log('[ImageScanner] Stopping auto-scan loop');
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
  }, [isStreaming, isVideoReady, autoScanEnabled, enabled, isIndexReady, autoScanFrame]);

  const openCamera = useCallback(async () => {
    try {
      setError(null);
      console.log('[ImageScanner] Requesting camera access...');

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsStreaming(true);
        console.log('[ImageScanner] Camera stream started');
      }
    } catch (err) {
      console.error('[ImageScanner] Camera access error:', err);
      setError('Could not access camera. Please grant permission and try again.');
    }
  }, []);

  const closeCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsStreaming(false);
    setIsVideoReady(false);
    setBestMatch(null);
    setBestDistance(null);
    setMatchCandidates([]);
    setLastHash(null);
    console.log('[ImageScanner] Camera closed');
  }, []);

  const toggleAutoScan = useCallback(() => {
    setAutoScanEnabled(prev => !prev);
  }, []);

  // Manual scan - always scans and shows confirmation for best match
  const manualScan = useCallback(() => {
    if (!isStreaming || !isVideoReady || !isIndexReady) return;

    setIsScanning(true);
    try {
      const result = scanFrameInternal();

      // Always show confirmation modal for manual scan if we have a match
      if (result?.bestMatch && result.bestDistance !== null) {
        setPendingMatch({ card: result.bestMatch, distance: result.bestDistance });
      }
    } finally {
      setIsScanning(false);
    }
  }, [isStreaming, isVideoReady, isIndexReady, scanFrameInternal]);

  const confirmPendingMatch = useCallback(() => {
    if (!pendingMatch) return;

    const { card } = pendingMatch;

    // Add to recent scans
    setRecentScans(prev => {
      const next = [{ card, timestamp: Date.now() }, ...prev];
      return next.slice(0, 5);
    });

    setLastDetectedId(card.cardId);

    // Convert to CardData format and confirm
    const cardData: CardData = {
      cardId: card.cardId,
      name: card.name,
      setName: card.setName || 'Unknown',
      rarity: card.rarity,
    };

    onCardConfirmed(cardData, card.cardId);
    setPendingMatch(null);
  }, [pendingMatch, onCardConfirmed]);

  const cancelPendingMatch = useCallback(() => {
    setPendingMatch(null);
  }, []);

  const handleVideoReady = useCallback(() => {
    setIsVideoReady(true);
    console.log('[ImageScanner] Video ready');
  }, []);

  const handleVideoError = useCallback(() => {
    setError('Video stream error. Please try again.');
    closeCamera();
  }, [closeCamera]);

  return {
    videoRef,
    canvasRef,
    isIndexReady,
    isStreaming,
    isVideoReady,
    isScanning,
    autoScanEnabled,
    lastDetectedId,
    lastHash,
    bestMatch,
    bestDistance,
    matchCandidates,
    indexProgress,
    error: error || hashError,
    pendingMatch,
    recentScans,
    openCamera,
    closeCamera,
    toggleAutoScan,
    manualScan,
    handleVideoReady,
    handleVideoError,
    confirmPendingMatch,
    cancelPendingMatch,
  };
}
