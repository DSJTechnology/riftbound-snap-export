import { useState, useCallback, useEffect } from 'react';
import { CollectionEntry, ExportSettings } from '@/types/collection';
import { CardData } from '@/data/cardDatabase';

const STORAGE_KEY = 'riftbound-collection';
const SETTINGS_KEY = 'riftbound-export-settings';

export function useCollection() {
  const [collection, setCollection] = useState<CollectionEntry[]>(() => {
    // Load from localStorage on init
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [exportSettings, setExportSettings] = useState<ExportSettings>(() => {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? JSON.parse(saved) : {
      portfolioName: 'Riftbound Portfolio',
      category: 'TCG'
    };
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
  }, [collection]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(exportSettings));
  }, [exportSettings]);

  // Add a card to the collection
  const addCard = useCallback((card: CardData, normalCount: number = 1, foilCount: number = 0) => {
    setCollection(prev => {
      const existing = prev.find(c => c.cardId === card.cardId);
      if (existing) {
        return prev.map(c => 
          c.cardId === card.cardId 
            ? { ...c, normalCount: c.normalCount + normalCount, foilCount: c.foilCount + foilCount }
            : c
        );
      }
      return [...prev, { ...card, normalCount, foilCount }];
    });
  }, []);

  // Update counts for a card
  const updateCardCounts = useCallback((cardId: string, normalCount: number, foilCount: number) => {
    setCollection(prev => {
      // Remove if both counts are 0
      if (normalCount <= 0 && foilCount <= 0) {
        return prev.filter(c => c.cardId !== cardId);
      }
      return prev.map(c =>
        c.cardId === cardId
          ? { ...c, normalCount: Math.max(0, normalCount), foilCount: Math.max(0, foilCount) }
          : c
      );
    });
  }, []);

  // Remove a card from collection
  const removeCard = useCallback((cardId: string) => {
    setCollection(prev => prev.filter(c => c.cardId !== cardId));
  }, []);

  // Clear entire collection
  const clearCollection = useCallback(() => {
    setCollection([]);
  }, []);

  // Get collection stats
  const stats = {
    uniqueCards: collection.length,
    totalCards: collection.reduce((sum, c) => sum + c.normalCount + c.foilCount, 0),
    totalNormal: collection.reduce((sum, c) => sum + c.normalCount, 0),
    totalFoil: collection.reduce((sum, c) => sum + c.foilCount, 0),
  };

  return {
    collection,
    exportSettings,
    setExportSettings,
    addCard,
    updateCardCounts,
    removeCard,
    clearCollection,
    stats,
  };
}
