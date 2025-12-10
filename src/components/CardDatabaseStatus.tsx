import { RefreshCw, Database, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCardDatabase } from '@/contexts/CardDatabaseContext';
import { toast } from 'sonner';
import { format } from 'date-fns';

export function CardDatabaseStatus() {
  const { cards, lastUpdated, isLoading, error, refreshCards } = useCardDatabase();

  const handleRefresh = async () => {
    try {
      await refreshCards();
      toast.success(`Card database updated. ${cards.length} cards loaded.`);
    } catch (e) {
      // Error is already handled in context
    }
  };

  return (
    <div className="p-4 rounded-lg bg-card border border-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Card Database</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {cards.length > 0 && (
            <>
              <CheckCircle className="w-3.5 h-3.5 text-green-500" />
              <span>{cards.length} cards</span>
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
    </div>
  );
}
