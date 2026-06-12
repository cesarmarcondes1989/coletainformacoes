import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/stats
// Dashboard: quem mais coletou informações e quais clientes têm mais registros.
export async function GET() {
  try {
    if (!(await getAuthedUser())) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const { data, error } = await supabaseAdmin
      .from("records")
      .select("recorded_by, client_name, operator_name, source, transcription_status, language, created_at")
      .eq("confirmed", true);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const recs = data || [];

    const byRecorder = rank(recs, "recorded_by");
    const byClient = rank(recs, "client_name");
    const byOperator = rank(recs, "operator_name");

    const totals = {
      records: recs.length,
      clients: byClient.length,
      recorders: byRecorder.length,
      audio: recs.filter((r) => r.source === "audio").length,
      text: recs.filter((r) => r.source === "text").length,
      pendingTranscriptions: recs.filter(
        (r) => r.transcription_status === "pending" || r.transcription_status === "failed"
      ).length,
      pt: recs.filter((r) => r.language === "pt").length,
      en: recs.filter((r) => r.language === "en").length,
    };

    // últimos registros para a timeline
    const recent = [...recs]
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, 8)
      .map((r) => ({
        recorded_by: r.recorded_by,
        client_name: r.client_name,
        operator_name: r.operator_name,
        source: r.source,
        language: r.language,
        created_at: r.created_at,
      }));

    return NextResponse.json({ totals, byRecorder, byClient, byOperator, recent });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erro ao calcular estatísticas." }, { status: 500 });
  }
}

function rank(recs: any[], field: string) {
  const map = new Map<string, number>();
  for (const r of recs) {
    const v = (r[field] || "").trim();
    if (!v) continue;
    map.set(v, (map.get(v) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
