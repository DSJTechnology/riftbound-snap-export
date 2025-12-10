// Collection types for the Riftbound Scanner app

import { CardData } from "@/data/cardDatabase";

export interface CollectionEntry extends CardData {
  normalCount: number;
  foilCount: number;
}

export interface ExportSettings {
  portfolioName: string;
  category: string;
}

// Export format types
export type ExportFormat = 'dotgg' | 'collectr' | 'legacy' | 'text' | 'deck';
