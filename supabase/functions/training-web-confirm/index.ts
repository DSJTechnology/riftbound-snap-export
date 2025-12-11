import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WebConfirmRequest {
  card_id: string;
  image_urls: string[];
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { card_id, image_urls }: WebConfirmRequest = await req.json();

    if (!card_id || !image_urls || !Array.isArray(image_urls) || image_urls.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: card_id, image_urls (array)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[training-web-confirm] Processing ${image_urls.length} images for card ${card_id}`);

    let savedCount = 0;
    const errors: string[] = [];

    for (const imageUrl of image_urls) {
      try {
        // Download the image
        console.log(`[training-web-confirm] Downloading ${imageUrl}`);
        const imageResponse = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; RiftboundTrainer/1.0)',
          },
        });

        if (!imageResponse.ok) {
          errors.push(`Failed to download ${imageUrl}: ${imageResponse.status}`);
          continue;
        }

        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        const imageBuffer = new Uint8Array(await imageResponse.arrayBuffer());

        // Generate unique filename
        const uuid = crypto.randomUUID();
        const extension = contentType.includes('png') ? 'png' : 'jpg';
        const filePath = `web_training/${card_id}/${uuid}.${extension}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('training-images')
          .upload(filePath, imageBuffer, {
            contentType,
            upsert: false,
          });

        if (uploadError) {
          errors.push(`Upload failed for ${imageUrl}: ${uploadError.message}`);
          continue;
        }

        // Get the public URL
        const { data: urlData } = supabase.storage
          .from('training-images')
          .getPublicUrl(filePath);

        // Insert record into training_images table
        const { error: insertError } = await supabase
          .from('training_images')
          .insert({
            card_id,
            source: 'web_training',
            image_url: urlData.publicUrl,
            used_in_model: false,
          });

        if (insertError) {
          errors.push(`Database insert failed for ${imageUrl}: ${insertError.message}`);
          continue;
        }

        savedCount++;
        console.log(`[training-web-confirm] Saved image ${savedCount}/${image_urls.length}`);

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Error processing ${imageUrl}: ${errorMessage}`);
      }
    }

    console.log(`[training-web-confirm] Completed: ${savedCount}/${image_urls.length} saved`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        saved_count: savedCount,
        total_requested: image_urls.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[training-web-confirm] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
