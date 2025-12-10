import { Plus, Minus, Trash2, Sparkles, CircleDot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollectionEntry } from '@/types/collection';
import { cn } from '@/lib/utils';

interface CollectionListProps {
  collection: CollectionEntry[];
  onUpdateCounts: (cardId: string, normalCount: number, foilCount: number) => void;
  onRemove: (cardId: string) => void;
}

export function CollectionList({ collection, onUpdateCounts, onRemove }: CollectionListProps) {
  if (collection.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
          <CircleDot className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">No cards in collection yet</p>
        <p className="text-sm text-muted-foreground/70 mt-1">Scan or search for cards to add them</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {collection.map((card) => (
        <div
          key={card.cardId}
          className="glass-card p-3 animate-in"
        >
          {/* Card info row */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground truncate">{card.name}</span>
                {card.rarity && (
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0",
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
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <span className="font-mono">{card.cardId}</span>
                <span>•</span>
                <span className="truncate">{card.setName}</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onRemove(card.cardId)}
              className="text-muted-foreground hover:text-destructive shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          {/* Count controls */}
          <div className="flex items-center gap-4">
            {/* Normal count */}
            <div className="flex items-center gap-1.5 flex-1">
              <CircleDot className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground">Normal</span>
              <div className="flex items-center gap-1 ml-auto">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7"
                  onClick={() => onUpdateCounts(card.cardId, card.normalCount - 1, card.foilCount)}
                >
                  <Minus className="w-3 h-3" />
                </Button>
                <span className="w-6 text-center font-mono text-sm">{card.normalCount}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7"
                  onClick={() => onUpdateCounts(card.cardId, card.normalCount + 1, card.foilCount)}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            </div>

            <div className="w-px h-6 bg-border" />

            {/* Foil count */}
            <div className="flex items-center gap-1.5 flex-1">
              <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-xs text-muted-foreground">Foil</span>
              <div className="flex items-center gap-1 ml-auto">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7"
                  onClick={() => onUpdateCounts(card.cardId, card.normalCount, card.foilCount - 1)}
                >
                  <Minus className="w-3 h-3" />
                </Button>
                <span className="w-6 text-center font-mono text-sm">{card.foilCount}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7"
                  onClick={() => onUpdateCounts(card.cardId, card.normalCount, card.foilCount + 1)}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
