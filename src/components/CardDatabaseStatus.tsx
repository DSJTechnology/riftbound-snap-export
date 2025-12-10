import { RefreshCw, Database, CheckCircle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCardDatabase, createCardDatabaseHelpers } from '@/contexts/CardDatabaseContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useState, useMemo } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

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

  // Group cards by set
  const cardsBySet = useMemo(() => {
    const grouped: Record<string, number> = {};
    cards.forEach(card => {
      const set = card.setName || 'Unknown Set';
      grouped[set] = (grouped[set] || 0) + 1;
    });
    // Sort by set name
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
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

      {/* Cards by Set */}
      {cards.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">Cards by Set</h4>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {cardsBySet.map(([setName, count]) => (
              <div
                key={setName}
                className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/50 text-sm"
              >
                <span className="text-foreground truncate">{setName}</span>
                <span className="text-muted-foreground font-mono text-xs ml-2 shrink-0">
                  {count} cards
                </span>
              </div>
            ))}
          </div>
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
