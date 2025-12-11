import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ScanLine, ListChecks, Download, Trash2, AlertTriangle, Settings, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AutoCardScanner } from '@/components/AutoCardScanner';
import { CardSearch } from '@/components/CardSearch';
import { AddCardDialog } from '@/components/AddCardDialog';
import { CollectionList } from '@/components/CollectionList';
import { ExportPanel } from '@/components/ExportPanel';
import { CardDatabaseStatus } from '@/components/CardDatabaseStatus';
import { useCollection } from '@/hooks/useCollection';
import { useCardDatabase } from '@/contexts/CardDatabaseContext';
import { CardData } from '@/data/cardDatabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';



type Tab = 'scan' | 'collection' | 'export' | 'settings';

const Index = () => {
  const [activeTab, setActiveTab] = useState<Tab>('scan');
  const [pendingCard, setPendingCard] = useState<CardData | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showManualSearch, setShowManualSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { cards } = useCardDatabase();
  
  const {
    collection,
    exportSettings,
    setExportSettings,
    addCard,
    updateCardCounts,
    removeCard,
    clearCollection,
    stats,
  } = useCollection();

  // Handle card detected from auto-scanner - auto-add with Normal=1
  const handleCardDetected = useCallback((card: CardData) => {
    addCard(card, 1, 0); // Auto-add 1 normal copy
  }, [addCard]);

  // Handle scan failure - show manual search
  const handleScanFailed = useCallback(() => {
    setShowManualSearch(true);
    // Focus the search input after a short delay
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
  }, []);

  // Handle card selected from manual search
  const handleCardSelect = useCallback((card: CardData) => {
    setPendingCard(card);
    setShowManualSearch(false);
    toast.success(`Selected: ${card.name}`);
  }, []);

  const handleConfirmAdd = useCallback((normalCount: number, foilCount: number) => {
    if (pendingCard) {
      addCard(pendingCard, normalCount, foilCount);
      toast.success(`Added ${pendingCard.name} to collection`);
      setPendingCard(null);
    }
  }, [pendingCard, addCard]);

  const handleCancelAdd = useCallback(() => {
    setPendingCard(null);
  }, []);

  const handleClearCollection = useCallback(() => {
    clearCollection();
    setShowClearConfirm(false);
    toast.success('Collection cleared');
  }, [clearCollection]);

  const tabs = [
    { id: 'scan' as Tab, label: 'Scan', icon: ScanLine },
    { id: 'collection' as Tab, label: 'Collection', icon: ListChecks, badge: stats.uniqueCards },
    { id: 'export' as Tab, label: 'Export', icon: Download },
    { id: 'settings' as Tab, label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border">
        <div className="container py-3 px-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gradient">Riftbound Snap</h1>
              <p className="text-xs text-muted-foreground">Scan & Export Cards</p>
            </div>
            {stats.totalCards > 0 && (
              <div className="text-right">
                <p className="text-sm font-medium text-foreground">{stats.totalCards} cards</p>
                <p className="text-xs text-muted-foreground">{stats.uniqueCards} unique</p>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="sticky top-[61px] z-30 bg-background border-b border-border">
        <div className="container px-4">
          <div className="flex">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors relative",
                  activeTab === tab.id 
                    ? "text-primary" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <tab.icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="absolute -top-0.5 right-[calc(50%-24px)] min-w-5 h-5 flex items-center justify-center text-xs bg-primary text-primary-foreground rounded-full px-1.5">
                    {tab.badge}
                  </span>
                )}
                {activeTab === tab.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 container px-4 py-4 pb-24">
        {/* Scan Tab */}
        {activeTab === 'scan' && (
          <div className="space-y-6 animate-in">
            {/* No cards warning */}
            {cards.length === 0 && (
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-4">
                <p className="text-sm text-amber-500">
                  No card data loaded. Go to Settings and tap "Update Card Database" first.
                </p>
              </div>
            )}

            {/* Scanner Section */}
            <section>
              <h2 className="text-base font-semibold text-foreground mb-1">Auto-Scan Cards</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Hold card steady for 1-2 seconds to auto-add
              </p>
              <AutoCardScanner 
                onCardDetected={handleCardDetected}
                onScanFailed={handleScanFailed}
              />
            </section>

            {/* Manual Search Section - shown after scan failure or toggle */}
            {showManualSearch && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-background px-2 text-muted-foreground">Manual Search</span>
                  </div>
                </div>

                <section>
                  <h2 className="text-base font-semibold text-foreground mb-1">Search by Name or ID</h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    Type to search the card database
                  </p>
                  <CardSearch onCardSelect={handleCardSelect} inputRef={searchInputRef} />
                </section>
              </>
            )}

            {/* Toggle manual search */}
            {!showManualSearch && (
              <Button 
                variant="ghost" 
                className="w-full text-muted-foreground"
                onClick={() => setShowManualSearch(true)}
              >
                Or search manually →
              </Button>
            )}
          </div>
        )}

        {/* Collection Tab */}
        {activeTab === 'collection' && (
          <div className="space-y-4 animate-in">
            {/* Stats bar */}
            {stats.totalCards > 0 && (
              <div className="flex items-center justify-between p-3 glass-card">
                <div className="flex gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Normal:</span>{' '}
                    <span className="font-medium">{stats.totalNormal}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Foil:</span>{' '}
                    <span className="font-medium text-primary">{stats.totalFoil}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowClearConfirm(true)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear
                </Button>
              </div>
            )}

            <CollectionList
              collection={collection}
              onUpdateCounts={updateCardCounts}
              onRemove={removeCard}
            />
          </div>
        )}

        {/* Export Tab */}
        {activeTab === 'export' && (
          <div className="animate-in">
            <ExportPanel
              collection={collection}
              exportSettings={exportSettings}
              onSettingsChange={setExportSettings}
            />
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="space-y-6 animate-in">
            <section>
              <h2 className="text-base font-semibold text-foreground mb-4">Card Database</h2>
              <CardDatabaseStatus />
              <p className="text-xs text-muted-foreground mt-3">
                Update the card database to get the latest Riftbound cards from DotGG.
                The database is saved locally for offline use.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-2">Training Data</h2>
              <p className="text-sm text-muted-foreground mb-3">
                Collect labeled images to improve card recognition accuracy.
              </p>
              <Link to="/training">
                <Button variant="outline" className="gap-2">
                  <Database className="w-4 h-4" />
                  Manage Training Data
                </Button>
              </Link>
            </section>
          </div>
        )}
      </main>

      {/* Add Card Dialog */}
      {pendingCard && (
        <AddCardDialog
          card={pendingCard}
          onConfirm={handleConfirmAdd}
          onCancel={handleCancelAdd}
        />
      )}

      {/* Clear Confirmation Dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in">
          <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-lg p-6 animate-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Clear Collection?</h3>
                <p className="text-sm text-muted-foreground">This will remove all {stats.totalCards} cards</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowClearConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleClearCollection}
              >
                Clear All
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
