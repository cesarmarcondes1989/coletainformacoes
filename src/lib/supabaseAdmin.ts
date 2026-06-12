import { createClient } from "@supabase/supabase-js";

// Cliente Supabase para uso EXCLUSIVO no servidor (rotas /api).
// Usa a service role key — bypassa RLS. Nunca importe isto em código de client.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  // Não derruba o build; só falha em runtime se as envs faltarem.
  console.warn("[supabaseAdmin] Variáveis NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes.");
}

// Placeholder evita que createClient lance erro durante o build (sem env).
// Em produção (Vercel) as variáveis reais estarão presentes.
export const supabaseAdmin = createClient(
  url || "https://placeholder.supabase.co",
  serviceKey || "placeholder-service-key",
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export const AUDIO_BUCKET = process.env.SUPABASE_AUDIO_BUCKET || "recordings";
