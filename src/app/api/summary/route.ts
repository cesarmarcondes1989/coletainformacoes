import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { openai, CHAT_MODEL } from "@/lib/openai";
import { getAuthedUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/summary  { client }
// Busca TODOS os registros do cliente (de todos os usuários/operadores) e
// gera um resumo geral: quem conversou e o que foi dito.
export async function POST(req: NextRequest) {
  try {
    if (!(await getAuthedUser())) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const { client } = await req.json();
    if (!client || String(client).trim().length < 1) {
      return NextResponse.json({ error: "Cliente é obrigatório." }, { status: 400 });
    }
    const name = String(client).trim();

    const { data: records, error } = await supabaseAdmin
      .from("records")
      .select("id, recorded_by, client_name, operator_name, language, transcript, transcription_status, created_at")
      .ilike("client_name", name)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const recs = records || [];
    if (recs.length === 0) {
      return NextResponse.json({ records: [], summary: `Nenhum registro encontrado para "${name}".` });
    }

    const operators = Array.from(new Set(recs.map((r) => r.operator_name).filter(Boolean)));
    const recorders = Array.from(new Set(recs.map((r) => r.recorded_by).filter(Boolean)));

    // Monta o contexto para o GPT consolidar.
    const context = recs
      .map((r, i) => {
        const when = new Date(r.created_at).toLocaleString("pt-BR");
        const op = r.operator_name ? ` | operador: ${r.operator_name}` : "";
        const t = r.transcript || "(sem transcrição — áudio preservado)";
        return `#${i + 1} [${when}] gravado por ${r.recorded_by}${op}\n${t}`;
      })
      .join("\n\n");

    let summary = "";
    try {
      const completion = await openai.chat.completions.create({
        model: CHAT_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "Você consolida o histórico de atendimento de um cliente. Responda em português, de forma objetiva. " +
              "Inclua: visão geral, quem conversou com o cliente (operadores e quem gravou) e os principais pontos discutidos em ordem cronológica.",
          },
          {
            role: "user",
            content: `Cliente: ${name}\nOperadores: ${operators.join(", ") || "—"}\nRegistros:\n\n${context}`,
          },
        ],
      });
      summary = completion.choices[0]?.message?.content || "";
    } catch (e: any) {
      summary = `(Falha ao gerar resumo por IA: ${e?.message}). Há ${recs.length} registro(s) para ${name}.`;
    }

    return NextResponse.json({
      client: name,
      stats: { total: recs.length, operators, recorders },
      records: recs,
      summary,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erro ao gerar resumo." }, { status: 500 });
  }
}
