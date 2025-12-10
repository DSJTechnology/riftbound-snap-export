import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

export interface CardWithHash {
  cardId: string;
  name: string;
  set?: string;
  setName?: string; // Alias for compatibility
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
  const [cardIndex, setCardIndex] = useState<CardWithHash[]>([]);
  const [isIndexReady, setIsIndexReady] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  
  // Guard against double-loading in React Strict Mode
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    async function loadHashes() {
      console.log('[CardHashContext] Loading precomputed hashes from JSON...');
      
      try {
        const res = await fetch('/data/riftbound_card_hashes.json');
        
        if (!res.ok) {
          throw new Error(`Failed to load hashes: ${res.status} ${res.statusText}`);
        }
        
        const data: CardWithHash[] = await res.json();
        
        // Normalize: ensure setName is populated from set for compatibility
        const normalized = data.map(card => ({
          ...card,
          setName: card.setName || card.set,
        }));
        
        console.log(`[CardHashContext] Loaded ${normalized.length} card hashes`);
        
        setCardIndex(normalized);
        setIndexProgress({ loaded: normalized.length, total: normalized.length });
        setIsIndexReady(true);
      } catch (err) {
        console.error('[CardHashContext] Error loading card hash index:', err);
        setError(err instanceof Error ? err.message : 'Failed to load card hash index');
        // Don't set isIndexReady to true on error
      }
    }

    loadHashes();
  }, []);

  return (
    <CardHashContext.Provider value={{ cardIndex, isIndexReady, indexProgress, error }}>
      {children}
    </CardHashContext.Provider>
  );
}
