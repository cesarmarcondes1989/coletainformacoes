"use client";

import { createBrowserClient } from "@supabase/ssr";

// Cliente Supabase para o navegador (auth via cookies, compartilhado com o servidor).
export function createSupabaseBrowser() {
  // Placeholder evita crash no build sem env. Na Vercel, as variáveis
  // NEXT_PUBLIC_* são injetadas no build e os valores reais são usados.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key"
  );
}
