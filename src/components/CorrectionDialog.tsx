import { useState, useMemo } from 'react';
import { Search, X, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCardDatabase } from '@/contexts/CardDatabaseContext';
import { CardData } from '@/data/cardDatabase';
import { cn } from '@/lib/utils';

interface CorrectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCorrect: (card: CardData) => void;
  currentGuess?: string;
}

export function CorrectionDialog({
  isOpen,
  onClose,
  onCorrect,
  currentGuess,
}: CorrectionDialogProps) {
  const { cards } = useCardDatabase();
  const [searchQuery, setSearchQuery] = useState('');

  const suggestions = useMemo(() => {
    if (searchQuery.length < 2) return [];
    const query = searchQuery.toLowerCase();
    return cards
      .filter(card =>
        card.name.toLowerCase().includes(query) ||
        card.cardId.toLowerCase().includes(query)
      )
      .slice(0, 15);
  }, [searchQuery, cards]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center bg-black/60 z-50">
      <div className="bg-card rounded-t-xl sm:rounded-xl p-4 w-full sm:max-w-md border border-border shadow-xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            Select Correct Card
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {currentGuess && (
          <p className="text-sm text-muted-foreground mb-3">
            Scanner guessed: <span className="text-foreground">{currentGuess}</span>
          </p>
        )}

        {/* Search Input */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or ID..."
            className="pl-10"
            autoFocus
          />
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto min-h-0">
          {suggestions.length === 0 && searchQuery.length >= 2 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No cards found
            </p>
          )}
          
          {suggestions.length === 0 && searchQuery.length < 2 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Type at least 2 characters to search
            </p>
          )}

          <div className="space-y-1">
            {suggestions.map((card) => (
              <button
                key={card.cardId}
                onClick={() => onCorrect(card)}
                className={cn(
                  "w-full px-3 py-2 rounded-lg text-left",
                  "hover:bg-accent transition-colors",
                  "flex items-center gap-3"
                )}
              >
                <div className="w-10 h-14 rounded bg-muted overflow-hidden flex-shrink-0">
                  <img
                    src={`https://otyiezyaqexbgibxgqtl.supabase.co/storage/v1/object/public/riftbound-cards/${card.cardId}.webp`}
                    alt={card.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/placeholder.svg';
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{card.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {card.cardId} • {card.setName}
                  </p>
                </div>
                <Check className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
