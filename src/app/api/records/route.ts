import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/records
// Confirma e salva o registro com os nomes revisados pelo usuário.
//   - source 'audio': já existe um registro (recordId) -> UPDATE (mantém audio_path)
//   - source 'text' : cria um novo registro
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const recordedBy = user.name;

    const body = await req.json();
    const client = String(body.client || "").trim();
    const operator = String(body.operator || "").trim();
    const language = body.language ? String(body.language) : null;
    const text = String(body.text || "").trim();
    const source = body.source === "text" ? "text" : "audio";
    const recordId = body.recordId ? String(body.recordId) : null;

    if (!recordedBy) {
      return NextResponse.json({ error: "Quem gravou é obrigatório." }, { status: 400 });
    }
    if (!client) {
      return NextResponse.json({ error: "Nome do cliente é obrigatório." }, { status: 400 });
    }

    if (source === "audio" && recordId) {
      // Atualiza o registro do áudio (NÃO toca em audio_path nem no status da transcrição).
      const { data, error } = await supabaseAdmin
        .from("records")
        .update({
          recorded_by: recordedBy,
          recorded_by_id: user.id,
          client_name: client,
          operator_name: operator || null,
          language,
          transcript: text || null,
          confirmed: true,
        })
        .eq("id", recordId)
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ record: data });
    }

    // source 'text' — sem áudio.
    const { data, error } = await supabaseAdmin
      .from("records")
      .insert({
        recorded_by: recordedBy,
        recorded_by_id: user.id,
        client_name: client,
        operator_name: operator || null,
        language,
        source: "text",
        transcript: text || null,
        transcription_status: "not_needed",
        confirmed: true,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ record: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erro ao salvar." }, { status: 500 });
  }
}

// GET /api/records/clients-like via ?clients=1 -> lista distinta de clientes (para busca)
export async function GET(req: NextRequest) {
  if (!(await getAuthedUser())) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const { searchParams } = new URL(req.url);
  if (searchParams.get("clients")) {
    const { data, error } = await supabaseAdmin
      .from("records")
      .select("client_name")
      .not("client_name", "is", null)
      .eq("confirmed", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const clients = Array.from(new Set((data || []).map((r: any) => r.client_name))).sort();
    return NextResponse.json({ clients });
  }
  if (searchParams.get("entities")) {
    // Clientes + operadores (união) para autocomplete da busca universal.
    const { data, error } = await supabaseAdmin
      .from("records")
      .select("client_name, operator_name")
      .eq("confirmed", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const set = new Set<string>();
    for (const r of data || []) {
      if (r.client_name) set.add(r.client_name.trim());
      if (r.operator_name) set.add(r.operator_name.trim());
    }
    return NextResponse.json({ names: Array.from(set).filter(Boolean).sort() });
  }
  return NextResponse.json({ error: "Parâmetro inválido." }, { status: 400 });
}
