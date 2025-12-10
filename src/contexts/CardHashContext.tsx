import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useCardDatabase } from './CardDatabaseContext';
import { getImageHashFromCanvas } from '@/utils/imageHash';

const ART_URL_BASE = 'https://static.dotgg.gg/riftbound/cards';
const HASH_CACHE_KEY = 'riftbound-card-hashes-v2';
const HASH_BITS = 8;

export interface CardWithHash {
  cardId: string;
  name: string;
  setName?: string;
  rarity?: string;
  artUrl: string;
  hash: string;
}

interface CardHashContextValue {
  cardIndex: CardWithHash[];
  isIndexReady: boolean;
  indexProgress: { loaded: number; total: number };
  error: string | null;
}

const CardHashContext = createContext<CardHashContextValue>({
  cardIndex: [],
  isIndexReady: false,
  indexProgress: { loaded: 0, total: 0 },
  error: null,
});

export function useCardHashes() {
  return useContext(CardHashContext);
}

export function CardHashProvider({ children }: { children: React.ReactNode }) {
  const { cards } = useCardDatabase();
  const [cardIndex, setCardIndex] = useState<CardWithHash[]>([]);
  const [isIndexReady, setIsIndexReady] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  // Guard to avoid double-loading in React Strict Mode
  const hasLoadedRef = useRef(false);
  const cardsCountRef = useRef(0);

  useEffect(() => {
    // Only reload if cards actually changed
    if (cards.length === 0) return;
    if (hasLoadedRef.current && cardsCountRef.current === cards.length) return;
    
    hasLoadedRef.current = true;
    cardsCountRef.current = cards.length;

    let cancelled = false;

    async function loadCardHashes() {
      console.log(`[CardHashContext] Starting to load hashes for ${cards.length} cards...`);
      setIndexProgress({ loaded: 0, total: cards.length });
      setIsIndexReady(false);
      setError(null);

      // Try to load cached hashes from localStorage
      let cachedHashes: Record<string, string> = {};
      try {
        const cached = localStorage.getItem(HASH_CACHE_KEY);
        if (cached) {
          cachedHashes = JSON.parse(cached);
          console.log(`[CardHashContext] Loaded ${Object.keys(cachedHashes).length} cached hashes`);
        }
      } catch (e) {
        console.warn('[CardHashContext] Failed to load cached hashes:', e);
      }

      const withHashes: CardWithHash[] = [];
      const newHashes: Record<string, string> = { ...cachedHashes };
      let loadedCount = 0;

      // Check how many need computation
      const cardsNeedingHash = cards.filter(c => !cachedHashes[c.cardId]);
      console.log(`[CardHashContext] ${cardsNeedingHash.length} cards need hash computation`);

      // If all hashes are cached, load them directly
      if (cardsNeedingHash.length === 0) {
        for (const card of cards) {
          withHashes.push({
            cardId: card.cardId,
            name: card.name,
            setName: card.setName,
            rarity: card.rarity,
            artUrl: `${ART_URL_BASE}/${card.cardId}.webp`,
            hash: cachedHashes[card.cardId],
          });
        }
        console.log(`[CardHashContext] All ${withHashes.length} hashes loaded from cache`);
        setCardIndex(withHashes);
        setIndexProgress({ loaded: cards.length, total: cards.length });
        setIsIndexReady(true);
        return;
      }

      // Process cards - use cached where available, compute missing ones
      const BATCH_SIZE = 10;

      for (let i = 0; i < cards.length; i += BATCH_SIZE) {
        if (cancelled) break;

        const batch = cards.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (card) => {
          const artUrl = `${ART_URL_BASE}/${card.cardId}.webp`;

          // Use cached hash if available
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
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = artUrl;

            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error(`Failed to load ${artUrl}`));
            });

            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('No canvas context');
            ctx.drawImage(img, 0, 0);

            const hash = getImageHashFromCanvas(canvas, HASH_BITS);
            newHashes[card.cardId] = hash;

            return {
              cardId: card.cardId,
              name: card.name,
              setName: card.setName,
              rarity: card.rarity,
              artUrl,
              hash,
            };
          } catch (err) {
            console.warn(`[CardHashContext] Failed to hash ${card.cardId}:`, err);
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
          console.log(`[CardHashContext] Cached ${Object.keys(newHashes).length} hashes`);
        } catch (e) {
          console.warn('[CardHashContext] Failed to save hashes to localStorage:', e);
        }

        console.log(`[CardHashContext] Finished loading ${withHashes.length} cards`);
        setCardIndex(withHashes);
        setIsIndexReady(true);
      }
    }

    loadCardHashes().catch((e) => {
      console.error('[CardHashContext] loadCardHashes error:', e);
      setError('Failed to load card image index');
      setIsIndexReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [cards]);

  return (
    <CardHashContext.Provider value={{ cardIndex, isIndexReady, indexProgress, error }}>
      {children}
    </CardHashContext.Provider>
  );
}
