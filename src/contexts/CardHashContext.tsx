import * as React from 'react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CardWithHash {
  cardId: string;
  name: string;
  set?: string;
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
  refreshIndex: () => Promise<void>;
}

const CardHashContext = createContext<CardHashContextValue>({
  cardIndex: [],
  isIndexReady: false,
  indexProgress: { loaded: 0, total: 0 },
  error: null,
  refreshIndex: async () => {},
});

export function useCardHashes() {
  return useContext(CardHashContext);
}

export function CardHashProvider({ children }: { children: React.ReactNode }) {
  const [cardIndex, setCardIndex] = useState<CardWithHash[]>([]);
  const [isIndexReady, setIsIndexReady] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  
  const hasLoadedRef = useRef(false);

  const loadFromDatabase = async () => {
    console.log('[CardHashContext] Loading cards from database...');
    setError(null);
    
    try {
      const { data, error: fetchError, count } = await supabase
        .from('riftbound_cards')
        .select('*', { count: 'exact' });
      
      if (fetchError) {
        throw new Error(`Failed to fetch cards: ${fetchError.message}`);
      }
      
      if (!data || data.length === 0) {
        console.log('[CardHashContext] No cards in database yet');
        setCardIndex([]);
        setIndexProgress({ loaded: 0, total: 0 });
        setIsIndexReady(true);
        return;
      }
      
      // Transform database format to app format
      const cards: CardWithHash[] = data.map((row) => ({
        cardId: row.card_id,
        name: row.name,
        set: row.set_name || undefined,
        setName: row.set_name || undefined,
        rarity: row.rarity || undefined,
        artUrl: row.art_url || '',
        hash: row.hash || '',
      }));
      
      console.log(`[CardHashContext] Loaded ${cards.length} cards from database`);
      
      setCardIndex(cards);
      setIndexProgress({ loaded: cards.length, total: cards.length });
      setIsIndexReady(true);
    } catch (err) {
      console.error('[CardHashContext] Error loading from database:', err);
      setError(err instanceof Error ? err.message : 'Failed to load cards');
      setIsIndexReady(true);
    }
  };

  const refreshIndex = async () => {
    setIsIndexReady(false);
    await loadFromDatabase();
  };

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    
    loadFromDatabase();
  }, []);

  return (
    <CardHashContext.Provider value={{ cardIndex, isIndexReady, indexProgress, error, refreshIndex }}>
      {children}
    </CardHashContext.Provider>
  );
}
