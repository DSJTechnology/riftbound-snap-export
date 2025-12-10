import { useState } from 'react';
import { Download, Copy, Check, FileText, Table, List, FileSpreadsheet, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CollectionEntry, ExportSettings } from '@/types/collection';
import {
  generateDotGGCSV,
  generateCollectrCSV,
  generateLegacyCSV,
  generateSimpleTextCSV,
  generateDeckListText,
  downloadFile,
  copyToClipboard,
} from '@/utils/exportFormats';
import { toast } from 'sonner';

interface ExportPanelProps {
  collection: CollectionEntry[];
  exportSettings: ExportSettings;
  onSettingsChange: (settings: ExportSettings) => void;
}

interface ExportOption {
  id: string;
  name: string;
  description: string;
  icon: typeof FileText;
  generate: (collection: CollectionEntry[], settings: ExportSettings) => string;
  filename: string;
}

const exportOptions: ExportOption[] = [
  {
    id: 'dotgg',
    name: 'DotGG CSV',
    description: 'CardId, Normal, Foil, Name, Set',
    icon: Table,
    generate: (c) => generateDotGGCSV(c),
    filename: 'riftbound-dotgg.csv',
  },
  {
    id: 'collectr',
    name: 'Collectr CSV',
    description: 'Portfolio format with variance rows',
    icon: FileSpreadsheet,
    generate: (c, s) => generateCollectrCSV(c, s),
    filename: 'riftbound-collectr.csv',
  },
  {
    id: 'legacy',
    name: 'Legacy CSV',
    description: 'Normal Count, Foil Count, Card ID',
    icon: FileText,
    generate: (c) => generateLegacyCSV(c),
    filename: 'riftbound-legacy.csv',
  },
  {
    id: 'text',
    name: 'Simple Text CSV',
    description: 'Plain comma-separated values',
    icon: ScrollText,
    generate: (c) => generateSimpleTextCSV(c),
    filename: 'riftbound-simple.csv',
  },
  {
    id: 'deck',
    name: 'Deck List',
    description: 'Total Card Name (ID) format',
    icon: List,
    generate: (c) => generateDeckListText(c),
    filename: 'riftbound-decklist.txt',
  },
];

export function ExportPanel({ collection, exportSettings, onSettingsChange }: ExportPanelProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');

  const handleCopy = async (option: ExportOption) => {
    const content = option.generate(collection, exportSettings);
    const success = await copyToClipboard(content);
    
    if (success) {
      setCopiedId(option.id);
      toast.success(`${option.name} copied to clipboard`);
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleDownload = (option: ExportOption) => {
    const content = option.generate(collection, exportSettings);
    const mimeType = option.filename.endsWith('.csv') ? 'text/csv' : 'text/plain';
    downloadFile(content, option.filename, mimeType);
    toast.success(`${option.name} downloaded`);
  };

  const handlePreview = (option: ExportOption) => {
    if (previewId === option.id) {
      setPreviewId(null);
      setPreviewContent('');
    } else {
      setPreviewId(option.id);
      setPreviewContent(option.generate(collection, exportSettings));
    }
  };

  if (collection.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
          <Download className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">No cards to export</p>
        <p className="text-sm text-muted-foreground/70 mt-1">Add cards to your collection first</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Collectr Settings */}
      <div className="glass-card p-4 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Collectr Settings</h3>
        <div className="grid gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Portfolio Name</label>
            <Input
              value={exportSettings.portfolioName}
              onChange={(e) => onSettingsChange({ ...exportSettings, portfolioName: e.target.value })}
              placeholder="Riftbound Portfolio"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Category</label>
            <Input
              value={exportSettings.category}
              onChange={(e) => onSettingsChange({ ...exportSettings, category: e.target.value })}
              placeholder="TCG"
            />
          </div>
        </div>
      </div>

      {/* Export Options */}
      <div className="space-y-3">
        {exportOptions.map((option) => (
          <div key={option.id} className="glass-card overflow-hidden">
            <div className="p-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <option.icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-foreground">{option.name}</h4>
                  <p className="text-xs text-muted-foreground truncate">{option.description}</p>
                </div>
              </div>

              <div className="flex gap-2 mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handlePreview(option)}
                >
                  {previewId === option.id ? 'Hide' : 'Preview'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleCopy(option)}
                >
                  {copiedId === option.id ? (
                    <Check className="w-4 h-4 text-success" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  Copy
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleDownload(option)}
                >
                  <Download className="w-4 h-4" />
                  Download
                </Button>
              </div>
            </div>

            {/* Preview area */}
            {previewId === option.id && (
              <div className="border-t border-border bg-muted/30 p-3">
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-40 overflow-auto scrollbar-hide">
                  {previewContent}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
