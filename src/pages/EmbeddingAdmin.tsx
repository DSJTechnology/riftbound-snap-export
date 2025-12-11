import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, RefreshCw, CheckCircle2, XCircle, Play, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  loadEmbeddingModel,
  isModelLoaded,
  computeEmbeddingFromCanvas,
  EMBEDDING_SIZE,
} from '@/embedding/cnnEmbedding';
import { loadImage, drawCardToCanvas } from '@/embedding/preprocess';

interface CardInfo {
  card_id: string;
  name: string;
  art_url: string | null;
  has_embedding: boolean;
}

const EmbeddingAdmin = () => {
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [cards, setCards] = useState<CardInfo[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  
  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [currentCard, setCurrentCard] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  
  // Stats
  const totalCards = cards.length;
  const cardsWithEmbedding = cards.filter(c => c.has_embedding).length;
  const cardsMissingEmbedding = cards.filter(c => !c.has_embedding).length;
  
  // Load model on mount
  useEffect(() => {
    const loadModel = async () => {
      setLoadingModel(true);
      try {
        await loadEmbeddingModel();
        setModelLoaded(true);
      } catch (err) {
        console.error('Failed to load model:', err);
        toast.error('Failed to load embedding model');
      } finally {
        setLoadingModel(false);
      }
    };
    
    if (!isModelLoaded()) {
      loadModel();
    } else {
      setModelLoaded(true);
    }
  }, []);
  
  // Fetch cards from database
  const fetchCards = useCallback(async () => {
    setLoadingCards(true);
    try {
      const { data, error } = await supabase
        .from('riftbound_cards')
        .select('card_id, name, art_url, embedding')
        .order('card_id');
      
      if (error) throw error;
      
      const cardInfos: CardInfo[] = (data || []).map(row => ({
        card_id: row.card_id,
        name: row.name,
        art_url: row.art_url,
        has_embedding: row.embedding !== null && Array.isArray(row.embedding) && row.embedding.length === EMBEDDING_SIZE,
      }));
      
      setCards(cardInfos);
    } catch (err) {
      console.error('Failed to fetch cards:', err);
      toast.error('Failed to fetch cards');
    } finally {
      setLoadingCards(false);
    }
  }, []);
  
  useEffect(() => {
    fetchCards();
  }, [fetchCards]);
  
  // Process a single card
  const processCard = async (card: CardInfo): Promise<boolean> => {
    if (!card.art_url) {
      setErrors(prev => [...prev.slice(-9), `${card.card_id}: No art URL`]);
      return false;
    }
    
    try {
      // Load the image
      const image = await loadImage(card.art_url);
      
      // Preprocess (crop to art region, resize)
      const canvas = drawCardToCanvas(image, { useArtRegion: true });
      
      // Compute embedding
      const embedding = await computeEmbeddingFromCanvas(canvas);
      
      // Update database
      const { error } = await supabase
        .from('riftbound_cards')
        .update({ embedding, updated_at: new Date().toISOString() })
        .eq('card_id', card.card_id);
      
      if (error) {
        setErrors(prev => [...prev.slice(-9), `${card.card_id}: DB error - ${error.message}`]);
        return false;
      }
      
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrors(prev => [...prev.slice(-9), `${card.card_id}: ${msg}`]);
      return false;
    }
  };
  
  // Use refs for processing control (to avoid stale closure issues)
  const processingRef = useRef(false);
  const pausedRef = useRef(false);

  // Rebuild embeddings
  const rebuildEmbeddings = async (onlyMissing: boolean) => {
    if (!modelLoaded) {
      toast.error('Model not loaded yet');
      return;
    }
    
    const cardsToProcess = onlyMissing
      ? cards.filter(c => !c.has_embedding && c.art_url)
      : cards.filter(c => c.art_url);
    
    console.log('[EmbeddingAdmin] Cards to process:', cardsToProcess.length);
    
    if (cardsToProcess.length === 0) {
      toast.info('No cards to process');
      return;
    }
    
    setIsProcessing(true);
    processingRef.current = true;
    setIsPaused(false);
    pausedRef.current = false;
    setProcessedCount(0);
    setFailedCount(0);
    setErrors([]);
    
    let processed = 0;
    let failed = 0;
    
    for (const card of cardsToProcess) {
      // Check if paused using ref
      while (pausedRef.current && processingRef.current) {
        await new Promise(r => setTimeout(r, 100));
      }
      
      if (!processingRef.current) break;
      
      setCurrentCard(card.card_id);
      
      const success = await processCard(card);
      if (success) {
        processed++;
      } else {
        failed++;
      }
      
      setProcessedCount(processed);
      setFailedCount(failed);
      
      // Small delay to avoid overwhelming
      await new Promise(r => setTimeout(r, 50));
    }
    
    setIsProcessing(false);
    processingRef.current = false;
    setCurrentCard(null);
    
    // Refresh card list
    await fetchCards();
    
    toast.success(`Processed ${processed} cards, ${failed} failed`);
  };
  
  const stopProcessing = () => {
    processingRef.current = false;
    setIsProcessing(false);
    setIsPaused(false);
    pausedRef.current = false;
  };
  
  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setIsPaused(pausedRef.current);
  };
  
  const progressPercent = totalCards > 0
    ? ((processedCount + failedCount) / (isProcessing ? cards.filter(c => !c.has_embedding).length || totalCards : totalCards)) * 100
    : 0;
  
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="container py-3 px-4">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-lg font-bold text-gradient">Embedding Admin</h1>
              <p className="text-xs text-muted-foreground">Rebuild CNN embeddings for all cards</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 container px-4 py-6 space-y-6">
        {/* Model Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Model Status</CardTitle>
            <CardDescription>MobileNet v2 for feature extraction</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              {loadingModel ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-sm">Loading model...</span>
                </>
              ) : modelLoaded ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-green-400">Model loaded and ready</span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-red-500" />
                  <span className="text-sm text-red-400">Model not loaded</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Card Stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Card Database</CardTitle>
            <CardDescription>Embedding status for all cards</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingCards ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Loading cards...</span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-3 rounded-lg bg-muted/30 text-center">
                    <p className="text-2xl font-bold">{totalCards}</p>
                    <p className="text-xs text-muted-foreground">Total Cards</p>
                  </div>
                  <div className="p-3 rounded-lg bg-green-500/10 text-center">
                    <p className="text-2xl font-bold text-green-400">{cardsWithEmbedding}</p>
                    <p className="text-xs text-muted-foreground">With Embedding</p>
                  </div>
                  <div className="p-3 rounded-lg bg-orange-500/10 text-center">
                    <p className="text-2xl font-bold text-orange-400">{cardsMissingEmbedding}</p>
                    <p className="text-xs text-muted-foreground">Missing</p>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchCards}
                    disabled={loadingCards}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Processing Controls */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rebuild Embeddings</CardTitle>
            <CardDescription>Compute CNN embeddings from card art</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isProcessing ? (
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={() => rebuildEmbeddings(true)}
                  disabled={!modelLoaded || loadingCards || cardsMissingEmbedding === 0}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Rebuild Missing ({cardsMissingEmbedding})
                </Button>
                <Button
                  variant="outline"
                  onClick={() => rebuildEmbeddings(false)}
                  disabled={!modelLoaded || loadingCards || totalCards === 0}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Rebuild All ({totalCards})
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Progress */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Processing: {currentCard || '...'}</span>
                    <span>{processedCount + failedCount} / {cardsMissingEmbedding || totalCards}</span>
                  </div>
                  <Progress value={progressPercent} />
                </div>
                
                {/* Stats */}
                <div className="flex gap-4 text-sm">
                  <span className="text-green-400">✓ {processedCount} processed</span>
                  {failedCount > 0 && (
                    <span className="text-red-400">✗ {failedCount} failed</span>
                  )}
                </div>
                
                {/* Controls */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={togglePause}
                  >
                    {isPaused ? (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Resume
                      </>
                    ) : (
                      <>
                        <Pause className="w-4 h-4 mr-2" />
                        Pause
                      </>
                    )}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={stopProcessing}
                  >
                    Stop
                  </Button>
                </div>
              </div>
            )}
            
            {/* Errors */}
            {errors.length > 0 && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-xs font-medium text-red-400 mb-2">Recent Errors:</p>
                <div className="space-y-1">
                  {errors.slice(-5).map((err, i) => (
                    <p key={i} className="text-xs text-muted-foreground font-mono">{err}</p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">How It Works</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>1. Each card's DotGG art URL is loaded as an image.</p>
            <p>2. The art region is cropped and resized to 224×224.</p>
            <p>3. MobileNet v2 extracts a feature vector (truncated to 256 dimensions).</p>
            <p>4. The embedding is L2-normalized and saved to the database.</p>
            <p className="text-xs pt-2 border-t border-border">
              Note: This replaces the previous handcrafted feature embeddings with CNN-based ones.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default EmbeddingAdmin;
