import { useState, useMemo, useRef, useEffect, RefObject } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { CardData } from '@/data/cardDatabase';
import { useCardDatabase, createCardDatabaseHelpers } from '@/contexts/CardDatabaseContext';
import { cn } from '@/lib/utils';

interface CardSearchProps {
  onCardSelect: (card: CardData) => void;
  autoFocus?: boolean;
  inputRef?: RefObject<HTMLInputElement>;
}

export function CardSearch({ onCardSelect, autoFocus = false, inputRef: externalRef }: CardSearchProps) {
  const { cards } = useCardDatabase();
  const cardHelpers = useMemo(() => createCardDatabaseHelpers(cards), [cards]);
  
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef || internalRef;
  const dropdownRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (query.length < 2) return [];
    return cardHelpers.searchCardsByName(query).slice(0, 10);
  }, [query, cardHelpers]);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    setIsOpen(results.length > 0);
  }, [results]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (card: CardData) => {
    onCardSelect(card);
    setQuery('');
    setIsOpen(false);
  };

  const handleClear = () => {
    setQuery('');
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="Search by card name or ID..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          className="pl-10 pr-10"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Search Results Dropdown */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-lg overflow-hidden animate-in">
          <div className="max-h-[280px] overflow-y-auto scrollbar-hide">
            {results.map((card) => (
              <button
                key={card.cardId}
                onClick={() => handleSelect(card)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-b-0 text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">{card.name}</span>
                    {card.rarity && (
                      <span className={cn(
                        "text-xs px-1.5 py-0.5 rounded font-medium shrink-0",
                        card.rarity === 'Mythic' && "bg-primary/20 text-primary",
                        card.rarity === 'Legendary' && "bg-secondary/20 text-secondary",
                        card.rarity === 'Epic' && "bg-accent/20 text-accent",
                        card.rarity === 'Rare' && "bg-blue-500/20 text-blue-400",
                        card.rarity === 'Uncommon' && "bg-green-500/20 text-green-400",
                        card.rarity === 'Common' && "bg-muted text-muted-foreground",
                      )}>
                        {card.rarity}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
                    <span className="font-mono">{card.cardId}</span>
                    <span>•</span>
                    <span>{card.setName}</span>
                  </div>
                </div>
                <Plus className="w-4 h-4 text-muted-foreground ml-2 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No results message */}
      {query.length >= 2 && results.length === 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-lg p-4 text-center text-sm text-muted-foreground animate-in">
          No cards found matching "{query}"
        </div>
      )}
    </div>
  );
}
