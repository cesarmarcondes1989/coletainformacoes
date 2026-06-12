import { NextRequest, NextResponse } from "next/server";
import { openai, CHAT_MODEL, normalizeLanguage } from "@/lib/openai";
import { getAuthedUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/extract  { text }
// Usa o GPT para identificar cliente, operador e idioma a partir do texto/transcrição.
export async function POST(req: NextRequest) {
  try {
    if (!(await getAuthedUser())) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const { text } = await req.json();
    if (!text || String(text).trim().length < 3) {
      return NextResponse.json({ error: "Texto muito curto." }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Você extrai informações de relatos de atendimento. O texto pode estar em português ou inglês. " +
            "Identifique o NOME DO CLIENTE e o NOME DO OPERADOR (atendente) mencionados. " +
            "Se algum não estiver claro, retorne string vazia para ele. " +
            'Responda APENAS em JSON: {"client_name": string, "operator_name": string, "language": "pt"|"en"}.',
        },
        { role: "user", content: String(text) },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    return NextResponse.json({
      client: (parsed.client_name || "").trim(),
      operator: (parsed.operator_name || "").trim(),
      language: normalizeLanguage(parsed.language) || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erro na extração." }, { status: 500 });
  }
}
