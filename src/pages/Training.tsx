import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search, Image, Loader2, Check, X, Download, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCardDatabase } from '@/contexts/CardDatabaseContext';
import { CardData } from '@/data/cardDatabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  searchWebImages,
  confirmWebImages,
  getTrainingImages,
  WebImageResult,
  TrainingImage,
  TrainingStats,
} from '@/services/trainingService';

const Training = () => {
  const { cards } = useCardDatabase();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Web image search state
  const [webImages, setWebImages] = useState<WebImageResult[]>([]);
  const [selectedWebImages, setSelectedWebImages] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Existing training images
  const [trainingImages, setTrainingImages] = useState<TrainingImage[]>([]);
  const [trainingStats, setTrainingStats] = useState<TrainingStats | null>(null);
  const [isLoadingImages, setIsLoadingImages] = useState(false);

  // Filter card suggestions
  const suggestions = searchQuery.length >= 2
    ? cards
        .filter(card => 
          card.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          card.cardId.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .slice(0, 10)
    : [];

  // Load training images for selected card
  useEffect(() => {
    if (selectedCard) {
      loadTrainingImages(selectedCard.cardId);
    }
  }, [selectedCard]);

  // Load global stats on mount
  useEffect(() => {
    loadGlobalStats();
  }, []);

  const loadGlobalStats = async () => {
    const result = await getTrainingImages({ limit: 1 });
    if (result.stats) {
      setTrainingStats(result.stats);
    }
  };

  const loadTrainingImages = async (cardId: string) => {
    setIsLoadingImages(true);
    const result = await getTrainingImages({ cardId, limit: 50 });
    setTrainingImages(result.images);
    setIsLoadingImages(false);
  };

  const handleCardSelect = (card: CardData) => {
    setSelectedCard(card);
    setSearchQuery(card.name);
    setShowSuggestions(false);
    setWebImages([]);
    setSelectedWebImages(new Set());
    setSearchError(null);
  };

  const handleSearchWebImages = async () => {
    if (!selectedCard) return;

    setIsSearching(true);
    setSearchError(null);
    setWebImages([]);
    setSelectedWebImages(new Set());

    const result = await searchWebImages(selectedCard.cardId, selectedCard.name);

    if (result.error) {
      setSearchError(result.error);
    } else {
      setWebImages(result.results);
    }

    setIsSearching(false);
  };

  const toggleImageSelection = (url: string) => {
    setSelectedWebImages(prev => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const handleSaveSelected = async () => {
    if (!selectedCard || selectedWebImages.size === 0) return;

    setIsSaving(true);
    const result = await confirmWebImages(
      selectedCard.cardId,
      Array.from(selectedWebImages)
    );

    if (result.success) {
      toast.success(`Saved ${result.savedCount} images for ${selectedCard.name}`);
      setSelectedWebImages(new Set());
      loadTrainingImages(selectedCard.cardId);
      loadGlobalStats();
    } else {
      toast.error(result.error || 'Failed to save images');
    }

    setIsSaving(false);
  };

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
              <h1 className="text-lg font-bold text-gradient">Training Data</h1>
              <p className="text-xs text-muted-foreground">Collect labeled images for CNN training</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 container px-4 py-4 space-y-6">
        {/* Global Stats */}
        {trainingStats && (
          <div className="grid grid-cols-4 gap-2 p-3 rounded-lg bg-accent/50 border border-accent">
            <div className="text-center">
              <p className="text-lg font-bold text-foreground">{trainingStats.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-green-500">{trainingStats.scan_confirm}</p>
              <p className="text-xs text-muted-foreground">Confirmed</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-yellow-500">{trainingStats.scan_correction}</p>
              <p className="text-xs text-muted-foreground">Corrections</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-blue-500">{trainingStats.web_training}</p>
              <p className="text-xs text-muted-foreground">Web</p>
            </div>
          </div>
        )}

        {/* Card Selector */}
        <section>
          <h2 className="text-base font-semibold mb-2">Select Card</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Search cards by name or ID..."
              className="pl-10"
            />
            
            {/* Suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-60 overflow-auto">
                {suggestions.map((card) => (
                  <button
                    key={card.cardId}
                    onClick={() => handleCardSelect(card)}
                    className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3"
                  >
                    <span className="font-medium">{card.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {card.cardId} • {card.setName}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Selected Card Info */}
        {selectedCard && (
          <section className="p-4 rounded-lg bg-card border border-border">
            <div className="flex gap-4">
              <div className="w-20 h-28 rounded bg-muted flex items-center justify-center overflow-hidden">
                <img
                  src={`https://otyiezyaqexbgibxgqtl.supabase.co/storage/v1/object/public/riftbound-cards/${selectedCard.cardId}.webp`}
                  alt={selectedCard.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/placeholder.svg';
                  }}
                />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{selectedCard.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {selectedCard.cardId} • {selectedCard.setName}
                </p>
                {selectedCard.rarity && (
                  <p className="text-xs text-muted-foreground mt-1">{selectedCard.rarity}</p>
                )}
                <Button
                  onClick={handleSearchWebImages}
                  disabled={isSearching}
                  size="sm"
                  className="mt-3"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Searching...
                    </>
                  ) : (
                    <>
                      <Image className="w-4 h-4 mr-2" />
                      Fetch Web Photos
                    </>
                  )}
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* Search Error */}
        {searchError && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {searchError}
          </div>
        )}

        {/* Web Image Results */}
        {webImages.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold">
                Web Images ({selectedWebImages.size} selected)
              </h2>
              <Button
                onClick={handleSaveSelected}
                disabled={selectedWebImages.size === 0 || isSaving}
                size="sm"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Save Selected
                  </>
                )}
              </Button>
            </div>
            
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {webImages.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => toggleImageSelection(img.originalUrl)}
                  className={cn(
                    "relative aspect-square rounded-lg overflow-hidden border-2 transition-colors",
                    selectedWebImages.has(img.originalUrl)
                      ? "border-primary"
                      : "border-transparent hover:border-muted"
                  )}
                >
                  <img
                    src={img.thumbnailUrl}
                    alt={img.title}
                    className="w-full h-full object-cover"
                  />
                  {selectedWebImages.has(img.originalUrl) && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <Check className="w-8 h-8 text-primary" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Existing Training Images */}
        {selectedCard && (
          <section>
            <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
              <Database className="w-4 h-4" />
              Existing Training Images ({trainingImages.length})
            </h2>
            
            {isLoadingImages ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : trainingImages.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No training images for this card yet.
              </p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {trainingImages.map((img) => (
                  <div
                    key={img.id}
                    className="relative aspect-square rounded-lg overflow-hidden border border-border"
                  >
                    <img
                      src={img.image_url}
                      alt={img.card_id}
                      className="w-full h-full object-cover"
                    />
                    <div className={cn(
                      "absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[10px] text-white text-center",
                      img.source === 'scan_confirm' ? "bg-green-600/80" :
                      img.source === 'scan_correction' ? "bg-yellow-600/80" :
                      "bg-blue-600/80"
                    )}>
                      {img.source.replace('_', ' ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
};

export default Training;
