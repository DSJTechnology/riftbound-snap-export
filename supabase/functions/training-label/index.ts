import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LabelRequest {
  card_id: string;
  source: 'scan_confirm' | 'scan_correction';
  image_data: string; // base64 data URL
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

    const { card_id, source, image_data }: LabelRequest = await req.json();

    if (!card_id || !source || !image_data) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: card_id, source, image_data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate source
    if (!['scan_confirm', 'scan_correction'].includes(source)) {
      return new Response(
        JSON.stringify({ error: 'Invalid source type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decode base64 image data
    const base64Data = image_data.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    // Generate unique filename
    const uuid = crypto.randomUUID();
    const filePath = `${source}/${card_id}/${uuid}.jpg`;

    console.log(`[training-label] Uploading image to ${filePath}`);

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from('training-images')
      .upload(filePath, imageBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      console.error('[training-label] Upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: `Upload failed: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from('training-images')
      .getPublicUrl(filePath);

    const image_url = urlData.publicUrl;

    // Insert record into training_images table
    const { error: insertError } = await supabase
      .from('training_images')
      .insert({
        card_id,
        source,
        image_url,
        used_in_model: false,
      });

    if (insertError) {
      console.error('[training-label] Insert error:', insertError);
      return new Response(
        JSON.stringify({ error: `Database insert failed: ${insertError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[training-label] Successfully saved training image for ${card_id} (${source})`);

    return new Response(
      JSON.stringify({ success: true, image_url, card_id, source }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[training-label] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
