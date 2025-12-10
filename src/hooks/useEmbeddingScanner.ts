import { useRef, useState, useCallback, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';
import { CardData } from '@/data/cardDatabase';
import { useCardEmbeddings, EmbeddedCard } from '@/contexts/CardEmbeddingContext';
import { useMobilenetModel } from '@/hooks/useMobilenetModel';
import { preprocessVideoFrame, cosineSimilarity, findTopMatches } from '@/utils/imagePreprocess';

// Configuration constants
const SCAN_INTERVAL_MS = 800;
const AUTO_CONFIRM_THRESHOLD = 0.75; // Cosine similarity threshold for auto-confirm
const DUPLICATE_COOLDOWN_MS = 3000;

export interface EmbeddingMatchResult {
  card: EmbeddedCard;
  score: number; // Cosine similarity (0-1, higher is better)
}

export interface PendingMatch {
  card: EmbeddedCard;
  score: number;
}

export interface RecentScan {
  card: EmbeddedCard;
  timestamp: number;
}

export interface UseEmbeddingScannerOptions {
  onCardConfirmed: (card: CardData, cardId: string) => void;
  enabled?: boolean;
}

export interface UseEmbeddingScannerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isIndexReady: boolean;
  isModelReady: boolean;
  isStreaming: boolean;
  isVideoReady: boolean;
  isScanning: boolean;
  autoScanEnabled: boolean;
  lastDetectedId: string | null;
  bestMatch: EmbeddedCard | null;
  bestScore: number | null;
  matchCandidates: EmbeddingMatchResult[];
  indexProgress: { loaded: number; total: number };
  modelLoading: boolean;
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

// Re-export EmbeddedCard for components that need it
export type { EmbeddedCard } from '@/contexts/CardEmbeddingContext';

export function useEmbeddingScanner({
  onCardConfirmed,
  enabled = true,
}: UseEmbeddingScannerOptions): UseEmbeddingScannerReturn {
  // Use global card embedding context
  const { cards: cardIndex, loaded: contextLoaded, loading: contextLoading, progress: indexProgress, error: embeddingError } = useCardEmbeddings();
  
  // Use MobileNet model hook
  const { isReady: modelReady, isLoading: modelLoading, error: modelError, getEmbedding } = useMobilenetModel();
  
  // Only consider index ready if we actually have cards with embeddings
  const isIndexReady = contextLoaded && cardIndex.length > 0;
  const isModelReady = modelReady;
  
  console.log('[useEmbeddingScanner] State:', { contextLoaded, cardIndexLength: cardIndex.length, isIndexReady, isModelReady });

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
  const [bestMatch, setBestMatch] = useState<EmbeddedCard | null>(null);
  const [bestScore, setBestScore] = useState<number | null>(null);
  const [matchCandidates, setMatchCandidates] = useState<EmbeddingMatchResult[]>([]);
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

  // Scan the current camera frame using MobileNet embeddings
  const scanFrameInternal = useCallback(async (): Promise<{ bestMatch: EmbeddedCard | null; bestScore: number | null } | null> => {
    if (!videoRef.current || cardIndex.length === 0 || !isModelReady) return null;

    try {
      const video = videoRef.current;

      if (video.readyState < 2) {
        return null;
      }

      // Preprocess video frame for MobileNet
      const tensor = await preprocessVideoFrame(video, canvasRef.current || undefined);
      
      // Get embedding from MobileNet
      const frameEmbedding = await getEmbedding(tensor);
      
      // Clean up tensor
      tensor.dispose();
      
      if (!frameEmbedding) {
        console.warn('[EmbeddingScanner] Failed to get embedding');
        return null;
      }

      // Find top matches using cosine similarity
      const topMatches = findTopMatches(frameEmbedding, cardIndex, 5);
      
      const best = topMatches[0]?.item || null;
      const bestSimilarity = topMatches[0]?.score || null;

      // Transform results for UI
      const candidates: EmbeddingMatchResult[] = topMatches.map(m => ({
        card: m.item,
        score: m.score,
      }));

      setBestMatch(best);
      setBestScore(bestSimilarity);
      setMatchCandidates(candidates);

      console.log(`[EmbeddingScanner] Best: ${best?.cardId} (score: ${bestSimilarity?.toFixed(3)})`);

      return { bestMatch: best, bestScore: bestSimilarity };
    } catch (err) {
      console.error('[EmbeddingScanner] Scan frame error:', err);
      return null;
    }
  }, [cardIndex, isModelReady, getEmbedding]);

  // Auto-scan frame with auto-confirm logic
  const autoScanFrame = useCallback(async () => {
    if (isScanningRef.current) return;

    isScanningRef.current = true;
    setIsScanning(true);

    try {
      const result = await scanFrameInternal();

      if (result?.bestMatch && result.bestScore !== null && result.bestScore >= AUTO_CONFIRM_THRESHOLD) {
        const now = Date.now();
        const lastTrigger = lastConfirmTriggerRef.current;

        // Check duplicate cooldown
        if (!lastTrigger || lastTrigger.cardId !== result.bestMatch.cardId || now - lastTrigger.timestamp >= DUPLICATE_COOLDOWN_MS) {
          console.log(`[EmbeddingScanner] Auto-triggering confirmation for: ${result.bestMatch.name} (${result.bestMatch.cardId})`);
          lastConfirmTriggerRef.current = { cardId: result.bestMatch.cardId, timestamp: now };
          setPendingMatch({ card: result.bestMatch, score: result.bestScore });
        }
      }
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  }, [scanFrameInternal]);

  // Start/stop auto-scan loop
  useEffect(() => {
    if (isStreaming && isVideoReady && autoScanEnabled && enabled && isIndexReady && isModelReady) {
      console.log('[EmbeddingScanner] Starting auto-scan loop');
      scanIntervalRef.current = window.setInterval(autoScanFrame, SCAN_INTERVAL_MS);
    } else {
      if (scanIntervalRef.current) {
        console.log('[EmbeddingScanner] Stopping auto-scan loop');
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
  }, [isStreaming, isVideoReady, autoScanEnabled, enabled, isIndexReady, isModelReady, autoScanFrame]);

  const openCamera = useCallback(async () => {
    try {
      setError(null);
      console.log('[EmbeddingScanner] Requesting camera access...');

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
        console.log('[EmbeddingScanner] Camera stream started');
      }
    } catch (err) {
      console.error('[EmbeddingScanner] Camera access error:', err);
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
    setBestScore(null);
    setMatchCandidates([]);
    console.log('[EmbeddingScanner] Camera closed');
  }, []);

  const toggleAutoScan = useCallback(() => {
    setAutoScanEnabled(prev => !prev);
  }, []);

  // Manual scan - always scans and shows confirmation for best match
  const manualScan = useCallback(async () => {
    console.log('[EmbeddingScanner] Manual scan triggered', { isStreaming, isVideoReady, isIndexReady, isModelReady });
    
    if (!isStreaming || !isVideoReady || !isIndexReady || !isModelReady) {
      console.log('[EmbeddingScanner] Manual scan aborted - conditions not met');
      return;
    }

    setIsScanning(true);
    try {
      const result = await scanFrameInternal();
      console.log('[EmbeddingScanner] Manual scan result:', result);

      // Always show confirmation modal for manual scan if we have a match
      if (result?.bestMatch && result.bestScore !== null) {
        setPendingMatch({ card: result.bestMatch, score: result.bestScore });
      }
    } finally {
      setIsScanning(false);
    }
  }, [isStreaming, isVideoReady, isIndexReady, isModelReady, scanFrameInternal]);

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
    console.log('[EmbeddingScanner] Video ready');
  }, []);

  const handleVideoError = useCallback(() => {
    setError('Video stream error. Please try again.');
    closeCamera();
  }, [closeCamera]);

  return {
    videoRef,
    canvasRef,
    isIndexReady,
    isModelReady,
    isStreaming,
    isVideoReady,
    isScanning,
    autoScanEnabled,
    lastDetectedId,
    bestMatch,
    bestScore,
    matchCandidates,
    indexProgress,
    modelLoading,
    error: error || embeddingError || modelError,
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
