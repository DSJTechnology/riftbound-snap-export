// Riftbound TCG Card Database
// This file contains the internal card database for the scanner app.
// You can extend this by adding more cards following the same structure.

export interface CardData {
  cardId: string;        // Unique identifier (e.g., "OGN-001")
  name: string;          // Card name
  setName: string;       // Set name (e.g., "Origins")
  rarity?: string;       // Rarity level
  cardNumber?: string;   // Card number in set (e.g., "001/298")
}

// Sample Riftbound card database - extend as needed
export const cardDatabase: CardData[] = [
  // Origins Set (OGN)
  { cardId: "OGN-001", name: "Blazing Scorcher", setName: "Origins", rarity: "Rare", cardNumber: "001/298" },
  { cardId: "OGN-002", name: "Frost Warden", setName: "Origins", rarity: "Common", cardNumber: "002/298" },
  { cardId: "OGN-003", name: "Shadow Stalker", setName: "Origins", rarity: "Uncommon", cardNumber: "003/298" },
  { cardId: "OGN-004", name: "Light Bringer", setName: "Origins", rarity: "Epic", cardNumber: "004/298" },
  { cardId: "OGN-005", name: "Earth Shaker", setName: "Origins", rarity: "Common", cardNumber: "005/298" },
  { cardId: "OGN-006", name: "Storm Caller", setName: "Origins", rarity: "Rare", cardNumber: "006/298" },
  { cardId: "OGN-007", name: "Void Walker", setName: "Origins", rarity: "Legendary", cardNumber: "007/298" },
  { cardId: "OGN-008", name: "Nature Spirit", setName: "Origins", rarity: "Common", cardNumber: "008/298" },
  { cardId: "OGN-009", name: "Crystal Guardian", setName: "Origins", rarity: "Uncommon", cardNumber: "009/298" },
  { cardId: "OGN-010", name: "Phoenix Rising", setName: "Origins", rarity: "Mythic", cardNumber: "010/298" },
  { cardId: "OGN-011", name: "Iron Sentinel", setName: "Origins", rarity: "Common", cardNumber: "011/298" },
  { cardId: "OGN-012", name: "Arcane Scholar", setName: "Origins", rarity: "Uncommon", cardNumber: "012/298" },
  { cardId: "OGN-013", name: "Dragon Hatchling", setName: "Origins", rarity: "Rare", cardNumber: "013/298" },
  { cardId: "OGN-014", name: "Spirit Medium", setName: "Origins", rarity: "Common", cardNumber: "014/298" },
  { cardId: "OGN-015", name: "Battle Commander", setName: "Origins", rarity: "Epic", cardNumber: "015/298" },

  // Rift Expansion Set (RFT)
  { cardId: "RFT-001", name: "Rift Guardian", setName: "Rift Expansion", rarity: "Legendary", cardNumber: "001/150" },
  { cardId: "RFT-002", name: "Dimensional Shifter", setName: "Rift Expansion", rarity: "Rare", cardNumber: "002/150" },
  { cardId: "RFT-003", name: "Portal Mage", setName: "Rift Expansion", rarity: "Uncommon", cardNumber: "003/150" },
  { cardId: "RFT-004", name: "Chaos Elemental", setName: "Rift Expansion", rarity: "Epic", cardNumber: "004/150" },
  { cardId: "RFT-005", name: "Time Weaver", setName: "Rift Expansion", rarity: "Mythic", cardNumber: "005/150" },
  { cardId: "RFT-006", name: "Reality Anchor", setName: "Rift Expansion", rarity: "Common", cardNumber: "006/150" },
  { cardId: "RFT-007", name: "Void Spawn", setName: "Rift Expansion", rarity: "Common", cardNumber: "007/150" },
  { cardId: "RFT-008", name: "Planar Scout", setName: "Rift Expansion", rarity: "Uncommon", cardNumber: "008/150" },
  { cardId: "RFT-009", name: "Astral Knight", setName: "Rift Expansion", rarity: "Rare", cardNumber: "009/150" },
  { cardId: "RFT-010", name: "Entropy Lord", setName: "Rift Expansion", rarity: "Legendary", cardNumber: "010/150" },

  // Elemental Fury Set (ELF)
  { cardId: "ELF-001", name: "Inferno Drake", setName: "Elemental Fury", rarity: "Epic", cardNumber: "001/200" },
  { cardId: "ELF-002", name: "Tsunami Serpent", setName: "Elemental Fury", rarity: "Rare", cardNumber: "002/200" },
  { cardId: "ELF-003", name: "Thunder Hawk", setName: "Elemental Fury", rarity: "Uncommon", cardNumber: "003/200" },
  { cardId: "ELF-004", name: "Quake Beetle", setName: "Elemental Fury", rarity: "Common", cardNumber: "004/200" },
  { cardId: "ELF-005", name: "Blizzard Wolf", setName: "Elemental Fury", rarity: "Rare", cardNumber: "005/200" },
  { cardId: "ELF-006", name: "Magma Golem", setName: "Elemental Fury", rarity: "Epic", cardNumber: "006/200" },
  { cardId: "ELF-007", name: "Cyclone Fairy", setName: "Elemental Fury", rarity: "Common", cardNumber: "007/200" },
  { cardId: "ELF-008", name: "Primal Avatar", setName: "Elemental Fury", rarity: "Mythic", cardNumber: "008/200" },
  { cardId: "ELF-009", name: "Stone Warden", setName: "Elemental Fury", rarity: "Uncommon", cardNumber: "009/200" },
  { cardId: "ELF-010", name: "Lightning Sprite", setName: "Elemental Fury", rarity: "Common", cardNumber: "010/200" },

  // Dark Dominion Set (DDM)
  { cardId: "DDM-001", name: "Shadow Emperor", setName: "Dark Dominion", rarity: "Mythic", cardNumber: "001/175" },
  { cardId: "DDM-002", name: "Nightmare Beast", setName: "Dark Dominion", rarity: "Epic", cardNumber: "002/175" },
  { cardId: "DDM-003", name: "Plague Doctor", setName: "Dark Dominion", rarity: "Rare", cardNumber: "003/175" },
  { cardId: "DDM-004", name: "Soul Collector", setName: "Dark Dominion", rarity: "Legendary", cardNumber: "004/175" },
  { cardId: "DDM-005", name: "Grave Digger", setName: "Dark Dominion", rarity: "Common", cardNumber: "005/175" },
  { cardId: "DDM-006", name: "Death Knight", setName: "Dark Dominion", rarity: "Rare", cardNumber: "006/175" },
  { cardId: "DDM-007", name: "Wraith Hunter", setName: "Dark Dominion", rarity: "Uncommon", cardNumber: "007/175" },
  { cardId: "DDM-008", name: "Bone Dragon", setName: "Dark Dominion", rarity: "Legendary", cardNumber: "008/175" },
  { cardId: "DDM-009", name: "Cursed Knight", setName: "Dark Dominion", rarity: "Uncommon", cardNumber: "009/175" },
  { cardId: "DDM-010", name: "Specter Lord", setName: "Dark Dominion", rarity: "Epic", cardNumber: "010/175" },

  // Light's Dawn Set (LDN)
  { cardId: "LDN-001", name: "Solar Champion", setName: "Light's Dawn", rarity: "Legendary", cardNumber: "001/180" },
  { cardId: "LDN-002", name: "Dawn Herald", setName: "Light's Dawn", rarity: "Rare", cardNumber: "002/180" },
  { cardId: "LDN-003", name: "Holy Paladin", setName: "Light's Dawn", rarity: "Epic", cardNumber: "003/180" },
  { cardId: "LDN-004", name: "Light Weaver", setName: "Light's Dawn", rarity: "Uncommon", cardNumber: "004/180" },
  { cardId: "LDN-005", name: "Celestial Angel", setName: "Light's Dawn", rarity: "Mythic", cardNumber: "005/180" },
  { cardId: "LDN-006", name: "Radiant Knight", setName: "Light's Dawn", rarity: "Common", cardNumber: "006/180" },
  { cardId: "LDN-007", name: "Beacon Keeper", setName: "Light's Dawn", rarity: "Uncommon", cardNumber: "007/180" },
  { cardId: "LDN-008", name: "Divine Protector", setName: "Light's Dawn", rarity: "Rare", cardNumber: "008/180" },
  { cardId: "LDN-009", name: "Sun Priest", setName: "Light's Dawn", rarity: "Common", cardNumber: "009/180" },
  { cardId: "LDN-010", name: "Glory Seeker", setName: "Light's Dawn", rarity: "Common", cardNumber: "010/180" },
];

// Helper function to find a card by ID
export function findCardById(cardId: string): CardData | undefined {
  return cardDatabase.find(card => card.cardId.toLowerCase() === cardId.toLowerCase());
}

// Helper function to search cards by name (partial match)
export function searchCardsByName(query: string): CardData[] {
  const lowerQuery = query.toLowerCase();
  return cardDatabase.filter(card => 
    card.name.toLowerCase().includes(lowerQuery) ||
    card.cardId.toLowerCase().includes(lowerQuery)
  );
}

// Get all unique set names
export function getAllSets(): string[] {
  return [...new Set(cardDatabase.map(card => card.setName))];
}

// Get cards by set
export function getCardsBySet(setName: string): CardData[] {
  return cardDatabase.filter(card => card.setName === setName);
}

// Card ID pattern regex (e.g., OGN-001, RFT-123)
export const CARD_ID_PATTERN = /[A-Z]{2,4}-\d{3}/gi;
