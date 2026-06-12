import { NextRequest, NextResponse } from "next/server";
import { toFile } from "openai";
import { supabaseAdmin, AUDIO_BUCKET } from "@/lib/supabaseAdmin";
import { openai, TRANSCRIBE_MODEL, normalizeLanguage } from "@/lib/openai";
import { getAuthedUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/transcribe/retry  { recordId }
// Re-tenta transcrever um registro 'pending'/'failed' baixando o áudio do Storage.
// O áudio nunca foi apagado, então sempre é possível tentar de novo.
export async function POST(req: NextRequest) {
  try {
    if (!(await getAuthedUser())) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const { recordId } = await req.json();
    if (!recordId) {
      return NextResponse.json({ error: "recordId é obrigatório." }, { status: 400 });
    }

    const { data: rec, error } = await supabaseAdmin
      .from("records")
      .select("id, audio_path, transcription_attempts")
      .eq("id", recordId)
      .single();

    if (error || !rec) {
      return NextResponse.json({ error: "Registro não encontrado." }, { status: 404 });
    }
    if (!rec.audio_path) {
      return NextResponse.json({ error: "Registro não possui áudio." }, { status: 400 });
    }

    const dl = await supabaseAdmin.storage.from(AUDIO_BUCKET).download(rec.audio_path);
    if (dl.error || !dl.data) {
      return NextResponse.json({ error: "Falha ao baixar o áudio do Storage." }, { status: 500 });
    }

    const bytes = Buffer.from(await dl.data.arrayBuffer());
    const attempts = (rec.transcription_attempts ?? 0) + 1;

    try {
      const file = await toFile(bytes, "audio.webm", { type: "audio/webm" });
      const result = await openai.audio.transcriptions.create({
        file,
        model: TRANSCRIBE_MODEL,
        response_format: "verbose_json",
      });
      const transcript = (result as any).text ?? "";
      const language = normalizeLanguage((result as any).language);

      await supabaseAdmin
        .from("records")
        .update({
          transcript,
          language,
          transcription_status: "done",
          transcription_error: null,
          transcription_attempts: attempts,
        })
        .eq("id", recordId);

      return NextResponse.json({ recordId, transcript, language, transcription_status: "done" });
    } catch (err: any) {
      const message = err?.message || "Erro na transcrição";
      await supabaseAdmin
        .from("records")
        .update({
          transcription_status: "failed",
          transcription_error: message,
          transcription_attempts: attempts,
        })
        .eq("id", recordId);
      return NextResponse.json({
        recordId,
        transcript: null,
        transcription_status: "failed",
        transcription_error: message,
        notice: "Áudio preservado. Tente novamente mais tarde.",
      });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erro inesperado." }, { status: 500 });
  }
}
