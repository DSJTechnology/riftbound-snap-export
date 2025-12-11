import { useMemo } from 'react';
import { Camera, X, Loader2, ScanLine, AlertCircle, Search, Zap, ZapOff, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardData } from '@/data/cardDatabase';
import { useCardDatabase } from '@/contexts/CardDatabaseContext';
import { useEmbeddingScanner, EmbeddedCard } from '@/hooks/useEmbeddingScanner';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Progress } from '@/components/ui/progress';
import { SIMILARITY_THRESHOLDS } from '@/utils/embeddingConfig';

interface AutoCardScannerProps {
  onCardDetected: (card: CardData) => void;
  onScanFailed: () => void;
}

export function AutoCardScanner({ onCardDetected, onScanFailed }: AutoCardScannerProps) {
  const { cards } = useCardDatabase();

  const handleCardConfirmed = (card: CardData, cardId: string) => {
    onCardDetected(card);
    
    toast.success(
      `Added ${card.name} (${cardId})`,
      {
        action: {
          label: 'Undo',
          onClick: () => {
            toast.info('Use the collection list to adjust quantities');
          },
        },
        duration: 3000,
      }
    );

    if ('vibrate' in navigator) {
      navigator.vibrate(100);
    }
  };

  const {
    videoRef,
    canvasRef,
    isIndexReady,
    isStreaming,
    isVideoReady,
    isScanning,
    autoScanEnabled,
    lastDetectedId,
    bestMatch,
    bestScore,
    matchCandidates,
    indexProgress,
    error,
    pendingMatch,
    recentScans,
    qualityIssues,
    opencvReady,
    openCamera,
    closeCamera,
    toggleAutoScan,
    manualScan,
    handleVideoReady,
    handleVideoError,
    confirmPendingMatch,
    selectCandidate,
    cancelPendingMatch,
  } = useEmbeddingScanner({
    onCardConfirmed: handleCardConfirmed,
  });

  // Get match quality based on cosine similarity score
  const getMatchQuality = (score: number | null): 'excellent' | 'good' | 'fair' | 'poor' | 'none' => {
    if (score === null) return 'none';
    if (score >= SIMILARITY_THRESHOLDS.EXCELLENT) return 'excellent';
    if (score >= SIMILARITY_THRESHOLDS.GOOD) return 'good';
    if (score >= SIMILARITY_THRESHOLDS.FAIR) return 'fair';
    return 'poor';
  };

  const matchQuality = getMatchQuality(bestScore);

  return (
    <div className="space-y-4">
      {/* Index loading progress */}
      {!isIndexReady && cards.length > 0 && (
        <div className="p-4 rounded-lg bg-accent/50 border border-accent space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Loading card embeddings...</span>
            <span className="text-muted-foreground">
              {indexProgress.loaded} / {indexProgress.total}
            </span>
          </div>
          <Progress value={(indexProgress.loaded / Math.max(indexProgress.total, 1)) * 100} />
          <p className="text-xs text-muted-foreground">
            Loading precomputed embeddings from database.
          </p>
        </div>
      )}

      {/* No embeddings warning */}
      {isIndexReady && indexProgress.total === 0 && (
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 space-y-2">
          <div className="flex items-center gap-2 text-sm text-yellow-600">
            <AlertCircle className="w-4 h-4" />
            <span className="font-medium">No card embeddings found</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Please run "Sync Cards from dotGG" in Settings to compute embeddings.
          </p>
        </div>
      )}

      {/* Camera Preview Area */}
      <div 
        className={cn(
          "relative w-full overflow-hidden rounded-xl border-2",
          isStreaming ? "border-primary/50" : "border-dashed border-border",
          "bg-black",
          "max-h-[60vh] md:max-h-[50vh]"
        )}
        style={{ aspectRatio: '3/4' }}
      >
        {/* Video element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={handleVideoReady}
          onLoadedData={handleVideoReady}
          onCanPlay={handleVideoReady}
          onPlay={handleVideoReady}
          onError={handleVideoError}
          className={cn(
            "absolute inset-0 w-full h-full object-cover",
            !isStreaming && "hidden"
          )}
        />

        {/* Hidden canvas for image processing */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Placeholder when camera is off */}
        {!isStreaming && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Camera className="w-16 h-16 opacity-30" />
            <span className="text-sm">Camera preview will appear here</span>
            <span className="text-xs opacity-60">{cards.length} cards in database</span>
            {isIndexReady && (
              <span className="text-xs text-primary">Embeddings ready ({indexProgress.total} cards)</span>
            )}
            <span className="text-xs opacity-60">
              OpenCV: {opencvReady ? '✓ Ready' : 'Loading...'}
            </span>
          </div>
        )}

        {/* Loading overlay while video initializes */}
        {isStreaming && !isVideoReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-10">
            <Loader2 className="w-10 h-10 animate-spin text-primary mb-2" />
            <span className="text-sm text-muted-foreground">Starting camera...</span>
          </div>
        )}

        {/* Scanning overlay - only show when video is ready */}
        {isStreaming && isVideoReady && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Dark overlay outside scan area */}
            <div className="absolute inset-0 bg-black/40" />
            
            {/* Centered card frame for art alignment */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div 
                className={cn(
                  "relative bg-transparent border-2 rounded-lg transition-colors duration-300",
                  qualityIssues.length > 0 ? "border-yellow-500" :
                  matchQuality === 'excellent' ? "border-green-500" :
                  matchQuality === 'good' ? "border-green-400" :
                  matchQuality === 'fair' ? "border-yellow-500" :
                  isScanning ? "border-primary animate-pulse" : "border-primary/70",
                  "shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"
                )}
                style={{ aspectRatio: '2.5/3.5', height: '70%' }}
              >
                {/* Corner markers */}
                <div className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-3 border-l-3 border-primary rounded-tl-lg" />
                <div className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-3 border-r-3 border-primary rounded-tr-lg" />
                <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-3 border-l-3 border-primary rounded-bl-lg" />
                <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-3 border-r-3 border-primary rounded-br-lg" />
                
                {/* Scanning indicator */}
                {autoScanEnabled && qualityIssues.length === 0 && (
                  <div className="absolute inset-0 overflow-hidden rounded-lg">
                    <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-scan-line" />
                  </div>
                )}
                
                {/* Status text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  {qualityIssues.length > 0 ? (
                    <div className="text-sm bg-yellow-500/90 px-3 py-1.5 rounded-full text-black font-medium flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      {qualityIssues[0]}
                    </div>
                  ) : bestMatch ? (
                    <span className={cn(
                      "text-sm px-3 py-1.5 rounded-full font-medium",
                      matchQuality === 'excellent' ? "bg-green-500/90 text-white" :
                      matchQuality === 'good' ? "bg-green-400/90 text-white" :
                      matchQuality === 'fair' ? "bg-yellow-500/90 text-black" :
                      "bg-red-500/90 text-white"
                    )}>
                      {bestMatch.name}
                    </span>
                  ) : (
                    <span className="text-sm bg-background/90 px-3 py-1.5 rounded-full text-foreground font-medium">
                      {autoScanEnabled ? 'Align card art in frame' : 'Auto-scan paused'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Alignment hint */}
            <div className="absolute top-3 left-3 bg-background/90 px-3 py-1.5 rounded-full text-xs text-foreground">
              Align card art inside the box
            </div>

            {/* Auto-scan status indicator */}
            <div className="absolute top-3 right-3 flex items-center gap-2 bg-background/90 px-3 py-1.5 rounded-full">
              {autoScanEnabled ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs font-medium text-foreground">Scanning</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Paused</span>
                </>
              )}
            </div>

            {/* Match info panel (bottom) */}
            <div className="absolute bottom-3 left-3 right-3 bg-black/90 px-3 py-2 rounded-lg text-xs space-y-1 pointer-events-auto">
              {bestMatch && bestScore !== null ? (
                <div className={cn(
                  "font-semibold",
                  matchQuality === 'excellent' ? "text-green-400" :
                  matchQuality === 'good' ? "text-green-300" :
                  matchQuality === 'fair' ? "text-yellow-400" :
                  "text-red-400"
                )}>
                  {matchQuality === 'excellent' || matchQuality === 'good' ? '✓ ' : '? '}
                  {bestMatch.name} ({bestMatch.cardId})
                  {bestMatch.setName && <span className="text-white/60 ml-1">– {bestMatch.setName}</span>}
                </div>
              ) : (
                <div className="text-white/60">
                  {qualityIssues.length > 0 ? 'Adjust image and try again' : 'Searching for match...'}
                </div>
              )}
              
              {/* Similarity score indicator */}
              {bestScore !== null && (
                <div className="flex justify-between items-center text-white/70 font-mono">
                  <span>Similarity: {(bestScore * 100).toFixed(1)}%</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded",
                    matchQuality === 'excellent' ? "bg-green-500/30 text-green-300" :
                    matchQuality === 'good' ? "bg-green-400/30 text-green-300" :
                    matchQuality === 'fair' ? "bg-yellow-500/30 text-yellow-300" :
                    "bg-red-500/30 text-red-300"
                  )}>
                    {matchQuality === 'excellent' ? 'Excellent' :
                     matchQuality === 'good' ? 'Good' :
                     matchQuality === 'fair' ? 'Fair' : 'Poor'}
                  </span>
                </div>
              )}

              {/* Alternative candidates */}
              {matchCandidates.length > 1 && (
                <div className="mt-1 pt-1 border-t border-white/20">
                  <span className="text-white/60">Did you mean:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {matchCandidates.slice(1, 4).map((result) => (
                      <button
                        key={result.card.cardId}
                        onClick={() => {
                          const cardData: CardData = {
                            cardId: result.card.cardId,
                            name: result.card.name,
                            setName: result.card.setName || 'Unknown',
                            rarity: result.card.rarity,
                          };
                          handleCardConfirmed(cardData, result.card.cardId);
                        }}
                        className={cn(
                          "text-xs px-2 py-0.5 rounded",
                          result.score >= SIMILARITY_THRESHOLDS.GOOD ? "bg-green-500/30 hover:bg-green-500/50 text-green-200" :
                          result.score >= SIMILARITY_THRESHOLDS.FAIR ? "bg-yellow-500/30 hover:bg-yellow-500/50 text-yellow-200" :
                          "bg-primary/30 hover:bg-primary/50 text-primary-foreground"
                        )}
                      >
                        {result.card.name} ({(result.score * 100).toFixed(0)}%)
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Control Buttons */}
      <div className="flex gap-3">
        {!isStreaming ? (
          <Button
            onClick={openCamera}
            disabled={!isIndexReady}
            className="flex-1 h-14 text-base font-semibold"
            size="lg"
          >
            {!isIndexReady ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading embeddings... ({indexProgress.loaded}/{indexProgress.total})
              </>
            ) : (
              <>
                <Camera className="w-5 h-5 mr-2" />
                Open Camera
              </>
            )}
          </Button>
        ) : (
          <>
            <Button
              onClick={closeCamera}
              variant="outline"
              className="h-14"
              size="lg"
            >
              <X className="w-5 h-5" />
            </Button>
            
            <Button
              onClick={toggleAutoScan}
              variant={autoScanEnabled ? "default" : "outline"}
              className="h-14 flex-1"
              size="lg"
            >
              {autoScanEnabled ? (
                <>
                  <Zap className="w-5 h-5 mr-2" />
                  Auto ON
                </>
              ) : (
                <>
                  <ZapOff className="w-5 h-5 mr-2" />
                  Auto OFF
                </>
              )}
            </Button>

            <Button
              onClick={() => {
                console.log('[AutoCardScanner] Manual scan clicked');
                manualScan();
              }}
              disabled={isScanning || !isVideoReady || !isIndexReady}
              variant="secondary"
              className="h-14 flex-1"
              size="lg"
            >
              {isScanning ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
              ) : (
                <ScanLine className="w-5 h-5 mr-2" />
              )}
              Scan
            </Button>
          </>
        )}
      </div>

      {/* Last detected ID feedback */}
      {lastDetectedId && !error && (
        <div className="text-center p-3 rounded-lg bg-primary/10 border border-primary/20">
          <p className="text-sm text-muted-foreground">
            Last added: <span className="font-mono text-primary font-bold">{lastDetectedId}</span>
          </p>
        </div>
      )}

      {/* Error message with manual search fallback */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="link"
              size="sm"
              className="px-0 h-auto mt-2 text-primary"
              onClick={onScanFailed}
            >
              <Search className="w-4 h-4 mr-1" />
              Search Manually
            </Button>
          </div>
        </div>
      )}

      {/* Helper text */}
      {isStreaming && isVideoReady && (
        <p className="text-center text-xs text-muted-foreground">
          Position the card art within the frame. Higher similarity = better match.
        </p>
      )}

      {/* Confirmation Modal with Top-K Candidates */}
      {pendingMatch && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 z-50">
          <div className="bg-card rounded-xl p-4 max-w-md w-full mx-4 border border-border shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-3 text-foreground">Confirm Card</h2>
            
            {/* Selected card */}
            <div className="flex gap-4 mb-4">
              <img
                src={pendingMatch.card.artUrl}
                alt={pendingMatch.card.name}
                className="w-28 h-auto rounded-lg shadow-md ring-2 ring-primary"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/placeholder.svg';
                }}
              />
              <div className="flex-1 text-sm space-y-1">
                <div className="font-semibold text-foreground text-base">
                  {pendingMatch.card.name}
                </div>
                <div className="text-muted-foreground font-mono">
                  {pendingMatch.card.cardId}
                </div>
                {pendingMatch.card.setName && (
                  <div className="text-muted-foreground">
                    Set: {pendingMatch.card.setName}
                  </div>
                )}
                <div className={cn(
                  "text-xs mt-2 px-2 py-1 rounded inline-block",
                  pendingMatch.score >= SIMILARITY_THRESHOLDS.EXCELLENT ? "bg-green-500/20 text-green-400" :
                  pendingMatch.score >= SIMILARITY_THRESHOLDS.GOOD ? "bg-green-400/20 text-green-300" :
                  pendingMatch.score >= SIMILARITY_THRESHOLDS.FAIR ? "bg-yellow-500/20 text-yellow-400" :
                  "bg-red-500/20 text-red-400"
                )}>
                  Similarity: {(pendingMatch.score * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Other candidates */}
            {pendingMatch.candidates.length > 1 && (
              <div className="mb-4">
                <p className="text-sm text-muted-foreground mb-2">Not the right card? Select another:</p>
                <div className="grid grid-cols-3 gap-2">
                  {pendingMatch.candidates.slice(1, 4).map((candidate) => (
                    <button
                      key={candidate.card.cardId}
                      onClick={() => selectCandidate(candidate.card, candidate.score)}
                      className={cn(
                        "p-2 rounded-lg border transition-all",
                        candidate.card.cardId === pendingMatch.card.cardId
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/50 hover:bg-accent/50"
                      )}
                    >
                      <img
                        src={candidate.card.artUrl}
                        alt={candidate.card.name}
                        className="w-full aspect-[2.5/3.5] object-cover rounded mb-1"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/placeholder.svg';
                        }}
                      />
                      <div className="text-xs truncate font-medium">{candidate.card.name}</div>
                      <div className={cn(
                        "text-xs",
                        candidate.score >= SIMILARITY_THRESHOLDS.GOOD ? "text-green-400" :
                        candidate.score >= SIMILARITY_THRESHOLDS.FAIR ? "text-yellow-400" :
                        "text-muted-foreground"
                      )}>
                        {(candidate.score * 100).toFixed(0)}%
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={cancelPendingMatch}
              >
                Cancel
              </Button>
              <Button
                onClick={() => confirmPendingMatch()}
                className="gap-2"
              >
                <Check className="w-4 h-4" />
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Recently Scanned Cards */}
      {recentScans.length > 0 && (
        <div className="space-y-2 mt-4">
          <h3 className="text-sm font-semibold text-foreground">Recently scanned</h3>
          <div className="grid gap-2">
            {recentScans.map((scan, index) => (
              <div
                key={`${scan.card.cardId}-${scan.timestamp}`}
                className="flex items-center gap-3 p-2 rounded-lg bg-accent/50 border border-border"
              >
                <img
                  src={scan.card.artUrl}
                  alt={scan.card.name}
                  className="w-10 h-14 object-cover rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/placeholder.svg';
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-foreground truncate">
                    {scan.card.name}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {scan.card.cardId}
                  </div>
                  {scan.card.setName && (
                    <div className="text-xs text-muted-foreground">
                      {scan.card.setName}
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(scan.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
