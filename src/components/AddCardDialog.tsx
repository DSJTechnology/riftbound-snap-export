import { useState } from 'react';
import { Plus, Minus, X, Sparkles, CircleDot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardData } from '@/data/cardDatabase';
import { cn } from '@/lib/utils';

interface AddCardDialogProps {
  card: CardData;
  onConfirm: (normalCount: number, foilCount: number) => void;
  onCancel: () => void;
}

export function AddCardDialog({ card, onConfirm, onCancel }: AddCardDialogProps) {
  const [normalCount, setNormalCount] = useState(1);
  const [foilCount, setFoilCount] = useState(0);

  const handleConfirm = () => {
    if (normalCount > 0 || foilCount > 0) {
      onConfirm(normalCount, foilCount);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in">
      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-lg overflow-hidden animate-in">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-lg text-foreground truncate">{card.name}</h3>
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                <span className="font-mono">{card.cardId}</span>
                <span>•</span>
                <span>{card.setName}</span>
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onCancel}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          {card.rarity && (
            <span className={cn(
              "inline-block text-xs px-2 py-0.5 rounded font-medium mt-2",
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

        {/* Count selectors */}
        <div className="p-4 space-y-4">
          {/* Normal count */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CircleDot className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">Normal</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="icon"
                size="icon-sm"
                onClick={() => setNormalCount(Math.max(0, normalCount - 1))}
              >
                <Minus className="w-4 h-4" />
              </Button>
              <span className="w-8 text-center font-mono text-lg">{normalCount}</span>
              <Button
                variant="icon"
                size="icon-sm"
                onClick={() => setNormalCount(normalCount + 1)}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Foil count */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="font-medium">Foil</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="icon"
                size="icon-sm"
                onClick={() => setFoilCount(Math.max(0, foilCount - 1))}
              >
                <Minus className="w-4 h-4" />
              </Button>
              <span className="w-8 text-center font-mono text-lg">{foilCount}</span>
              <Button
                variant="icon"
                size="icon-sm"
                onClick={() => setFoilCount(foilCount + 1)}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 pt-0 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button 
            variant="scanner" 
            className="flex-1"
            onClick={handleConfirm}
            disabled={normalCount === 0 && foilCount === 0}
          >
            Add to Collection
          </Button>
        </div>
      </div>
    </div>
  );
}
