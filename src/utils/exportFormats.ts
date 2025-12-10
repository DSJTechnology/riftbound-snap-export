// Export format generators for the Riftbound Scanner app

import { CollectionEntry, ExportSettings } from '@/types/collection';

/**
 * DotGG Format (CSV)
 * Columns: CardId, Normal, Foil, Name, Set
 */
export function generateDotGGCSV(collection: CollectionEntry[]): string {
  const header = 'CardId,Normal,Foil,Name,Set';
  const rows = collection.map(card => 
    `${card.cardId},${card.normalCount},${card.foilCount},"${card.name}","${card.setName}"`
  );
  return [header, ...rows].join('\n');
}

/**
 * Collectr Format (CSV)
 * Columns: Portfolio Name, Category, Set, Product Name, Card Number, Rarity, Variance, Quantity
 * Creates separate rows for Normal and Foil variants
 */
export function generateCollectrCSV(collection: CollectionEntry[], settings: ExportSettings): string {
  const header = 'Portfolio Name,Category,Set,Product Name,Card Number,Rarity,Variance,Quantity';
  const rows: string[] = [];
  
  collection.forEach(card => {
    const cardNumber = card.cardNumber || card.cardId;
    const rarity = card.rarity || '';
    
    // Add Normal row if count > 0
    if (card.normalCount > 0) {
      rows.push(
        `"${settings.portfolioName}","${settings.category}","${card.setName}","${card.name}","${cardNumber}","${rarity}","Normal",${card.normalCount}`
      );
    }
    
    // Add Foil row if count > 0
    if (card.foilCount > 0) {
      rows.push(
        `"${settings.portfolioName}","${settings.category}","${card.setName}","${card.name}","${cardNumber}","${rarity}","Foil",${card.foilCount}`
      );
    }
  });
  
  return [header, ...rows].join('\n');
}

/**
 * Legacy Format (CSV)
 * Columns: Normal Count, Foil Count, Card ID
 */
export function generateLegacyCSV(collection: CollectionEntry[]): string {
  const header = 'Normal Count,Foil Count,Card ID';
  const rows = collection.map(card => 
    `${card.normalCount},${card.foilCount},${card.cardId}`
  );
  return [header, ...rows].join('\n');
}

/**
 * Simple Text CSV Format
 * Columns: CardId,Normal,Foil,Name,Set (no quotes)
 */
export function generateSimpleTextCSV(collection: CollectionEntry[]): string {
  const header = 'CardId,Normal,Foil,Name,Set';
  const rows = collection.map(card => 
    `${card.cardId},${card.normalCount},${card.foilCount},${card.name},${card.setName}`
  );
  return [header, ...rows].join('\n');
}

/**
 * Deck List Text Format
 * Format: <TotalCopies> <Card Name> (<CARD-ID>)
 */
export function generateDeckListText(collection: CollectionEntry[]): string {
  return collection
    .map(card => {
      const total = card.normalCount + card.foilCount;
      return `${total} ${card.name} (${card.cardId})`;
    })
    .join('\n');
}

/**
 * Download text content as a file
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'text/csv') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      document.body.removeChild(textarea);
      return false;
    }
  }
}
