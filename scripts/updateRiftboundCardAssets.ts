/**
 * Script to download Riftbound card art from dotGG and compute perceptual hashes.
 * 
 * Usage: npx ts-node scripts/updateRiftboundCardAssets.ts
 * Or add to package.json scripts: "update-riftbound-cards": "ts-node scripts/updateRiftboundCardAssets.ts"
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

interface RiftboundCard {
  cardId: string;
  name: string;
  set?: string;
  rarity?: string;
}

interface RiftboundCardWithHash extends RiftboundCard {
  setName?: string; // Alias for set
  artUrl: string;
  hash: string;
}

const DOTGG_BASE_URL = 'https://static.dotgg.gg/riftbound/cards';
const HASH_BITS = 8; // 8x8 = 64 bits

async function downloadImage(url: string, destPath: string): Promise<Buffer> {
  console.log(`  Downloading: ${url}`);
  
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  await fs.promises.writeFile(destPath, buffer);
  
  return buffer;
}

async function computeHashFromBuffer(buffer: Buffer, bits = 8): Promise<string> {
  const size = bits;

  // Resize to NxN and convert to grayscale
  const img = await sharp(buffer)
    .resize(size, size, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();

  const pixels = Array.from(img.values());
  
  // Calculate average
  const avg = pixels.reduce((sum, v) => sum + v, 0) / Math.max(pixels.length, 1);

  // Build binary string (1 if above avg, 0 if below)
  let bitsStr = '';
  for (const p of pixels) {
    bitsStr += p > avg ? '1' : '0';
  }

  // Convert to hex
  let hex = '';
  for (let i = 0; i < bitsStr.length; i += 4) {
    const nibble = bitsStr.slice(i, i + 4);
    hex += parseInt(nibble, 2).toString(16);
  }
  
  return hex;
}

async function main() {
  const cardsJsonPath = path.join(process.cwd(), 'public', 'data', 'riftbound_cards.json');
  
  // Check if cards file exists
  if (!fs.existsSync(cardsJsonPath)) {
    console.error(`Error: ${cardsJsonPath} not found`);
    console.error('Please create a riftbound_cards.json file with card data first.');
    process.exit(1);
  }

  const cards: RiftboundCard[] = JSON.parse(
    await fs.promises.readFile(cardsJsonPath, 'utf8')
  );

  console.log(`Found ${cards.length} cards in ${cardsJsonPath}`);

  const output: RiftboundCardWithHash[] = [];
  let downloaded = 0;
  let cached = 0;
  let failed = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    console.log(`[${i + 1}/${cards.length}] Processing ${card.cardId}: ${card.name}`);

    const dotggUrl = `${DOTGG_BASE_URL}/${card.cardId}.webp`;
    const localArtPath = path.join(
      process.cwd(),
      'public',
      'riftbound',
      'cards',
      `${card.cardId}.webp`
    );

    let buffer: Buffer;

    try {
      // Check if image already exists locally
      if (fs.existsSync(localArtPath)) {
        console.log(`  Using cached: ${localArtPath}`);
        buffer = await fs.promises.readFile(localArtPath);
        cached++;
      } else {
        buffer = await downloadImage(dotggUrl, localArtPath);
        downloaded++;
      }

      // Compute perceptual hash
      const hash = await computeHashFromBuffer(buffer, HASH_BITS);
      console.log(`  Hash: ${hash}`);

      output.push({
        cardId: card.cardId,
        name: card.name,
        set: card.set,
        setName: card.set, // Alias for compatibility
        rarity: card.rarity,
        artUrl: `/riftbound/cards/${card.cardId}.webp`,
        hash,
      });
    } catch (err) {
      console.warn(`  FAILED: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  // Write output JSON
  const outJsonPath = path.join(
    process.cwd(),
    'public',
    'data',
    'riftbound_card_hashes.json'
  );
  
  await fs.promises.mkdir(path.dirname(outJsonPath), { recursive: true });
  await fs.promises.writeFile(
    outJsonPath,
    JSON.stringify(output, null, 2),
    'utf8'
  );

  console.log('\n=== Summary ===');
  console.log(`Total cards: ${cards.length}`);
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Cached: ${cached}`);
  console.log(`Failed: ${failed}`);
  console.log(`Output: ${outJsonPath} (${output.length} entries)`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
