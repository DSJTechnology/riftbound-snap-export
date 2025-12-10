/**
 * Script to precompute MobileNet embeddings for all Riftbound cards.
 * 
 * This script:
 * 1. Fetches card data from Supabase
 * 2. Downloads each card's artwork
 * 3. Computes MobileNet embedding for each image
 * 4. Updates the database with computed embeddings
 * 
 * Run with: npx ts-node scripts/buildRiftboundEmbeddings.ts
 * Or: npx tsx scripts/buildRiftboundEmbeddings.ts
 */

import * as tf from '@tensorflow/tfjs-node';
import * as mobilenet from '@tensorflow-models/mobilenet';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

// Configuration
const MOBILENET_SIZE = 224;
const CENTER_CROP_RATIO = 0.75;
const BORDER_TRIM_RATIO = 0.90;
const BATCH_SIZE = 10; // Process cards in batches
const CACHE_DIR = './tmp/card-images';

// Supabase configuration - use environment variables
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  console.error('Set them in your .env file or as environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Download an image from a URL to a local file
 */
async function downloadImage(url: string, destPath: string): Promise<Buffer> {
  // Check cache first
  if (fs.existsSync(destPath)) {
    console.log(`  Using cached: ${path.basename(destPath)}`);
    return fs.readFileSync(destPath);
  }

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadImage(redirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        
        // Ensure directory exists
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(destPath, buffer);
        console.log(`  Downloaded: ${path.basename(destPath)}`);
        resolve(buffer);
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error(`Timeout downloading ${url}`));
    });
  });
}

/**
 * Preprocess image buffer for MobileNet
 */
async function preprocessImage(buffer: Buffer): Promise<tf.Tensor4D> {
  // Decode image
  let tensor = tf.node.decodeImage(buffer, 3);
  
  // Get dimensions
  const [height, width] = tensor.shape;
  
  // Calculate center crop region
  const centerCropWidth = Math.floor(width * CENTER_CROP_RATIO);
  const centerCropHeight = Math.floor(height * CENTER_CROP_RATIO);
  const centerCropX = Math.floor((width - centerCropWidth) / 2);
  const centerCropY = Math.floor((height - centerCropHeight) / 2);
  
  // Calculate border trim within center crop
  const trimWidth = Math.floor(centerCropWidth * BORDER_TRIM_RATIO);
  const trimHeight = Math.floor(centerCropHeight * BORDER_TRIM_RATIO);
  const trimX = centerCropX + Math.floor((centerCropWidth - trimWidth) / 2);
  const trimY = centerCropY + Math.floor((centerCropHeight - trimHeight) / 2);
  
  // Crop and resize
  const cropped = tf.image.cropAndResize(
    tensor.expandDims(0) as tf.Tensor4D,
    [[trimY / height, trimX / width, (trimY + trimHeight) / height, (trimX + trimWidth) / width]],
    [0],
    [MOBILENET_SIZE, MOBILENET_SIZE]
  );
  
  // Normalize to [0, 1]
  const normalized = cropped.div(255) as tf.Tensor4D;
  
  // Clean up
  tensor.dispose();
  cropped.dispose();
  
  return normalized;
}

/**
 * Compute embedding for a card image
 */
async function computeEmbedding(
  model: mobilenet.MobileNet,
  imageBuffer: Buffer
): Promise<number[]> {
  const preprocessed = await preprocessImage(imageBuffer);
  
  // Get embedding (feature vector)
  const embedding = model.infer(preprocessed, true) as tf.Tensor;
  const data = await embedding.data();
  const result = Array.from(data);
  
  // Clean up
  preprocessed.dispose();
  embedding.dispose();
  
  return result;
}

/**
 * Main function
 */
async function main() {
  console.log('=== Riftbound Card Embedding Builder ===\n');
  
  // Load MobileNet model
  console.log('Loading MobileNet model...');
  const model = await mobilenet.load({ version: 2, alpha: 1.0 });
  console.log('Model loaded!\n');
  
  // Fetch all cards from database
  console.log('Fetching cards from database...');
  const { data: cards, error } = await supabase
    .from('riftbound_cards')
    .select('id, card_id, name, art_url, embedding');
  
  if (error) {
    console.error('Failed to fetch cards:', error);
    process.exit(1);
  }
  
  if (!cards || cards.length === 0) {
    console.log('No cards found in database. Run the sync-riftbound-cards edge function first.');
    process.exit(0);
  }
  
  console.log(`Found ${cards.length} cards\n`);
  
  // Statistics
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  
  // Process cards in batches
  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(cards.length / BATCH_SIZE)}...`);
    
    for (const card of batch) {
      try {
        // Skip if already has embedding
        if (card.embedding && Array.isArray(card.embedding) && card.embedding.length > 0) {
          console.log(`  Skipping ${card.card_id} (already has embedding)`);
          skipped++;
          continue;
        }
        
        if (!card.art_url) {
          console.log(`  Skipping ${card.card_id} (no art URL)`);
          skipped++;
          continue;
        }
        
        console.log(`  Processing ${card.card_id}: ${card.name}`);
        
        // Download image
        const imagePath = path.join(CACHE_DIR, `${card.card_id}.webp`);
        const imageBuffer = await downloadImage(card.art_url, imagePath);
        
        // Compute embedding
        const embedding = await computeEmbedding(model, imageBuffer);
        console.log(`    Embedding: ${embedding.length} dimensions`);
        
        // Update database
        const { error: updateError } = await supabase
          .from('riftbound_cards')
          .update({ embedding })
          .eq('id', card.id);
        
        if (updateError) {
          console.error(`    Failed to update: ${updateError.message}`);
          failed++;
        } else {
          console.log(`    Updated in database`);
          processed++;
        }
        
      } catch (err) {
        console.error(`  Error processing ${card.card_id}:`, err);
        failed++;
      }
    }
    
    // Small delay between batches
    if (i + BATCH_SIZE < cards.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Summary
  console.log('\n=== Summary ===');
  console.log(`Processed: ${processed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${cards.length}`);
  
  // Also save to static JSON file for fallback
  console.log('\nExporting to static JSON...');
  
  const { data: updatedCards } = await supabase
    .from('riftbound_cards')
    .select('card_id, name, set_name, rarity, art_url, embedding');
  
  if (updatedCards) {
    const cardsWithEmbeddings = updatedCards.filter(c => c.embedding && Array.isArray(c.embedding));
    const outputPath = path.join(process.cwd(), 'public/data/riftbound_card_embeddings.json');
    
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(cardsWithEmbeddings, null, 2));
    console.log(`Saved ${cardsWithEmbeddings.length} cards to ${outputPath}`);
  }
  
  console.log('\nDone!');
}

main().catch(console.error);
