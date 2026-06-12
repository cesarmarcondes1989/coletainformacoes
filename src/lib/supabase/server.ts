import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Cliente Supabase para route handlers — lê a sessão via cookies.
// Usado SOMENTE para autenticar o usuário (getUser). As operações de banco
// continuam via supabaseAdmin (service role).
export function createSupabaseServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // chamado de um contexto sem write de cookies — ok, o middleware renova.
          }
        },
      },
    }
  );
}

export interface AuthedUser {
  id: string;
  name: string;
  email: string | null;
}

// Retorna o usuário autenticado (ou null). "name" é o nome de exibição que
// vira o "quem gravou" — derivado do servidor, não confiando no client.
export async function getAuthedUser(): Promise<AuthedUser | null> {
  const supabase = createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const name =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    user.email ||
    "Usuário";
  return { id: user.id, name, email: user.email ?? null };
}
