import { useRef, useState, useCallback, useEffect } from 'react';
import { CardData } from '@/data/cardDatabase';
import { useCardEmbeddings, EmbeddedCard } from '@/contexts/CardEmbeddingContext';
import { 
  loadOpenCV, 
  isOpenCVReady, 
  normalizeCardFromVideoFrame,
  CardQuad,
} from '@/utils/cardNormalization';
import { computeQuadCoverage } from '@/shared/cardDetection';
import { 
  loadEmbeddingModel,
  computeEmbeddingFromCanvas,
  cosineSimilarity,
  l2Normalize,
} from '@/embedding/cnnEmbedding';
import { 
  multiSignalMatch, 
  quickVisualMatch,
  MultiSignalMatch,
  MultiSignalResult 
} from '@/utils/multiSignalMatcher';
import { storeScanFeedback } from '@/utils/feedbackCapture';
import { 
  SIMILARITY_THRESHOLDS,
  getConfidenceLevel,
} from '@/utils/embeddingConfig';

// Configuration constants
const SCAN_INTERVAL_MS = 500; // Faster scanning for stability detection
const DUPLICATE_COOLDOWN_MS = 3000;

// Coverage gating - require card to fill most of the frame
const MIN_CARD_COVERAGE = 0.60; // Card must cover 60% of scan region

// Stable guess thresholds
const STABLE_WINDOW_MS = 1000;    // Look at ~1s worth of frames
const MIN_STABLE_MATCHES = 4;     // At least 4 frames agreeing
const MIN_SIMILARITY = 0.82;      // Threshold for "good enough" to lock
const MIN_MARGIN = 0.04;          // Winning card should beat #2 by this margin

// Scanner state machine types
type ScannerMode = 'SEARCHING' | 'PROPOSAL' | 'COOLDOWN';

interface ScanProposal {
  cardId: string;
  cardName: string;
  similarity: number;
  card: EmbeddedCard;
  candidates: EmbeddingMatchResult[];
}

interface FramePrediction {
  cardId: string;
  similarity: number;
  margin: number;
  timestamp: number;
}

interface ScannerState {
  mode: ScannerMode;
  proposal?: ScanProposal;
  cooldownUntil?: number;
}

// Scan status for UX messaging
export type ScanStatus = 
  | { state: 'READY' }
  | { state: 'NEEDS_MORE_CARD'; message: string }
  | { state: 'SEARCHING'; message: string }
  | { state: 'STABILIZING'; message: string; progress: number }
  | { state: 'PROPOSAL'; proposal: ScanProposal }
  | { state: 'COOLDOWN' };

export interface EmbeddingMatchResult {
  card: EmbeddedCard;
  score: number;
  visualScore?: number;
  ocrScore?: number;
  confidence?: 'excellent' | 'good' | 'fair' | 'low';
}

export interface PendingMatch {
  card: EmbeddedCard;
  score: number;
  candidates: EmbeddingMatchResult[];
  ocrText?: string;
  ocrConfidence?: number;
  visualEmbedding?: number[];
  needsConfirmation: boolean;
  ambiguous: boolean;
}

export interface RecentScan {
  card: EmbeddedCard;
  timestamp: number;
}

export interface UseEmbeddingScannerOptions {
  onCardConfirmed: (card: CardData, cardId: string) => void;
  enabled?: boolean;
  enableOCR?: boolean; // Enable multi-signal matching with OCR
}

export interface UseEmbeddingScannerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isIndexReady: boolean;
  isStreaming: boolean;
  isVideoReady: boolean;
  isScanning: boolean;
  autoScanEnabled: boolean;
  lastDetectedId: string | null;
  bestMatch: EmbeddedCard | null;
  bestScore: number | null;
  matchCandidates: EmbeddingMatchResult[];
  indexProgress: { loaded: number; total: number };
  error: string | null;
  pendingMatch: PendingMatch | null;
  recentScans: RecentScan[];
  qualityIssues: string[];
  opencvReady: boolean;
  detectedQuad: CardQuad | null;
  cardDetected: boolean;
  scanStatus: ScanStatus;
  cardCoverage: number;
  openCamera: () => Promise<void>;
  closeCamera: () => void;
  toggleAutoScan: () => void;
  manualScan: () => void;
  handleVideoReady: () => void;
  handleVideoError: () => void;
  confirmPendingMatch: (selectedCard?: EmbeddedCard) => void;
  selectCandidate: (card: EmbeddedCard, score: number) => void;
  cancelPendingMatch: () => void;
  rescan: () => void;
}

export type { EmbeddedCard } from '@/contexts/CardEmbeddingContext';

