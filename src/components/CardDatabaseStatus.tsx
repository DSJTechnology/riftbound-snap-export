import { RefreshCw, Database, CheckCircle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCardDatabase } from '@/contexts/CardDatabaseContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useState, useMemo } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';

export function CardDatabaseStatus() {
  const { cards, lastUpdated, isLoading, error, refreshCards } = useCardDatabase();
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());

  const handleRefresh = async () => {
    try {
      await refreshCards();
      toast.success(`Card database updated. ${cards.length} cards loaded.`);
    } catch (e) {
      // Error is already handled in context
    }
  };

  // Group cards by set with full card data
  const cardsBySet = useMemo(() => {
    const grouped: Record<string, typeof cards> = {};
    cards.forEach(card => {
      const set = card.setName || 'Unknown Set';
      if (!grouped[set]) {
        grouped[set] = [];
      }
      grouped[set].push(card);
    });
    // Sort sets by name, and cards within each set by cardId
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([setName, setCards]) => ({
        setName,
        cards: setCards.sort((a, b) => a.cardId.localeCompare(b.cardId))
      }));
  }, [cards]);

  const toggleSet = (setName: string) => {
    setExpandedSets(prev => {
      const next = new Set(prev);
      if (next.has(setName)) {
        next.delete(setName);
      } else {
        next.add(setName);
      }
      return next;
    });
  };

  return (
    <div className="p-4 rounded-lg bg-card border border-border space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Card Database</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {cards.length > 0 && (
            <>
              <CheckCircle className="w-3.5 h-3.5 text-green-500" />
              <span>{cards.length} cards total</span>
            </>
          )}
        </div>
      </div>

      {/* Last updated info */}
      <div className="text-xs text-muted-foreground">
        {lastUpdated ? (
          <span>Last updated: {format(lastUpdated, 'MMM d, yyyy h:mm a')}</span>
        ) : (
          <span>Using built-in card database</span>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 p-2 rounded bg-destructive/10 border border-destructive/20">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Update button */}
      <Button
        onClick={handleRefresh}
        disabled={isLoading}
        variant="outline"
        size="sm"
        className="w-full"
      >
        {isLoading ? (
          <>
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            Updating...
          </>
        ) : (
          <>
            <RefreshCw className="w-4 h-4 mr-2" />
            Update Card Database
          </>
        )}
      </Button>

      {/* Cards by Set - Expandable */}
      {cards.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">Cards by Set</h4>
          <ScrollArea className="max-h-80">
            <div className="space-y-1 pr-3">
              {cardsBySet.map(({ setName, cards: setCards }) => (
                <Collapsible
                  key={setName}
                  open={expandedSets.has(setName)}
                  onOpenChange={() => toggleSet(setName)}
                >
                  <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-2 rounded-md bg-muted/50 hover:bg-muted transition-colors text-sm">
                    <div className="flex items-center gap-2">
                      {expandedSets.has(setName) ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="text-foreground truncate">{setName}</span>
                    </div>
                    <span className="text-muted-foreground font-mono text-xs ml-2 shrink-0">
                      {setCards.length} cards
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-6 mt-1 space-y-0.5 max-h-48 overflow-y-auto">
                      {setCards.map(card => (
                        <div
                          key={card.cardId}
                          className="flex items-center justify-between px-2 py-1.5 text-xs rounded hover:bg-muted/30"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-primary shrink-0">{card.cardId}</span>
                            <span className="text-foreground truncate">{card.name}</span>
                          </div>
                          {card.rarity && (
                            <span className="text-muted-foreground text-[10px] shrink-0 ml-2">
                              {card.rarity}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Empty state */}
      {cards.length === 0 && !isLoading && (
        <div className="text-center py-4 text-muted-foreground text-sm">
          No cards loaded. Tap "Update Card Database" to fetch cards.
        </div>
      )}
    </div>
  );
}
