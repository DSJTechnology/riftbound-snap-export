import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { CardData, cardDatabase as fallbackCards } from '@/data/cardDatabase';

interface CardDatabaseState {
  cards: CardData[];
  lastUpdated: Date | null;
  isLoading: boolean;
  error: string | null;
  refreshCards: () => Promise<void>;
}

const CardDatabaseContext = createContext<CardDatabaseState | undefined>(undefined);

const STORAGE_KEY = 'riftbound-card-database';
const STORAGE_TIMESTAMP_KEY = 'riftbound-card-database-timestamp';


export function CardDatabaseProvider({ children }: { children: ReactNode }) {
  const [cards, setCards] = useState<CardData[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const storedCards = localStorage.getItem(STORAGE_KEY);
      const storedTimestamp = localStorage.getItem(STORAGE_TIMESTAMP_KEY);

      if (storedCards) {
        const parsedCards = JSON.parse(storedCards) as CardData[];
        if (Array.isArray(parsedCards) && parsedCards.length > 0) {
          setCards(parsedCards);
          if (storedTimestamp) {
            setLastUpdated(new Date(storedTimestamp));
          }
          setInitialized(true);
          return;
        }
      }
    } catch (e) {
      console.warn('Failed to load cards from localStorage:', e);
    }

    // Fall back to built-in cards if nothing in localStorage
    setCards(fallbackCards);
    setInitialized(true);
  }, []);

  // Save to localStorage when cards change (after initialization)
  useEffect(() => {
    if (initialized && cards.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
        if (lastUpdated) {
          localStorage.setItem(STORAGE_TIMESTAMP_KEY, lastUpdated.toISOString());
        }
      } catch (e) {
        console.warn('Failed to save cards to localStorage:', e);
      }
    }
  }, [cards, lastUpdated, initialized]);

  const refreshCards = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // Use CORS proxy to bypass browser restrictions
    const apiUrl = 'https://api.dotgg.gg/cgfw/getcards?game=riftbound&mode=indexed';
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`;

    try {
      const response = await fetch(proxyUrl, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Handle the indexed format: { names: [...], data: [[...], [...], ...] }
      const mappedCards: CardData[] = [];
      
      if (data && Array.isArray(data.names) && Array.isArray(data.data)) {
        // Find column indices
        const names = data.names as string[];
        const idIndex = names.indexOf('id');
        const nameIndex = names.indexOf('name');
        const setNameIndex = names.indexOf('set_name');
        const rarityIndex = names.indexOf('rarity');
        
        if (idIndex === -1 || nameIndex === -1) {
          throw new Error('API response missing required fields (id, name)');
        }
        
        for (const row of data.data) {
          if (!Array.isArray(row)) continue;
          
          const cardId = row[idIndex];
          const name = row[nameIndex];
          const setName = setNameIndex !== -1 ? row[setNameIndex] : 'Unknown Set';
          const rarity = rarityIndex !== -1 ? row[rarityIndex] : undefined;
          
          if (cardId && typeof cardId === 'string' && name && typeof name === 'string') {
            mappedCards.push({
              cardId: cardId.trim().toUpperCase(),
              name: name.trim(),
              setName: typeof setName === 'string' ? setName.trim() : 'Unknown Set',
              rarity: typeof rarity === 'string' ? rarity.trim() : undefined,
            });
          }
        }
      } else {
        throw new Error('Unexpected API response format');
      }

      if (mappedCards.length === 0) {
        throw new Error('Could not parse any cards from API response');
      }

      // Deduplicate by cardId (keep first occurrence)
      const uniqueCards = Array.from(
        new Map(mappedCards.map(card => [card.cardId, card])).values()
      );

      setCards(uniqueCards);
      setLastUpdated(new Date());
      setError(null);

      return;
    } catch (e) {
      console.error('Failed to refresh card database:', e);
      const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
      
      // Check for CORS error
      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
        setError('Could not connect to card database. This may be a network or CORS issue. Please try again later.');
      } else {
        setError(`Could not update card database: ${errorMessage}`);
      }
      
      // Keep existing cards on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <CardDatabaseContext.Provider
      value={{
        cards,
        lastUpdated,
        isLoading,
        error,
        refreshCards,
      }}
    >
      {children}
    </CardDatabaseContext.Provider>
  );
}

export function useCardDatabase() {
  const context = useContext(CardDatabaseContext);
  if (context === undefined) {
    throw new Error('useCardDatabase must be used within a CardDatabaseProvider');
  }
  return context;
}

// Helper functions that use the context cards
export function createCardDatabaseHelpers(cards: CardData[]) {
  const findCardById = (cardId: string): CardData | undefined => {
    return cards.find(card => card.cardId.toLowerCase() === cardId.toLowerCase());
  };

  const searchCardsByName = (query: string): CardData[] => {
    const lowerQuery = query.toLowerCase();
    return cards.filter(card =>
      card.name.toLowerCase().includes(lowerQuery) ||
      card.cardId.toLowerCase().includes(lowerQuery)
    );
  };

  const getAllSets = (): string[] => {
    return [...new Set(cards.map(card => card.setName))];
  };

  const getCardsBySet = (setName: string): CardData[] => {
    return cards.filter(card => card.setName === setName);
  };

  return {
    findCardById,
    searchCardsByName,
    getAllSets,
    getCardsBySet,
  };
}
