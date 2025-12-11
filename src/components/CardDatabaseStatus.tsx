import { RefreshCw, Database, CheckCircle, AlertCircle, ChevronDown, ChevronRight, Hash, Loader2, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCardDatabase } from '@/contexts/CardDatabaseContext';
import { useCardHashes } from '@/contexts/CardHashContext';
import { useCardEmbeddings } from '@/contexts/CardEmbeddingContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useState, useMemo } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';

export function CardDatabaseStatus() {
  const { cards, lastUpdated, isLoading, error } = useCardDatabase();
  const { cardIndex, isIndexReady, error: hashError, refreshIndex } = useCardHashes();
  const { cards: embeddedCards, loaded: embeddingsLoaded, error: embeddingError, refreshEmbeddings } = useCardEmbeddings();
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ processed: number; total: number } | null>(null);
  const [syncingSet, setSyncingSet] = useState<string | null>(null);
  const [syncingCard, setSyncingCard] = useState<string | null>(null);

  const handleSyncCards = async (setName?: string, cardId?: string) => {
    setIsSyncing(true);
    setSyncProgress(null);
    if (setName) setSyncingSet(setName);
    if (cardId) setSyncingCard(cardId);
    
    try {
      const label = cardId ? `card ${cardId}` : setName ? `set "${setName}"` : 'all cards';
      toast.info(`Syncing ${label}...`);
      
      let offset = 0;
      let totalProcessed = 0;
      let totalFailed = 0;
      let totalCards = 0;
      let hasMore = true;
      
      while (hasMore) {
        const { data, error } = await supabase.functions.invoke('sync-riftbound-cards', {
          body: { offset, setName, cardId }
        });
        
        if (error) {
          throw new Error(error.message);
        }
        
        if (!data?.success) {
          throw new Error(data?.error || 'Sync failed');
        }
        
        totalProcessed += data.processed || 0;
        totalFailed += data.failed || 0;
        totalCards = data.total || totalCards;
        hasMore = data.hasMore || false;
        offset = data.nextOffset || 0;
        
        setSyncProgress({ processed: totalProcessed, total: totalCards });
        
        console.log(`[Sync] Progress: ${totalProcessed}/${totalCards} (offset: ${offset}, hasMore: ${hasMore})`);
      }
      
      toast.success(`Synced ${totalProcessed} cards (${totalFailed} failed)`);
      await Promise.all([refreshIndex(), refreshEmbeddings()]);
    } catch (err) {
      console.error('Sync error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to sync cards');
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
      setSyncingSet(null);
      setSyncingCard(null);
    }
  };

  // Group cards by set with full card data
  const cardsBySet = useMemo(() => {
    const grouped: Record<string, typeof cardIndex> = {};
    cardIndex.forEach(card => {
      const set = card.setName || card.set || 'Unknown Set';
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
  }, [cardIndex]);

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
    <div className="space-y-4">
      {/* Card Database Section */}
      <div className="p-4 rounded-lg bg-card border border-border space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Card Database</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {isIndexReady && cardIndex.length > 0 ? (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                <span className="text-muted-foreground">{cardIndex.length} cards</span>
              </>
            ) : isIndexReady ? (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-yellow-500" />
                <span className="text-yellow-500">No cards</span>
              </>
            ) : (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                <span className="text-muted-foreground">Loading...</span>
              </>
            )}
          </div>
        </div>

        {/* Error message */}
        {(error || hashError) && (
          <div className="flex items-start gap-2 p-2 rounded bg-destructive/10 border border-destructive/20">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">{error || hashError}</p>
          </div>
        )}

        {/* Sync All button */}
        <Button
          onClick={() => handleSyncCards()}
          disabled={isSyncing}
          variant="default"
          size="sm"
          className="w-full"
        >
          {isSyncing && !syncingSet && !syncingCard ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {syncProgress 
                ? `Syncing... ${syncProgress.processed}/${syncProgress.total}`
                : 'Starting sync...'
              }
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Sync All Cards
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground">
          Downloads all card images and computes recognition embeddings. Use the set-level sync buttons below for faster partial updates.
        </p>

        {/* Embedding status */}
        {embeddingsLoaded && (
          <div className="flex items-center gap-2 p-2 rounded bg-primary/10 border border-primary/20">
            <Brain className="w-4 h-4 text-primary" />
            <span className="text-xs text-foreground">
              {embeddedCards.length} cards with AI embeddings ready
            </span>
          </div>
        )}

        {/* Cards by Set - Expandable */}
        {cardIndex.length > 0 && (
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
                    <div className="flex items-center gap-1">
                      <CollapsibleTrigger className="flex items-center justify-between flex-1 px-3 py-2 rounded-md bg-muted/50 hover:bg-muted transition-colors text-sm">
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        disabled={isSyncing}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSyncCards(setName);
                        }}
                        title={`Sync ${setName}`}
                      >
                        {isSyncing && syncingSet === setName ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                    <CollapsibleContent>
                      <div className="ml-6 mt-1 space-y-0.5 max-h-48 overflow-y-auto">
                        {setCards.map(card => (
                          <div
                            key={card.cardId}
                            className="flex items-center justify-between px-2 py-1.5 text-xs rounded hover:bg-muted/30 group"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-primary shrink-0">{card.cardId}</span>
                              <span className="text-foreground truncate">{card.name}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                              {card.rarity && (
                                <span className="text-muted-foreground text-[10px]">
                                  {card.rarity}
                                </span>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                disabled={isSyncing}
                                onClick={() => handleSyncCards(undefined, card.cardId)}
                                title={`Refresh ${card.cardId}`}
                              >
                                {isSyncing && syncingCard === card.cardId ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-3 h-3" />
                                )}
                              </Button>
                            </div>
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
        {cardIndex.length === 0 && isIndexReady && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            No cards synced yet. Tap "Sync Cards from dotGG" to download the card database.
          </div>
        )}
      </div>

      {/* Scanner Index Info */}
      <div className="p-4 rounded-lg bg-card border border-border space-y-3">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Scanner Index</span>
        </div>
        
        <div className="text-xs text-muted-foreground space-y-2">
          <p>
            Card images and AI embeddings are stored in Lovable Cloud. No local files needed!
          </p>
          <p>
            The "Sync Cards" button fetches all cards from dotGG, downloads their artwork, computes 256-dimensional feature embeddings for AI-powered recognition, and stores everything in the cloud database.
          </p>
        </div>
      </div>
    </div>
  );
}
