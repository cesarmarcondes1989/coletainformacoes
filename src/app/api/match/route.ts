import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/match  { client, operator }
// Procura na base nomes de clientes/operadores semelhantes aos detectados,
// para "auto-checar" e evitar duplicidade. Se não houver parecidos, o front
// oferece criar novo.
export async function POST(req: NextRequest) {
  try {
    if (!(await getAuthedUser())) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const { client, operator } = await req.json();

    const { data, error } = await supabaseAdmin
      .from("records")
      .select("client_name, operator_name")
      .eq("confirmed", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const clientCounts = countField(data || [], "client_name");
    const operatorCounts = countField(data || [], "operator_name");

    return NextResponse.json({
      clientMatches: bestMatches(client, clientCounts),
      operatorMatches: bestMatches(operator, operatorCounts),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erro no matching." }, { status: 500 });
  }
}

function countField(rows: any[], field: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = (r[field] || "").trim();
    if (!v) continue;
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}

function bestMatches(query: string | undefined, counts: Map<string, number>) {
  const q = norm(query || "");
  if (!q) return [];
  const out: { name: string; count: number; score: number; exact: boolean }[] = [];
  for (const [name, count] of counts) {
    const score = similarity(q, norm(name));
    if (score >= 0.6) out.push({ name, count, score, exact: norm(name) === q });
  }
  return out.sort((a, b) => b.score - a.score || b.count - a.count).slice(0, 5);
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}
