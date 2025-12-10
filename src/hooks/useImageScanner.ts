import { useRef, useState, useCallback, useEffect } from 'react';
import { CardData } from '@/data/cardDatabase';
import { getImageHashFromCanvas, hammingDistanceHex, getImageHashFromUrl } from '@/utils/imageHash';

// Configuration constants
const SCAN_INTERVAL_MS = 800; // How often to scan (ms)
const HASH_BITS = 8; // 8x8 = 64 bits for hash
const MAX_DISTANCE_AUTO_CONFIRM = 8; // Trigger confirmation modal if distance <= this (out of 64)
const DUPLICATE_COOLDOWN_MS = 3000; // Time before same card can trigger confirmation again
const ART_URL_BASE = 'https://static.dotgg.gg/riftbound/cards';
const HASH_CACHE_KEY = 'riftbound-card-hashes';

export interface CardWithHash {
  cardId: string;
  name: string;
  setName?: string;
  rarity?: string;
  artUrl: string;
  hash: string;
}

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
  cards: CardData[];
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
  manualScan: () => Promise<void>;
  handleVideoReady: () => void;
  handleVideoError: () => void;
  confirmPendingMatch: () => void;
  cancelPendingMatch: () => void;
}

export function useImageScanner({
  cards,
  onCardConfirmed,
  enabled = true,
}: UseImageScannerOptions): UseImageScannerReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const isScanningRef = useRef(false);
  const lastConfirmTriggerRef = useRef<{ cardId: string; timestamp: number } | null>(null);

  const [cardIndex, setCardIndex] = useState<CardWithHash[]>([]);
  const [isIndexReady, setIsIndexReady] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ loaded: 0, total: 0 });
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

  // Load cached hashes from localStorage and compute missing ones
  useEffect(() => {
    if (cards.length === 0) return;

    let cancelled = false;

    async function loadCardHashes() {
      console.log(`[ImageScanner] Starting to load hashes for ${cards.length} cards...`);
      setIndexProgress({ loaded: 0, total: cards.length });
      setIsIndexReady(false);

      // Try to load cached hashes
      let cachedHashes: Record<string, string> = {};
      try {
        const cached = localStorage.getItem(HASH_CACHE_KEY);
        if (cached) {
          cachedHashes = JSON.parse(cached);
          console.log(`[ImageScanner] Loaded ${Object.keys(cachedHashes).length} cached hashes`);
        }
      } catch (e) {
        console.warn('[ImageScanner] Failed to load cached hashes:', e);
      }

      const withHashes: CardWithHash[] = [];
      const newHashes: Record<string, string> = { ...cachedHashes };
      let loadedCount = 0;

      // Process in batches
      const BATCH_SIZE = 10;
      
      for (let i = 0; i < cards.length; i += BATCH_SIZE) {
        if (cancelled) break;

        const batch = cards.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (card) => {
          const artUrl = `${ART_URL_BASE}/${card.cardId}.webp`;
          
          // Check if hash is already cached
          if (cachedHashes[card.cardId]) {
            return {
              cardId: card.cardId,
              name: card.name,
              setName: card.setName,
              rarity: card.rarity,
              artUrl,
              hash: cachedHashes[card.cardId],
            };
          }

          // Compute hash for missing card
          try {
            const hash = await getImageHashFromUrl(artUrl, HASH_BITS);
            newHashes[card.cardId] = hash; // Add to cache
            return {
              cardId: card.cardId,
              name: card.name,
              setName: card.setName,
              rarity: card.rarity,
              artUrl,
              hash,
            };
          } catch (err) {
            console.warn(`[ImageScanner] Failed to hash ${card.cardId}:`, err);
            return null;
          }
        });

        const results = await Promise.all(batchPromises);
        
        for (const result of results) {
          if (result) {
            withHashes.push(result);
          }
          loadedCount++;
        }

        if (!cancelled) {
          setIndexProgress({ loaded: loadedCount, total: cards.length });
        }
      }

      if (!cancelled) {
        // Save updated hashes to localStorage
        try {
          localStorage.setItem(HASH_CACHE_KEY, JSON.stringify(newHashes));
          console.log(`[ImageScanner] Cached ${Object.keys(newHashes).length} hashes`);
        } catch (e) {
          console.warn('[ImageScanner] Failed to save hashes to localStorage:', e);
        }

        console.log(`[ImageScanner] Finished loading ${withHashes.length} cards`);
        setCardIndex(withHashes);
        setIsIndexReady(true);
      }
    }

    loadCardHashes().catch((e) => {
      console.error('[ImageScanner] loadCardHashes error:', e);
      setError('Failed to load card image index');
    });

    return () => {
      cancelled = true;
    };
  }, [cards]);

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

  // Scan the current camera frame
  const scanFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || cardIndex.length === 0) return;
    if (isScanningRef.current) return;

    isScanningRef.current = true;
    setIsScanning(true);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      if (!ctx || video.readyState < 2) {
        return;
      }

      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;

      // Draw full frame
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(video, 0, 0, width, height);

      // Crop to middle region where card art should be
      // Card is typically held in portrait, art is in top-middle area
      const cropWidth = Math.floor(width * 0.75);
      const cropHeight = Math.floor(height * 0.55);
      const sx = Math.floor((width - cropWidth) / 2);
      const sy = Math.floor(height * 0.1); // Start 10% from top

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropWidth;
      cropCanvas.height = cropHeight;
      const cropCtx = cropCanvas.getContext('2d');
      
      if (!cropCtx) return;

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

      // Auto-trigger confirmation modal if distance is low enough
      if (best && bestDist <= MAX_DISTANCE_AUTO_CONFIRM) {
        const now = Date.now();
        const lastTrigger = lastConfirmTriggerRef.current;
        
        // Check duplicate cooldown - don't spam confirmation for same card
        if (!lastTrigger || lastTrigger.cardId !== best.cardId || now - lastTrigger.timestamp >= DUPLICATE_COOLDOWN_MS) {
          console.log(`[ImageScanner] Triggering confirmation for: ${best.name} (${best.cardId})`);
          lastConfirmTriggerRef.current = { cardId: best.cardId, timestamp: now };
          setPendingMatch({ card: best, distance: bestDist });
        }
      }
    } catch (err) {
      console.error('[ImageScanner] Scan frame error:', err);
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  }, [cardIndex]);

  // Start/stop auto-scan loop
  useEffect(() => {
    if (isStreaming && isVideoReady && autoScanEnabled && enabled && isIndexReady) {
      console.log('[ImageScanner] Starting auto-scan loop');
      scanIntervalRef.current = window.setInterval(scanFrame, SCAN_INTERVAL_MS);
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
  }, [isStreaming, isVideoReady, autoScanEnabled, enabled, isIndexReady, scanFrame]);

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

  const manualScan = useCallback(async () => {
    if (!isStreaming || !isVideoReady || !isIndexReady) return;
    await scanFrame();
    // After manual scan, always show confirmation for best match if found
    if (bestMatch && bestDistance !== null) {
      setPendingMatch({ card: bestMatch, distance: bestDistance });
    }
  }, [isStreaming, isVideoReady, isIndexReady, scanFrame, bestMatch, bestDistance]);

  const confirmPendingMatch = useCallback(() => {
    if (!pendingMatch) return;
    
    const { card } = pendingMatch;
    
    // Add to recent scans
    setRecentScans(prev => {
      const next = [{ card, timestamp: Date.now() }, ...prev];
      return next.slice(0, 5); // Keep last 5
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
    error,
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
