import { NextRequest, NextResponse } from "next/server";
import { toFile } from "openai";
import { supabaseAdmin, AUDIO_BUCKET } from "@/lib/supabaseAdmin";
import { openai, TRANSCRIBE_MODEL, normalizeLanguage } from "@/lib/openai";
import { getAuthedUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/transcribe
// FormData: audio (Blob), recordedBy (string)
//
// Ordem CRÍTICA:
//   1) salva o áudio no Storage  -> nunca se perde
//   2) cria o registro (pending) -> áudio fica vinculado
//   3) tenta transcrever         -> se falhar, áudio + registro permanecem
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    const recordedBy = user.name;

    const form = await req.formData();
    const audio = form.get("audio");

    if (!(audio instanceof Blob)) {
      return NextResponse.json({ error: "Áudio ausente." }, { status: 400 });
    }

    const bytes = Buffer.from(await audio.arrayBuffer());
    const ext = guessExt(audio.type);
    const path = `${recordedBy.replace(/[^a-z0-9]/gi, "_").toLowerCase()}/${Date.now()}-${rand()}.${ext}`;

    // 1) SALVA O ÁUDIO PRIMEIRO — antes de qualquer transcrição.
    const up = await supabaseAdmin.storage
      .from(AUDIO_BUCKET)
      .upload(path, bytes, { contentType: audio.type || "audio/webm", upsert: false });

    if (up.error) {
      return NextResponse.json(
        { error: "Falha ao salvar o áudio: " + up.error.message },
        { status: 500 }
      );
    }

    // 2) CRIA O REGISTRO já apontando para o áudio (status pending).
    const insert = await supabaseAdmin
      .from("records")
      .insert({
        recorded_by: recordedBy,
        recorded_by_id: user.id,
        source: "audio",
        audio_path: path,
        transcription_status: "pending",
        transcription_attempts: 0,
        confirmed: false,
      })
      .select()
      .single();

    if (insert.error) {
      // O áudio JÁ está salvo no Storage; apenas reportamos o erro do insert.
      return NextResponse.json(
        { error: "Áudio salvo, mas falhou ao criar o registro: " + insert.error.message, audio_path: path },
        { status: 500 }
      );
    }

    const recordId = insert.data.id as string;

    // 3) TENTA TRANSCREVER. Se falhar, o áudio e o registro continuam intactos.
    try {
      const file = await toFile(bytes, `audio.${ext}`, { type: audio.type || "audio/webm" });
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
          transcription_attempts: 1,
        })
        .eq("id", recordId);

      return NextResponse.json({
        recordId,
        audio_path: path,
        transcript,
        language,
        transcription_status: "done",
      });
    } catch (err: any) {
      // FALHA NA TRANSCRIÇÃO — áudio preservado, marca para tentar de novo depois.
      const message = err?.message || "Erro desconhecido na transcrição";
      await supabaseAdmin
        .from("records")
        .update({
          transcription_status: "failed",
          transcription_error: message,
          transcription_attempts: 1,
        })
        .eq("id", recordId);

      return NextResponse.json({
        recordId,
        audio_path: path,
        transcript: null,
        language: null,
        transcription_status: "failed",
        transcription_error: message,
        notice: "O áudio foi salvo com segurança. A transcrição falhou e pode ser tentada novamente.",
      });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erro inesperado." }, { status: 500 });
  }
}

function guessExt(mime: string): string {
  if (!mime) return "webm";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "webm";
}
function rand() {
  return Math.random().toString(36).slice(2, 8);
}
