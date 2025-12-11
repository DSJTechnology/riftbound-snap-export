import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search, Loader2, CheckCircle2, AlertTriangle, XCircle, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCardDatabase } from '@/contexts/CardDatabaseContext';
import { CardData } from '@/data/cardDatabase';
import { cn } from '@/lib/utils';
import {
  preprocessImage,
  encodeImage,
  compareImages,
  getCardTrainingImages,
  evaluatePreprocessTest,
  evaluateSameImageTest,
  evaluateSameCardTest,
  evaluateDifferentCardTest,
  PreprocessResult,
  CompareResult,
  TrainingImageInfo,
  TestResult,
  TestStatus,
} from '@/services/debugService';

const StatusBadge = ({ status }: { status: TestStatus }) => {
  const config = {
    pass: { icon: CheckCircle2, label: 'PASS', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
    warn: { icon: AlertTriangle, label: 'WARN', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    fail: { icon: XCircle, label: 'FAIL', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    pending: { icon: Loader2, label: 'PENDING', className: 'bg-muted text-muted-foreground border-muted' },
    error: { icon: XCircle, label: 'ERROR', className: 'bg-destructive/20 text-destructive border-destructive/30' },
  };
  
  const { icon: Icon, label, className } = config[status];
  
  return (
    <Badge variant="outline" className={cn('gap-1', className)}>
      <Icon className={cn('w-3 h-3', status === 'pending' && 'animate-spin')} />
      {label}
    </Badge>
  );
};

const SanityTests = () => {
  const { cards } = useCardDatabase();
  
  // Card selection state
  const [searchQueryA, setSearchQueryA] = useState('');
  const [searchQueryB, setSearchQueryB] = useState('');
  const [selectedCardA, setSelectedCardA] = useState<CardData | null>(null);
  const [selectedCardB, setSelectedCardB] = useState<CardData | null>(null);
  const [showSuggestionsA, setShowSuggestionsA] = useState(false);
  const [showSuggestionsB, setShowSuggestionsB] = useState(false);
  
  // Training images
  const [imagesA, setImagesA] = useState<TrainingImageInfo[]>([]);
  const [imagesB, setImagesB] = useState<TrainingImageInfo[]>([]);
  const [selectedImageA, setSelectedImageA] = useState<TrainingImageInfo | null>(null);
  const [selectedImageB, setSelectedImageB] = useState<TrainingImageInfo | null>(null);
  const [loadingImagesA, setLoadingImagesA] = useState(false);
  const [loadingImagesB, setLoadingImagesB] = useState(false);
  
  // Test results
  const [preprocessResult, setPreprocessResult] = useState<TestResult | null>(null);
  const [preprocessData, setPreprocessData] = useState<PreprocessResult | null>(null);
  const [sameImageResult, setSameImageResult] = useState<TestResult | null>(null);
  const [sameImageData, setSameImageData] = useState<CompareResult | null>(null);
  const [sameCardResult, setSameCardResult] = useState<TestResult | null>(null);
  const [sameCardData, setSameCardData] = useState<CompareResult | null>(null);
  const [diffCardResult, setDiffCardResult] = useState<TestResult | null>(null);
  const [diffCardData, setDiffCardData] = useState<CompareResult | null>(null);
  
  // Loading states
  const [runningPreprocess, setRunningPreprocess] = useState(false);
  const [runningSameImage, setRunningSameImage] = useState(false);
  const [runningSameCard, setRunningSameCard] = useState(false);
  const [runningDiffCard, setRunningDiffCard] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  
  // Suggestions
  const suggestionsA = searchQueryA.length >= 2
    ? cards.filter(c => 
        c.name.toLowerCase().includes(searchQueryA.toLowerCase()) ||
        c.cardId.toLowerCase().includes(searchQueryA.toLowerCase())
      ).slice(0, 10)
    : [];
  
  const suggestionsB = searchQueryB.length >= 2
    ? cards.filter(c => 
        c.name.toLowerCase().includes(searchQueryB.toLowerCase()) ||
        c.cardId.toLowerCase().includes(searchQueryB.toLowerCase())
      ).slice(0, 10)
    : [];
  
  // Load images when card selected
  useEffect(() => {
    if (selectedCardA) {
      setLoadingImagesA(true);
      getCardTrainingImages(selectedCardA.cardId, 10).then(({ data }) => {
        setImagesA(data?.images || []);
        setLoadingImagesA(false);
        if (data?.images?.length) {
          setSelectedImageA(data.images[0]);
        }
      });
    } else {
      setImagesA([]);
      setSelectedImageA(null);
    }
  }, [selectedCardA]);
  
  useEffect(() => {
    if (selectedCardB) {
      setLoadingImagesB(true);
      getCardTrainingImages(selectedCardB.cardId, 10).then(({ data }) => {
        setImagesB(data?.images || []);
        setLoadingImagesB(false);
        if (data?.images?.length) {
          setSelectedImageB(data.images[0]);
        }
      });
    } else {
      setImagesB([]);
      setSelectedImageB(null);
    }
  }, [selectedCardB]);
  
  const handleSelectCardA = (card: CardData) => {
    setSelectedCardA(card);
    setSearchQueryA(card.name);
    setShowSuggestionsA(false);
    // Reset results
    setPreprocessResult(null);
    setSameImageResult(null);
    setSameCardResult(null);
  };
  
  const handleSelectCardB = (card: CardData) => {
    setSelectedCardB(card);
    setSearchQueryB(card.name);
    setShowSuggestionsB(false);
    setDiffCardResult(null);
  };
  
  // Test runners
  const runPreprocessTest = async () => {
    if (!selectedImageA) return;
    setRunningPreprocess(true);
    setPreprocessResult({ status: 'pending', message: 'Running...' });
    
    const { data, error } = await preprocessImage({ training_image_id: selectedImageA.id });
    
    if (error) {
      setPreprocessResult({ status: 'error', message: error });
    } else if (data) {
      setPreprocessData(data);
      setPreprocessResult(evaluatePreprocessTest(data));
    }
    
    setRunningPreprocess(false);
  };
  
  const runSameImageTest = async () => {
    if (!selectedImageA) return;
    setRunningSameImage(true);
    setSameImageResult({ status: 'pending', message: 'Running...' });
    
    const { data, error } = await compareImages(
      { training_image_id: selectedImageA.id },
      { training_image_id: selectedImageA.id }
    );
    
    if (error) {
      setSameImageResult({ status: 'error', message: error });
    } else if (data) {
      setSameImageData(data);
      setSameImageResult(evaluateSameImageTest(data.cosine_similarity));
    }
    
    setRunningSameImage(false);
  };
  
  const runSameCardTest = async () => {
    if (!selectedImageA || imagesA.length < 2) return;
    setRunningSameCard(true);
    setSameCardResult({ status: 'pending', message: 'Running...' });
    
    // Find a different image from the same card
    const otherImage = imagesA.find(img => img.id !== selectedImageA.id);
    if (!otherImage) {
      setSameCardResult({ status: 'error', message: 'Need at least 2 images for this test' });
      setRunningSameCard(false);
      return;
    }
    
    const { data, error } = await compareImages(
      { training_image_id: selectedImageA.id },
      { training_image_id: otherImage.id }
    );
    
    if (error) {
      setSameCardResult({ status: 'error', message: error });
    } else if (data) {
      setSameCardData(data);
      setSameCardResult(evaluateSameCardTest(data.cosine_similarity));
    }
    
    setRunningSameCard(false);
  };
  
  const runDiffCardTest = async () => {
    if (!selectedImageA || !selectedImageB) return;
    setRunningDiffCard(true);
    setDiffCardResult({ status: 'pending', message: 'Running...' });
    
    const { data, error } = await compareImages(
      { training_image_id: selectedImageA.id },
      { training_image_id: selectedImageB.id }
    );
    
    if (error) {
      setDiffCardResult({ status: 'error', message: error });
    } else if (data) {
      setDiffCardData(data);
      setDiffCardResult(evaluateDifferentCardTest(data.cosine_similarity));
    }
    
    setRunningDiffCard(false);
  };
  
  const runAllTests = async () => {
    setRunningAll(true);
    
    if (selectedImageA) {
      await runPreprocessTest();
      await runSameImageTest();
      if (imagesA.length >= 2) {
        await runSameCardTest();
      }
    }
    
    if (selectedImageA && selectedImageB) {
      await runDiffCardTest();
    }
    
    setRunningAll(false);
  };
  
  // Summary
  const allResults = [preprocessResult, sameImageResult, sameCardResult, diffCardResult].filter(Boolean);
  const passCount = allResults.filter(r => r?.status === 'pass').length;
  const warnCount = allResults.filter(r => r?.status === 'warn').length;
  const failCount = allResults.filter(r => r?.status === 'fail').length;
  
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
              <h1 className="text-lg font-bold text-gradient">Sanity Tests</h1>
              <p className="text-xs text-muted-foreground">Debug & validate image pipeline</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 container px-4 py-4 space-y-6">
        {/* Summary Bar */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-card border border-border">
          <div className="flex items-center gap-4">
            {passCount > 0 && (
              <span className="text-green-400 text-sm font-medium">{passCount} passed</span>
            )}
            {warnCount > 0 && (
              <span className="text-yellow-400 text-sm font-medium">{warnCount} warnings</span>
            )}
            {failCount > 0 && (
              <span className="text-red-400 text-sm font-medium">{failCount} failed</span>
            )}
            {allResults.length === 0 && (
              <span className="text-muted-foreground text-sm">No tests run yet</span>
            )}
          </div>
          <Button
            onClick={runAllTests}
            disabled={!selectedImageA || runningAll}
            size="sm"
          >
            {runningAll ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Run All Tests
          </Button>
        </div>

        {/* Card A Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Card A Selection</CardTitle>
            <CardDescription>Select primary card for testing</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQueryA}
                onChange={(e) => {
                  setSearchQueryA(e.target.value);
                  setShowSuggestionsA(true);
                }}
                onFocus={() => setShowSuggestionsA(true)}
                placeholder="Search cards..."
                className="pl-10"
              />
              {showSuggestionsA && suggestionsA.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-auto">
                  {suggestionsA.map((card) => (
                    <button
                      key={card.cardId}
                      onClick={() => handleSelectCardA(card)}
                      className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-2 text-sm"
                    >
                      <span className="font-medium">{card.name}</span>
                      <span className="text-xs text-muted-foreground">{card.cardId}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            {selectedCardA && (
              <div className="flex gap-3 p-3 rounded-lg bg-accent/30">
                <img
                  src={`https://otyiezyaqexbgibxgqtl.supabase.co/storage/v1/object/public/riftbound-cards/${selectedCardA.cardId}.webp`}
                  alt={selectedCardA.name}
                  className="w-16 h-22 object-cover rounded"
                  onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
                />
                <div>
                  <p className="font-medium">{selectedCardA.name}</p>
                  <p className="text-xs text-muted-foreground">{selectedCardA.cardId} • {selectedCardA.setName}</p>
                </div>
              </div>
            )}
            
            {/* Training images for Card A */}
            {selectedCardA && (
              <div>
                <p className="text-sm font-medium mb-2">Training Images ({imagesA.length})</p>
                {loadingImagesA ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                  </div>
                ) : imagesA.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No training images. Go to Training tab to add some.</p>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {imagesA.map((img) => (
                      <button
                        key={img.id}
                        onClick={() => setSelectedImageA(img)}
                        className={cn(
                          "w-16 h-16 rounded overflow-hidden border-2 transition-colors",
                          selectedImageA?.id === img.id ? "border-primary" : "border-transparent hover:border-muted"
                        )}
                      >
                        <img src={img.image_url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Test 1: Preprocessing */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Test 1: Preprocessing Check</CardTitle>
                <CardDescription>Verify image preprocessing produces valid output</CardDescription>
              </div>
              {preprocessResult && <StatusBadge status={preprocessResult.status} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={runPreprocessTest}
              disabled={!selectedImageA || runningPreprocess}
              size="sm"
            >
              {runningPreprocess ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Run Test
            </Button>
            
            {preprocessResult && (
              <p className={cn(
                "text-sm",
                preprocessResult.status === 'pass' && "text-green-400",
                preprocessResult.status === 'warn' && "text-yellow-400",
                preprocessResult.status === 'fail' && "text-red-400",
                preprocessResult.status === 'error' && "text-destructive"
              )}>
                {preprocessResult.message}
              </p>
            )}
            
            {preprocessData && (
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Output Size</p>
                  <p>{preprocessData.width}×{preprocessData.height}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Mean Brightness</p>
                  <p>{(preprocessData.stats.mean_pixel_value * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Contrast (Std)</p>
                  <p>{preprocessData.stats.std_pixel_value.toFixed(3)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Card Region</p>
                  <p>{preprocessData.stats.has_detected_card_region ? 'Detected' : 'Not detected'}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Test 2: Same Image */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Test 2: Same Image vs Same Image</CardTitle>
                <CardDescription>Verify encoder consistency (expect ≥99% similarity)</CardDescription>
              </div>
              {sameImageResult && <StatusBadge status={sameImageResult.status} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={runSameImageTest}
              disabled={!selectedImageA || runningSameImage}
              size="sm"
            >
              {runningSameImage ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Run Test
            </Button>
            
            {sameImageResult && (
              <p className={cn(
                "text-sm",
                sameImageResult.status === 'pass' && "text-green-400",
                sameImageResult.status === 'warn' && "text-yellow-400",
                sameImageResult.status === 'fail' && "text-red-400",
                sameImageResult.status === 'error' && "text-destructive"
              )}>
                {sameImageResult.message}
              </p>
            )}
            
            {sameImageData && (
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Cosine Similarity</p>
                  <p className="text-lg font-mono">{(sameImageData.cosine_similarity * 100).toFixed(2)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Norm 1</p>
                  <p className="font-mono">{sameImageData.embedding1.norm.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Trailing Zeros</p>
                  <p className="font-mono">{sameImageData.embedding1.trailing_zero_count}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Test 3: Same Card Different Images */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Test 3: Same Card, Different Images</CardTitle>
                <CardDescription>Different photos of same card (expect ≥90% similarity)</CardDescription>
              </div>
              {sameCardResult && <StatusBadge status={sameCardResult.status} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={runSameCardTest}
              disabled={!selectedImageA || imagesA.length < 2 || runningSameCard}
              size="sm"
            >
              {runningSameCard ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Run Test
            </Button>
            
            {imagesA.length < 2 && selectedCardA && (
              <p className="text-xs text-muted-foreground">Need at least 2 training images for this card</p>
            )}
            
            {sameCardResult && (
              <p className={cn(
                "text-sm",
                sameCardResult.status === 'pass' && "text-green-400",
                sameCardResult.status === 'warn' && "text-yellow-400",
                sameCardResult.status === 'fail' && "text-red-400",
                sameCardResult.status === 'error' && "text-destructive"
              )}>
                {sameCardResult.message}
              </p>
            )}
            
            {sameCardData && (
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Cosine Similarity</p>
                  <p className="text-lg font-mono">{(sameCardData.cosine_similarity * 100).toFixed(2)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Norm 1 / Norm 2</p>
                  <p className="font-mono">{sameCardData.embedding1.norm.toFixed(4)} / {sameCardData.embedding2.norm.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Dot Product</p>
                  <p className="font-mono">{sameCardData.dot_product.toFixed(4)}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card B Selection for Different Card Test */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Card B Selection (for Different Card Test)</CardTitle>
            <CardDescription>Select a different card to compare against Card A</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQueryB}
                onChange={(e) => {
                  setSearchQueryB(e.target.value);
                  setShowSuggestionsB(true);
                }}
                onFocus={() => setShowSuggestionsB(true)}
                placeholder="Search for Card B..."
                className="pl-10"
              />
              {showSuggestionsB && suggestionsB.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-auto">
                  {suggestionsB.map((card) => (
                    <button
                      key={card.cardId}
                      onClick={() => handleSelectCardB(card)}
                      className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-2 text-sm"
                    >
                      <span className="font-medium">{card.name}</span>
                      <span className="text-xs text-muted-foreground">{card.cardId}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            {selectedCardB && (
              <div className="flex gap-3 p-3 rounded-lg bg-accent/30">
                <img
                  src={`https://otyiezyaqexbgibxgqtl.supabase.co/storage/v1/object/public/riftbound-cards/${selectedCardB.cardId}.webp`}
                  alt={selectedCardB.name}
                  className="w-16 h-22 object-cover rounded"
                  onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
                />
                <div>
                  <p className="font-medium">{selectedCardB.name}</p>
                  <p className="text-xs text-muted-foreground">{selectedCardB.cardId} • {selectedCardB.setName}</p>
                </div>
              </div>
            )}
            
            {selectedCardB && (
              <div>
                <p className="text-sm font-medium mb-2">Training Images ({imagesB.length})</p>
                {loadingImagesB ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                  </div>
                ) : imagesB.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No training images for Card B.</p>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {imagesB.map((img) => (
                      <button
                        key={img.id}
                        onClick={() => setSelectedImageB(img)}
                        className={cn(
                          "w-16 h-16 rounded overflow-hidden border-2 transition-colors",
                          selectedImageB?.id === img.id ? "border-primary" : "border-transparent hover:border-muted"
                        )}
                      >
                        <img src={img.image_url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Test 4: Different Cards */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Test 4: Different Card Separation</CardTitle>
                <CardDescription>Different cards should be dissimilar (expect ≤75% similarity)</CardDescription>
              </div>
              {diffCardResult && <StatusBadge status={diffCardResult.status} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={runDiffCardTest}
              disabled={!selectedImageA || !selectedImageB || runningDiffCard}
              size="sm"
            >
              {runningDiffCard ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Run Test
            </Button>
            
            {(!selectedImageA || !selectedImageB) && (
              <p className="text-xs text-muted-foreground">Select images from both Card A and Card B</p>
            )}
            
            {diffCardResult && (
              <p className={cn(
                "text-sm",
                diffCardResult.status === 'pass' && "text-green-400",
                diffCardResult.status === 'warn' && "text-yellow-400",
                diffCardResult.status === 'fail' && "text-red-400",
                diffCardResult.status === 'error' && "text-destructive"
              )}>
                {diffCardResult.message}
              </p>
            )}
            
            {diffCardData && (
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Cosine Similarity</p>
                  <p className="text-lg font-mono">{(diffCardData.cosine_similarity * 100).toFixed(2)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Norm A / Norm B</p>
                  <p className="font-mono">{diffCardData.embedding1.norm.toFixed(4)} / {diffCardData.embedding2.norm.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Dot Product</p>
                  <p className="font-mono">{diffCardData.dot_product.toFixed(4)}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default SanityTests;
