import * as React from 'react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { validateEmbedding, EMBEDDING_SIZE } from '@/utils/embeddingConfig';
import { l2Normalize, computeNorm } from '@/utils/artEmbedding';

export interface EmbeddedCard {
  cardId: string;
  name: string;
  set?: string;
  setName?: string;
  rarity?: string;
  artUrl: string;
  embedding: number[];
}

interface EmbeddingDiagnostics {
  totalLoaded: number;
  validCount: number;
  invalidCount: number;
  sampleCards: Array<{
    cardId: string;
    name: string;
    firstValues: number[];
    norm: number;
    valid: boolean;
  }>;
}

interface CardEmbeddingContextValue {
  cards: EmbeddedCard[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  progress: { loaded: number; total: number };
  diagnostics: EmbeddingDiagnostics | null;
  refreshEmbeddings: () => Promise<void>;
}

const CardEmbeddingContext = createContext<CardEmbeddingContextValue>({
  cards: [],
  loaded: false,
  loading: false,
  error: null,
  progress: { loaded: 0, total: 0 },
  diagnostics: null,
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
  const [diagnostics, setDiagnostics] = useState<EmbeddingDiagnostics | null>(null);
  
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
        setDiagnostics({ totalLoaded: 0, validCount: 0, invalidCount: 0, sampleCards: [] });
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
      
      // Transform and validate cards with embeddings
      const embeddedCards: EmbeddedCard[] = [];
      const sampleCards: EmbeddingDiagnostics['sampleCards'] = [];
      let validCount = 0;
      let invalidCount = 0;
      
      for (const row of data) {
        // Parse embedding from JSONB
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
            invalidCount++;
            continue;
          }
        }
        
        // Skip cards without valid embeddings
        if (!embedding || embedding.length === 0) {
          invalidCount++;
          continue;
        }
        
        // Validate embedding
        const validation = validateEmbedding(embedding);
        
        if (!validation.valid) {
          console.warn(`[CardEmbeddingContext] Invalid embedding for ${row.card_id}:`, validation.issues);
          
          // Try to fix by re-normalizing if it's just a norm issue
          if (embedding.length === EMBEDDING_SIZE) {
            embedding = l2Normalize(embedding);
          } else {
            invalidCount++;
            continue;
          }
        }
        
        validCount++;
        
        // Collect diagnostic samples (first 5 cards)
        if (sampleCards.length < 5) {
          sampleCards.push({
            cardId: row.card_id,
            name: row.name,
            firstValues: embedding.slice(0, 5),
            norm: computeNorm(embedding),
            valid: validation.valid,
          });
        }
        
        embeddedCards.push({
          cardId: row.card_id,
          name: row.name,
          set: row.set_name || undefined,
          setName: row.set_name || undefined,
          rarity: row.rarity || undefined,
          artUrl: row.art_url || '',
          embedding: embedding, // Already cloned above
        });
        
        setProgress({ loaded: embeddedCards.length, total });
      }
      
      // Log diagnostic info
      console.log('[CardEmbeddingContext] Embedding diagnostics:');
      console.log(`  Total: ${data.length}, Valid: ${validCount}, Invalid: ${invalidCount}`);
      for (const sample of sampleCards) {
        console.log(`  ${sample.cardId} (${sample.name}): [${sample.firstValues.map(v => v.toFixed(4)).join(', ')}...] norm=${sample.norm.toFixed(4)}`);
      }
      
      // Check for duplicate embeddings (potential issue)
      if (sampleCards.length >= 2) {
        const first = sampleCards[0].firstValues;
        const second = sampleCards[1].firstValues;
        const areSimilar = first.every((v, i) => Math.abs(v - second[i]) < 0.001);
        if (areSimilar) {
          console.warn('[CardEmbeddingContext] WARNING: First two embeddings appear identical!');
        }
      }
      
      setDiagnostics({
        totalLoaded: embeddedCards.length,
        validCount,
        invalidCount,
        sampleCards,
      });
      
      console.log(`[CardEmbeddingContext] Loaded ${embeddedCards.length} cards with valid embeddings`);
      
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
    <CardEmbeddingContext.Provider value={{ cards, loaded, loading, error, progress, diagnostics, refreshEmbeddings }}>
      {children}
    </CardEmbeddingContext.Provider>
  );
}
