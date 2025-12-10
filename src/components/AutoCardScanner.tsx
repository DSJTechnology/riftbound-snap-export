import { useMemo, useState } from 'react';
import { Camera, X, Loader2, ScanLine, AlertCircle, Search, Zap, ZapOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardData } from '@/data/cardDatabase';
import { useCardDatabase } from '@/contexts/CardDatabaseContext';
import { useImageScanner, CardWithHash } from '@/hooks/useImageScanner';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Progress } from '@/components/ui/progress';

interface AutoCardScannerProps {
  onCardDetected: (card: CardData) => void;
  onScanFailed: () => void;
}

export function AutoCardScanner({ onCardDetected, onScanFailed }: AutoCardScannerProps) {
  const { cards } = useCardDatabase();

  const handleCardConfirmed = (card: CardData, cardId: string) => {
    onCardDetected(card);
    
    // Show toast with undo option
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

    // Vibration feedback if available
    if ('vibrate' in navigator) {
      navigator.vibrate(100);
    }
  };

  const handleSelectCard = (cardWithHash: CardWithHash) => {
    const cardData: CardData = {
      cardId: cardWithHash.cardId,
      name: cardWithHash.name,
      setName: cardWithHash.setName || 'Unknown',
      rarity: cardWithHash.rarity,
    };
    handleCardConfirmed(cardData, cardWithHash.cardId);
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
    lastHash,
    bestMatch,
    bestDistance,
    matchCandidates,
    indexProgress,
    error,
    openCamera,
    closeCamera,
    toggleAutoScan,
    manualScan,
    handleVideoReady,
    handleVideoError,
  } = useImageScanner({
    cards,
    onCardConfirmed: handleCardConfirmed,
  });

  // Get match quality
  const getMatchQuality = (distance: number | null): 'excellent' | 'good' | 'fair' | 'poor' | 'none' => {
    if (distance === null) return 'none';
    if (distance <= 8) return 'excellent';
    if (distance <= 12) return 'good';
    if (distance <= 18) return 'fair';
    return 'poor';
  };

  const matchQuality = getMatchQuality(bestDistance);

  return (
    <div className="space-y-4">
      {/* Index loading progress */}
      {!isIndexReady && cards.length > 0 && (
        <div className="p-4 rounded-lg bg-accent/50 border border-accent space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Loading card images...</span>
            <span className="text-muted-foreground">
              {indexProgress.loaded} / {indexProgress.total}
            </span>
          </div>
          <Progress value={(indexProgress.loaded / Math.max(indexProgress.total, 1)) * 100} />
          <p className="text-xs text-muted-foreground">
            First load may take a moment as we download and hash card art from dotGG
          </p>
        </div>
      )}

      {/* Camera Preview Area */}
      <div 
        className={cn(
          "relative w-full overflow-hidden rounded-xl border-2",
          isStreaming ? "border-primary/50" : "border-dashed border-border",
          "bg-black"
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
              <span className="text-xs text-primary">Image index ready</span>
            )}
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
                {autoScanEnabled && (
                  <div className="absolute inset-0 overflow-hidden rounded-lg">
                    <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-scan-line" />
                  </div>
                )}
                
                {/* Status text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  {bestMatch && bestDistance !== null && bestDistance <= 18 ? (
                    <span className={cn(
                      "text-sm px-3 py-1.5 rounded-full font-medium",
                      matchQuality === 'excellent' ? "bg-green-500/90 text-white" :
                      matchQuality === 'good' ? "bg-green-400/90 text-white" :
                      "bg-yellow-500/90 text-black"
                    )}>
                      {bestMatch.name}
                    </span>
                  ) : (
                    <span className="text-sm bg-background/90 px-3 py-1.5 rounded-full text-foreground font-medium">
                      {autoScanEnabled ? 'Position card art in frame' : 'Auto-scan paused'}
                    </span>
                  )}
                </div>
              </div>
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
              {/* Best match display */}
              {bestMatch && bestDistance !== null ? (
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
                  No match yet - position card in frame
                </div>
              )}
              
              {/* Distance/confidence indicator */}
              {bestDistance !== null && (
                <div className="flex justify-between items-center text-white/70 font-mono">
                  <span>Distance: {bestDistance} / 64</span>
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

              {/* Top candidates for manual selection (when match is not excellent) */}
              {matchCandidates.length > 0 && matchQuality !== 'excellent' && (
                <div className="mt-1 pt-1 border-t border-white/20">
                  <span className="text-white/60">Tap to select:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {matchCandidates.slice(0, 4).map((result) => (
                      <button
                        key={result.card.cardId}
                        onClick={() => handleSelectCard(result.card)}
                        className={cn(
                          "text-xs px-2 py-0.5 rounded",
                          result.distance <= 10 ? "bg-green-500/30 hover:bg-green-500/50 text-green-200" :
                          result.distance <= 15 ? "bg-yellow-500/30 hover:bg-yellow-500/50 text-yellow-200" :
                          "bg-primary/30 hover:bg-primary/50 text-primary-foreground"
                        )}
                      >
                        {result.card.name} ({result.distance})
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
                Loading index... ({indexProgress.loaded}/{indexProgress.total})
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
            
            {/* Auto-scan toggle */}
            <Button
              onClick={toggleAutoScan}
              variant={autoScanEnabled ? "default" : "outline"}
              className="h-14 flex-1"
              size="lg"
            >
              {autoScanEnabled ? (
                <>
                  <Zap className="w-5 h-5 mr-2" />
                  Auto-Scan ON
                </>
              ) : (
                <>
                  <ZapOff className="w-5 h-5 mr-2" />
                  Auto-Scan OFF
                </>
              )}
            </Button>

            {/* Manual scan button */}
            <Button
              onClick={manualScan}
              disabled={isScanning || !isVideoReady}
              variant="outline"
              className="h-14"
              size="lg"
              title="Manual Scan"
            >
              {isScanning ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <ScanLine className="w-5 h-5" />
              )}
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
          Position the card art within the frame. Lower distance = better match.
        </p>
      )}
    </div>
  );
}
