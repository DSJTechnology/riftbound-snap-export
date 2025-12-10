import { useMemo, useState } from 'react';
import { Camera, X, Loader2, ScanLine, AlertCircle, Search, Zap, ZapOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardData } from '@/data/cardDatabase';
import { useCardDatabase, createCardDatabaseHelpers, FuzzyMatchResult } from '@/contexts/CardDatabaseContext';
import { useAutoScanner } from '@/hooks/useAutoScanner';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface AutoCardScannerProps {
  onCardDetected: (card: CardData) => void;
  onScanFailed: () => void;
}

export function AutoCardScanner({ onCardDetected, onScanFailed }: AutoCardScannerProps) {
  const { cards } = useCardDatabase();
  const cardHelpers = useMemo(() => createCardDatabaseHelpers(cards), [cards]);
  const [suggestions, setSuggestions] = useState<FuzzyMatchResult[]>([]);
  const [rawOcrText, setRawOcrText] = useState<string>('');

  const handleCardConfirmed = (card: CardData, cardId: string) => {
    setSuggestions([]); // Clear suggestions
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

  const handleSuggestionsFound = (newSuggestions: FuzzyMatchResult[], rawText: string) => {
    setSuggestions(newSuggestions);
    setRawOcrText(rawText);
  };

  const handleSelectSuggestion = (card: CardData) => {
    setSuggestions([]);
    setRawOcrText('');
    handleCardConfirmed(card, card.cardId);
  };

  const handleDismissSuggestions = () => {
    setSuggestions([]);
    setRawOcrText('');
  };

  const {
    videoRef,
    canvasRef,
    isWorkerReady,
    isStreaming,
    isVideoReady,
    isScanning,
    autoScanEnabled,
    lastDetectedId,
    currentCandidate,
    lastOcrText,
    lastOcrConfidence,
    error,
    openCamera,
    closeCamera,
    toggleAutoScan,
    manualScan,
    handleVideoReady,
    handleVideoError,
  } = useAutoScanner({
    onCardConfirmed: handleCardConfirmed,
    onSuggestionsFound: handleSuggestionsFound,
    findCardById: cardHelpers.findCardById,
    fuzzyMatchCardId: cardHelpers.fuzzyMatchCardId,
  });

  return (
    <div className="space-y-4">
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

        {/* Hidden canvas for OCR processing */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Placeholder when camera is off */}
        {!isStreaming && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Camera className="w-16 h-16 opacity-30" />
            <span className="text-sm">Camera preview will appear here</span>
            <span className="text-xs opacity-60">{cards.length} cards in database</span>
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
            
            {/* Centered portrait card frame (2.5:3.5 aspect ratio) */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div 
                className={cn(
                  "relative bg-transparent border-2 rounded-lg transition-colors duration-300",
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
                
                {/* Instruction / Status text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  {currentCandidate ? (
                    <span className="text-sm bg-primary/90 px-3 py-1.5 rounded-full text-primary-foreground font-medium animate-pulse">
                      Detecting: {currentCandidate}
                    </span>
                  ) : (
                    <span className="text-sm bg-background/90 px-3 py-1.5 rounded-full text-foreground font-medium">
                      {autoScanEnabled ? 'Hold card steady' : 'Auto-scan paused'}
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

            {/* OCR Debug info (bottom) */}
            {lastOcrText && (
              <div className="absolute bottom-3 left-3 right-3 bg-black/90 px-3 py-2 rounded-lg text-xs text-white font-mono">
                <div className="flex justify-between items-center">
                  <span className="truncate">Detected: {lastOcrText}</span>
                  {lastOcrConfidence !== null && (
                    <span className={cn(
                      "ml-2 shrink-0 px-2 py-0.5 rounded",
                      lastOcrConfidence >= 70 ? "bg-green-500/30 text-green-300" :
                      lastOcrConfidence >= 50 ? "bg-yellow-500/30 text-yellow-300" :
                      "bg-red-500/30 text-red-300"
                    )}>
                      {lastOcrConfidence.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Suggestions Panel */}
      {suggestions.length > 0 && (
        <div className="p-4 rounded-lg bg-accent/50 border border-accent space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              No exact match for "{rawOcrText}". Did you mean:
            </p>
            <Button variant="ghost" size="sm" onClick={handleDismissSuggestions}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="grid gap-2">
            {suggestions.slice(0, 3).map((result) => (
              <Button
                key={result.card.cardId}
                variant="outline"
                className="justify-start h-auto py-2 px-3"
                onClick={() => handleSelectSuggestion(result.card)}
              >
                <div className="flex flex-col items-start text-left">
                  <span className="font-medium">{result.card.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {result.card.cardId} • {result.card.setName} • {Math.round(result.score * 100)}% match
                  </span>
                </div>
              </Button>
            ))}
          </div>
          <Button variant="link" size="sm" className="px-0" onClick={onScanFailed}>
            <Search className="w-4 h-4 mr-1" />
            Search manually instead
          </Button>
        </div>
      )}

      {/* Control Buttons */}
      <div className="flex gap-3">
        {!isStreaming ? (
          <Button
            onClick={openCamera}
            disabled={!isWorkerReady}
            className="flex-1 h-14 text-base font-semibold"
            size="lg"
          >
            {!isWorkerReady ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading OCR...
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

            {/* Manual scan button (backup) */}
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
      {lastDetectedId && !error && suggestions.length === 0 && (
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
      {isStreaming && isVideoReady && suggestions.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Place the card so the set code (e.g., OGN-001) is visible and hold still for 1-2 seconds
        </p>
      )}
    </div>
  );
}