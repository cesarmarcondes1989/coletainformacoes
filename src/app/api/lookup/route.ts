import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { openai, CHAT_MODEL } from "@/lib/openai";
import { getAuthedUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/lookup  { name }
// Busca universal: encontra registros em que o nome aparece como CLIENTE e/ou
// OPERADOR, e consolida tudo que se sabe sobre essa pessoa (resumo por IA + histórico).
export async function POST(req: NextRequest) {
  try {
    if (!(await getAuthedUser())) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const { name } = await req.json();
    if (!name || String(name).trim().length < 1) {
      return NextResponse.json({ error: "Informe um nome." }, { status: 400 });
    }
    const target = String(name).trim();

    const { data, error } = await supabaseAdmin
      .from("records")
      .select("id, recorded_by, client_name, operator_name, language, transcript, transcription_status, source, created_at")
      .eq("confirmed", true)
      .or(`client_name.ilike.${target},operator_name.ilike.${target}`)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const recs = data || [];
    if (recs.length === 0) {
      return NextResponse.json({ name: target, roles: { asClient: 0, asOperator: 0 }, records: [], summary: `Nenhuma informação encontrada para "${target}".` });
    }

    const eq = (a?: string) => (a || "").trim().toLowerCase() === target.toLowerCase();
    const asClientRecs = recs.filter((r) => eq(r.client_name));
    const asOperatorRecs = recs.filter((r) => eq(r.operator_name));

    // Quando é CLIENTE: operadores que o atenderam. Quando é OPERADOR: clientes atendidos.
    const operatorsWhoServed = uniq(asClientRecs.map((r) => r.operator_name));
    const clientsServed = uniq(asOperatorRecs.map((r) => r.client_name));
    const recorders = uniq(recs.map((r) => r.recorded_by));

    const context = recs
      .map((r, i) => {
        const when = new Date(r.created_at).toLocaleString("pt-BR");
        const role = eq(r.client_name) ? "como CLIENTE" : "como OPERADOR";
        const other = eq(r.client_name) ? `operador: ${r.operator_name || "—"}` : `cliente: ${r.client_name || "—"}`;
        const t = r.transcript || "(sem transcrição — áudio preservado)";
        return `#${i + 1} [${when}] ${role} | ${other} | gravado por ${r.recorded_by}\n${t}`;
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
              "Você consolida tudo que se sabe sobre uma pessoa que pode aparecer como CLIENTE e/ou OPERADOR. " +
              "Responda em português, objetivo. Diga em quais papéis a pessoa aparece, com quem se relacionou " +
              "(operadores/clientes), quem registrou e os principais pontos em ordem cronológica.",
          },
          {
            role: "user",
            content: `Pessoa: ${target}\nApareceu como cliente em ${asClientRecs.length} registro(s) e como operador em ${asOperatorRecs.length}.\nRegistros:\n\n${context}`,
          },
        ],
      });
      summary = completion.choices[0]?.message?.content || "";
    } catch (e: any) {
      summary = `(Falha ao gerar resumo por IA: ${e?.message}). ${recs.length} registro(s) encontrados para ${target}.`;
    }

    return NextResponse.json({
      name: target,
      roles: { asClient: asClientRecs.length, asOperator: asOperatorRecs.length },
      stats: {
        total: recs.length,
        operatorsWhoServed,
        clientsServed,
        recorders,
      },
      records: recs,
      summary,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erro na busca." }, { status: 500 });
  }
}

function uniq(arr: (string | null | undefined)[]): string[] {
  return Array.from(new Set(arr.map((x) => (x || "").trim()).filter(Boolean)));
}
