import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.warn("[openai] OPENAI_API_KEY ausente — transcrição/extração não funcionarão.");
}

export const openai = new OpenAI({ apiKey: apiKey ?? "" });

export const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

// Normaliza o idioma retornado pelo Whisper (ex.: 'portuguese', 'pt', 'en').
export function normalizeLanguage(raw?: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.startsWith("pt") || v.includes("portug")) return "pt";
  if (v.startsWith("en") || v.includes("english")) return "en";
  return v.slice(0, 2);
}
