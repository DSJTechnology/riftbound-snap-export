import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface EmbeddedCard {
  cardId: string;
  name: string;
  set?: string;
  setName?: string;
  rarity?: string;
  artUrl: string;
  embedding: number[];
}

interface CardEmbeddingContextValue {
  cards: EmbeddedCard[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  progress: { loaded: number; total: number };
  refreshEmbeddings: () => Promise<void>;
}

const CardEmbeddingContext = createContext<CardEmbeddingContextValue>({
  cards: [],
  loaded: false,
  loading: false,
  error: null,
  progress: { loaded: 0, total: 0 },
  refreshEmbeddings: async () => {},
});

export function useCardEmbeddings() {
  return useContext(CardEmbeddingContext);
}

export function CardEmbeddingProvider({ children }: { children: React.ReactNode }) {
  const [cards, setCards] = useState<EmbeddedCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  
  const hasLoadedRef = useRef(false);

  const loadEmbeddings = async () => {
    console.log('[CardEmbeddingContext] Loading embeddings from database...');
    setLoading(true);
    setError(null);
    
    try {
      // First, get total count
      const { count } = await supabase
        .from('riftbound_cards')
        .select('*', { count: 'exact', head: true });
      
      const total = count || 0;
      setProgress({ loaded: 0, total });
      
      if (total === 0) {
        console.log('[CardEmbeddingContext] No cards in database yet');
        setCards([]);
        setLoaded(true);
        setLoading(false);
        return;
      }
      
      // Fetch cards with embeddings
      const { data, error: fetchError } = await supabase
        .from('riftbound_cards')
        .select('card_id, name, set_name, rarity, art_url, embedding');
      
      if (fetchError) {
        throw new Error(`Failed to fetch cards: ${fetchError.message}`);
      }
      
      if (!data || data.length === 0) {
        console.log('[CardEmbeddingContext] No cards returned');
        setCards([]);
        setLoaded(true);
        setLoading(false);
        return;
      }
      
      // Transform and filter cards with valid embeddings
      const embeddedCards: EmbeddedCard[] = [];
      
      for (const row of data) {
        // Parse embedding from JSONB - comes as array or needs parsing
        let embedding: number[] = [];
        
        if (row.embedding) {
          try {
            if (typeof row.embedding === 'string') {
              embedding = JSON.parse(row.embedding) as number[];
            } else if (Array.isArray(row.embedding)) {
              // Create a new array to ensure no shared references
              embedding = [...(row.embedding as unknown as number[])];
            }
          } catch (e) {
            console.warn(`[CardEmbeddingContext] Failed to parse embedding for ${row.card_id}:`, e);
            continue;
          }
        }
        
        // Skip cards without valid embeddings
        if (!embedding || embedding.length === 0) {
          continue;
        }
        
        embeddedCards.push({
          cardId: row.card_id,
          name: row.name,
          set: row.set_name || undefined,
          setName: row.set_name || undefined,
          rarity: row.rarity || undefined,
          artUrl: row.art_url || '',
          embedding: [...embedding], // Clone to ensure distinct arrays
        });
        
        setProgress({ loaded: embeddedCards.length, total });
      }
      
      // Log diagnostic info for first 3 cards to verify distinct embeddings
      if (embeddedCards.length >= 3) {
        console.log('[CardEmbeddingContext] Embedding samples:');
        for (let i = 0; i < 3; i++) {
          const card = embeddedCards[i];
          console.log(`  ${card.cardId}: [${card.embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
        }
      }
      
      console.log(`[CardEmbeddingContext] Loaded ${embeddedCards.length} cards with embeddings`);
      
      setCards(embeddedCards);
      setProgress({ loaded: embeddedCards.length, total: embeddedCards.length });
      setLoaded(true);
    } catch (err) {
      console.error('[CardEmbeddingContext] Error loading embeddings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load embeddings');
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  const refreshEmbeddings = async () => {
    setLoaded(false);
    await loadEmbeddings();
  };

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    
    loadEmbeddings();
  }, []);

  return (
    <CardEmbeddingContext.Provider value={{ cards, loaded, loading, error, progress, refreshEmbeddings }}>
      {children}
    </CardEmbeddingContext.Provider>
  );
}