export function useEmbeddingScanner({
  onCardConfirmed,
  enabled = true,
  enableOCR = false, // Disabled by default for speed
}: UseEmbeddingScannerOptions): UseEmbeddingScannerReturn {
  const { cards: cardIndex, loaded: contextLoaded, loading: contextLoading, progress: indexProgress, error: embeddingError } = useCardEmbeddings();
  
  const isIndexReady = contextLoaded && cardIndex.length > 0;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const isScanningRef = useRef(false);
  const lastConfirmTriggerRef = useRef<{ cardId: string; timestamp: number } | null>(null);
  const lastCardCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [autoScanEnabled, setAutoScanEnabled] = useState(false);
  const [lastDetectedId, setLastDetectedId] = useState<string | null>(null);
  const [bestMatch, setBestMatch] = useState<EmbeddedCard | null>(null);
  const [bestScore, setBestScore] = useState<number | null>(null);
  const [matchCandidates, setMatchCandidates] = useState<EmbeddingMatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingMatch, setPendingMatch] = useState<PendingMatch | null>(null);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  const [qualityIssues, setQualityIssues] = useState<string[]>([]);
  const [opencvReady, setOpencvReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [detectedQuad, setDetectedQuad] = useState<CardQuad | null>(null);
  const [cardDetected, setCardDetected] = useState(false);
  
  // New scanner state machine
  const [scannerState, setScannerState] = useState<ScannerState>({ mode: 'SEARCHING' });
  const [scanStatus, setScanStatus] = useState<ScanStatus>({ state: 'READY' });
  const [cardCoverage, setCardCoverage] = useState(0);
  
  // Prediction history for stable-guess detection
  const predictionsRef = useRef<FramePrediction[]>([]);

  // Load OpenCV and CNN model on mount
  useEffect(() => {
    loadOpenCV()
      .then(() => {
        setOpencvReady(true);
        console.log('[EmbeddingScanner] OpenCV loaded');
      })
      .catch((err) => {
        console.warn('[EmbeddingScanner] OpenCV load failed, will use fallback:', err);
      });
    
    loadEmbeddingModel()
      .then(() => {
        setModelReady(true);
        console.log('[EmbeddingScanner] CNN model loaded');
      })
      .catch((err) => {
        console.error('[EmbeddingScanner] CNN model load failed:', err);
        setError('Failed to load recognition model');
      });
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

  // Quick visual-only scan for auto-scan mode with coverage gating
  const quickScanFrame = useCallback(async (): Promise<{
    matches: MultiSignalMatch[];
    embedding: number[];
    cardCanvas: HTMLCanvasElement;
    message: string;
    coverage: number;
  } | null> => {
    if (!videoRef.current || cardIndex.length === 0) return null;

    try {
      const video = videoRef.current;
      if (video.readyState < 2) return null;

      // Step 1: Normalize card with detection + perspective warp
      const normResult = await normalizeCardFromVideoFrame(video);
      
      // Update detected quad state
      setDetectedQuad(normResult.detectedQuad || null);
      setCardDetected(normResult.success);
      
      // Compute coverage if we have a quad
      let coverage = 0;
      if (normResult.detectedQuad) {
        coverage = computeQuadCoverage(
          normResult.detectedQuad,
          video.videoWidth,
          video.videoHeight
        );
        setCardCoverage(coverage);
      } else {
        setCardCoverage(0);
      }
      
      // Coverage gating - require card to fill enough of the frame
      if (!normResult.success || coverage < MIN_CARD_COVERAGE) {
        const msg = coverage < MIN_CARD_COVERAGE && normResult.detectedQuad
          ? 'Move the card closer so it fills the frame.'
          : normResult.message;
        setQualityIssues([msg]);
        setScanStatus({ 
          state: 'NEEDS_MORE_CARD', 
          message: msg
        });
        return null;
      }
      
      setQualityIssues([]);
      lastCardCanvasRef.current = normResult.canvas;

      // Step 2: Resize normalized card canvas to model input size for CNN embedding
      const resizedCanvas = document.createElement('canvas');
      resizedCanvas.width = 224;
      resizedCanvas.height = 224;
      const resizedCtx = resizedCanvas.getContext('2d');
      if (!resizedCtx) return null;
      resizedCtx.drawImage(normResult.canvas, 0, 0, 224, 224);

      // Step 3: Compute CNN embedding from full card
      const frameEmbedding = await computeEmbeddingFromCanvas(resizedCanvas);

      if (!frameEmbedding || frameEmbedding.length === 0) {
        return null;
      }

      // Step 4: Quick visual match
      const matches = quickVisualMatch(frameEmbedding, cardIndex, 5);

      // Log top 5 for debugging
      console.log('[EmbeddingScanner] Top matches:', matches.slice(0, 5).map(m => ({
        id: m.card.cardId,
        name: m.card.name,
        score: (m.combinedScore * 100).toFixed(1) + '%',
        confidence: m.confidence,
      })));

      return { 
        matches, 
        embedding: frameEmbedding, 
        cardCanvas: normResult.canvas,
        message: normResult.message,
        coverage,
      };
    } catch (err) {
      console.error('[EmbeddingScanner] Quick scan error:', err);
      return null;
    }
  }, [cardIndex]);

  // Full multi-signal scan for manual mode
  const fullScanFrame = useCallback(async (): Promise<{
    result: MultiSignalResult;
    embedding: number[];
    cardCanvas: HTMLCanvasElement;
  } | null> => {
    if (!videoRef.current || cardIndex.length === 0) return null;

    try {
      const video = videoRef.current;
      if (video.readyState < 2) return null;

      // Step 1: Normalize card with detection + perspective warp
      const normResult = await normalizeCardFromVideoFrame(video);
      
      // Update detected quad state
      setDetectedQuad(normResult.detectedQuad || null);
      setCardDetected(normResult.success);
      
      if (!normResult.success) {
        setQualityIssues([normResult.message]);
      } else {
        setQualityIssues([]);
      }
      
      lastCardCanvasRef.current = normResult.canvas;

      // Step 2: Resize normalized card canvas to model input size for CNN embedding
      const resizedCanvas = document.createElement('canvas');
      resizedCanvas.width = 224;
      resizedCanvas.height = 224;
      const resizedCtx = resizedCanvas.getContext('2d');
      if (!resizedCtx) return null;
      resizedCtx.drawImage(normResult.canvas, 0, 0, 224, 224);

      // Step 3: Compute CNN embedding from full card
      const frameEmbedding = await computeEmbeddingFromCanvas(resizedCanvas);

      if (!frameEmbedding || frameEmbedding.length === 0) {
        return null;
      }

      // Step 4: Full multi-signal match (with OCR if enabled)
      const result = await multiSignalMatch(
        normResult.canvas,
        frameEmbedding,
        cardIndex,
        enableOCR
      );

      // Log results for debugging
      console.log('[EmbeddingScanner] Multi-signal results:', {
        ocrText: result.ocrText,
        ocrConfidence: result.ocrConfidence,
        topMatches: result.matches.slice(0, 3).map(m => ({
          id: m.card.cardId,
          name: m.card.name,
          visual: (m.visualScore * 100).toFixed(1) + '%',
          ocr: (m.ocrScore * 100).toFixed(1) + '%',
          combined: (m.combinedScore * 100).toFixed(1) + '%',
          confidence: m.confidence,
        })),
        needsConfirmation: result.needsConfirmation,
        ambiguous: result.ambiguous,
      });

      return { result, embedding: frameEmbedding, cardCanvas: normResult.canvas };
    } catch (err) {
      console.error('[EmbeddingScanner] Full scan error:', err);
      return null;
    }
  }, [cardIndex, enableOCR]);

  // Auto-scan with stable-guess detection
  const autoScanFrame = useCallback(async () => {
    if (isScanningRef.current) return;
    
    const now = Date.now();
    
    // Handle cooldown state
    if (scannerState.mode === 'COOLDOWN') {
      if (scannerState.cooldownUntil && now >= scannerState.cooldownUntil) {
        setScannerState({ mode: 'SEARCHING' });
        predictionsRef.current = [];
      } else {
        return; // Skip this frame during cooldown
      }
    }
    
    // If we're in proposal mode, don't process new frames
    if (scannerState.mode === 'PROPOSAL') {
      return;
    }

    isScanningRef.current = true;
    setIsScanning(true);

    try {
      const result = await quickScanFrame();

      if (!result) {
        // quickScanFrame already set the appropriate status
        isScanningRef.current = false;
        setIsScanning(false);
        return;
      }
      
      if (result.matches.length > 0) {
        const topMatch = result.matches[0];
        const secondMatch = result.matches[1];
        const margin = secondMatch 
          ? topMatch.combinedScore - secondMatch.combinedScore 
          : topMatch.combinedScore;
        
        setBestMatch(topMatch.card);
        setBestScore(topMatch.combinedScore);
        setMatchCandidates(result.matches.map(m => ({
          card: m.card,
          score: m.combinedScore,
          visualScore: m.visualScore,
          ocrScore: m.ocrScore,
          confidence: m.confidence,
        })));

        // Add to prediction history
        const newPred: FramePrediction = { 
          cardId: topMatch.card.cardId, 
          similarity: topMatch.combinedScore,
          margin,
          timestamp: now 
        };
        
        // Keep only recent predictions within the stable window
        predictionsRef.current = [
          ...predictionsRef.current.filter(p => now - p.timestamp <= STABLE_WINDOW_MS),
          newPred,
        ];
        
        // Compute stability: count predictions per cardId
        const counts = new Map<string, { count: number; maxSim: number; maxMargin: number }>();
        for (const p of predictionsRef.current) {
          const entry = counts.get(p.cardId) ?? { count: 0, maxSim: 0, maxMargin: 0 };
          entry.count += 1;
          entry.maxSim = Math.max(entry.maxSim, p.similarity);
          entry.maxMargin = Math.max(entry.maxMargin, p.margin);
          counts.set(p.cardId, entry);
        }
        
        // Find the most stable candidate
        let stableCardId: string | null = null;
        let stableCount = 0;
        let stableSim = 0;
        let stableMargin = 0;
        
        for (const [id, { count, maxSim, maxMargin }] of counts.entries()) {
          if (count > stableCount || (count === stableCount && maxSim > stableSim)) {
            stableCardId = id;
            stableCount = count;
            stableSim = maxSim;
            stableMargin = maxMargin;
          }
        }
        
        // Show stabilizing progress
        const progress = Math.min(100, Math.round((stableCount / MIN_STABLE_MATCHES) * 100));
        setScanStatus({ 
          state: 'STABILIZING', 
          message: `Hold steady... (${progress}%)`,
          progress 
        });
        
        // Check if we should propose a stable match
        if (
          stableCardId &&
          stableCount >= MIN_STABLE_MATCHES &&
          stableSim >= MIN_SIMILARITY &&
          stableMargin >= MIN_MARGIN
        ) {
          // Check duplicate cooldown
          const lastTrigger = lastConfirmTriggerRef.current;
          if (!lastTrigger || lastTrigger.cardId !== stableCardId || now - lastTrigger.timestamp >= DUPLICATE_COOLDOWN_MS) {
            console.log(`[EmbeddingScanner] Stable match found: ${topMatch.card.name} (${(stableSim * 100).toFixed(1)}%, ${stableCount} frames)`);
            
            // Build proposal
            const proposal: ScanProposal = {
              cardId: stableCardId,
              cardName: topMatch.card.name,
              similarity: stableSim,
              card: topMatch.card,
              candidates: result.matches.map(m => ({
                card: m.card,
                score: m.combinedScore,
                visualScore: m.visualScore,
                confidence: m.confidence,
              })),
            };
            
            setScannerState({ mode: 'PROPOSAL', proposal });
            setScanStatus({ state: 'PROPOSAL', proposal });
            
            // Also set pending match for confirmation UI
            setPendingMatch({ 
              card: topMatch.card, 
              score: stableSim,
              candidates: result.matches.map(m => ({
                card: m.card,
                score: m.combinedScore,
                visualScore: m.visualScore,
                confidence: m.confidence,
              })),
              visualEmbedding: result.embedding,
              needsConfirmation: true,
              ambiguous: false,
            });
            
            // Clear prediction history
            predictionsRef.current = [];
          }
        }
      } else {
        setScanStatus({ state: 'SEARCHING', message: 'Looking for card...' });
      }
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  }, [quickScanFrame, scannerState]);

  // Start/stop auto-scan loop
  useEffect(() => {
    if (isStreaming && isVideoReady && autoScanEnabled && enabled && isIndexReady) {
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
  }, [isStreaming, isVideoReady, autoScanEnabled, enabled, isIndexReady, autoScanFrame]);

  const openCamera = useCallback(async () => {
    try {
      setError(null);
      setQualityIssues([]);
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
    setQualityIssues([]);
    console.log('[EmbeddingScanner] Camera closed');
  }, []);

  const toggleAutoScan = useCallback(() => {
    setAutoScanEnabled(prev => !prev);
  }, []);

  // Manual scan with full multi-signal matching
  const manualScan = useCallback(async () => {
    console.log('[EmbeddingScanner] Manual scan triggered');
    
    if (!isStreaming || !isVideoReady || !isIndexReady) {
      console.log('[EmbeddingScanner] Manual scan aborted - conditions not met');
      return;
    }

    setIsScanning(true);
    try {
      const scanResult = await fullScanFrame();

      if (scanResult && scanResult.result.matches.length > 0) {
        const { result, embedding } = scanResult;
        const topMatch = result.matches[0];

        setBestMatch(topMatch.card);
        setBestScore(topMatch.combinedScore);
        setMatchCandidates(result.matches.map(m => ({
          card: m.card,
          score: m.combinedScore,
          visualScore: m.visualScore,
          ocrScore: m.ocrScore,
          confidence: m.confidence,
        })));

        // Always show confirmation for manual scan
        setPendingMatch({ 
          card: topMatch.card, 
          score: topMatch.combinedScore,
          candidates: result.matches.map(m => ({
            card: m.card,
            score: m.combinedScore,
            visualScore: m.visualScore,
            ocrScore: m.ocrScore,
            confidence: m.confidence,
          })),
          ocrText: result.ocrText,
          ocrConfidence: result.ocrConfidence,
          visualEmbedding: embedding,
          needsConfirmation: result.needsConfirmation,
          ambiguous: result.ambiguous,
        });

        if (result.message) {
          setQualityIssues([result.message]);
        }
      }
    } finally {
      setIsScanning(false);
    }
  }, [isStreaming, isVideoReady, isIndexReady, fullScanFrame]);

  // Confirm pending match and store feedback
  const confirmPendingMatch = useCallback((selectedCard?: EmbeddedCard) => {
    if (!pendingMatch) return;

    const cardToConfirm = selectedCard || pendingMatch.card;
    const wasCorrect = cardToConfirm.cardId === pendingMatch.card.cardId;

    // Store feedback sample for training
    storeScanFeedback({
      cardId: cardToConfirm.cardId,
      visualEmbedding: pendingMatch.visualEmbedding,
      ocrText: pendingMatch.ocrText,
      ocrConfidence: pendingMatch.ocrConfidence,
      visualScore: pendingMatch.candidates.find(c => c.card.cardId === cardToConfirm.cardId)?.visualScore,
      combinedScore: pendingMatch.score,
      wasCorrect,
      userCorrectedTo: wasCorrect ? undefined : cardToConfirm.cardId,
    });

    // Add to recent scans
    setRecentScans(prev => {
      const next = [{ card: cardToConfirm, timestamp: Date.now() }, ...prev];
      return next.slice(0, 5);
    });

    setLastDetectedId(cardToConfirm.cardId);

    // Convert to CardData format and confirm
    const cardData: CardData = {
      cardId: cardToConfirm.cardId,
      name: cardToConfirm.name,
      setName: cardToConfirm.setName || 'Unknown',
      rarity: cardToConfirm.rarity,
    };

    onCardConfirmed(cardData, cardToConfirm.cardId);
    setPendingMatch(null);
    
    // Record the confirm and enter cooldown
    lastConfirmTriggerRef.current = { cardId: cardToConfirm.cardId, timestamp: Date.now() };
    setScannerState({ mode: 'COOLDOWN', cooldownUntil: Date.now() + 1500 });
    setScanStatus({ state: 'COOLDOWN' });
    predictionsRef.current = [];
  }, [pendingMatch, onCardConfirmed]);

  // Select a different candidate
  const selectCandidate = useCallback((card: EmbeddedCard, score: number) => {
    if (!pendingMatch) return;
    
    setPendingMatch({
      ...pendingMatch,
      card,
      score,
    });
  }, [pendingMatch]);

  const cancelPendingMatch = useCallback(() => {
    setPendingMatch(null);
    // Return to searching state
    setScannerState({ mode: 'SEARCHING' });
    setScanStatus({ state: 'SEARCHING', message: 'Looking for card...' });
    predictionsRef.current = [];
  }, []);
  
  // Rescan function - cancel proposal and go back to searching
  const rescan = useCallback(() => {
    setPendingMatch(null);
    setScannerState({ mode: 'SEARCHING' });
    setScanStatus({ state: 'SEARCHING', message: 'Looking for card...' });
    predictionsRef.current = [];
    setBestMatch(null);
    setBestScore(null);
    setMatchCandidates([]);
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
    isStreaming,
    isVideoReady,
    isScanning,
    autoScanEnabled,
    lastDetectedId,
    bestMatch,
    bestScore,
    matchCandidates,
    indexProgress,
    error: error || embeddingError,
    pendingMatch,
    recentScans,
    qualityIssues,
    opencvReady,
    detectedQuad,
    cardDetected,
    scanStatus,
    cardCoverage,
    openCamera,
    closeCamera,
    toggleAutoScan,
    manualScan,
    handleVideoReady,
    handleVideoError,
    confirmPendingMatch,
    selectCandidate,
    cancelPendingMatch,
    rescan,
  };
}
