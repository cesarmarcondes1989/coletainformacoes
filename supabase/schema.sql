-- ============================================================
-- Coleta de Informações — schema Supabase
-- Execute no SQL Editor do Supabase (ou via CLI).
-- ============================================================

-- ---------- Tabela principal ----------
create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),

  -- QUEM gravou (v1: nome livre; futuramente auth.users.id)
  recorded_by text not null,

  -- identificados pela IA e confirmados pelo usuário
  client_name   text,
  operator_name text,

  language text,                 -- 'pt' | 'en'
  source   text not null,        -- 'audio' | 'text'

  -- ÁUDIO: caminho no Storage. NUNCA é deletado.
  audio_path text,

  -- transcrição (pode estar vazia se ainda não foi possível transcrever)
  transcript text,

  -- 'pending'  -> áudio salvo, aguardando/retentando transcrição
  -- 'done'     -> transcrito com sucesso
  -- 'failed'   -> tentativa falhou; ÁUDIO PRESERVADO para nova tentativa
  -- 'not_needed' -> origem 'text', sem áudio
  transcription_status text not null default 'pending',
  transcription_error  text,
  transcription_attempts int not null default 0,

  -- só vira true depois que o usuário confirma cliente/operador
  confirmed boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists records_client_idx on public.records (lower(client_name));
create index if not exists records_status_idx on public.records (transcription_status);
create index if not exists records_created_idx on public.records (created_at desc);

-- atualiza updated_at automaticamente
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before update on public.records
for each row execute function public.touch_updated_at();

-- ---------- SALVAGUARDA: o áudio NUNCA pode ser deletado ----------
-- Bloqueia DELETE de qualquer registro que tenha áudio associado.
create or replace function public.prevent_audio_delete()
returns trigger language plpgsql as $$
begin
  if old.audio_path is not null then
    raise exception 'Registros com áudio não podem ser deletados (audio_path=%).', old.audio_path;
  end if;
  return old;
end $$;

drop trigger if exists records_no_audio_delete on public.records;
create trigger records_no_audio_delete before delete on public.records
for each row execute function public.prevent_audio_delete();

-- ---------- RLS ----------
-- O backend usa a service role (bypassa RLS). Habilitamos RLS e deixamos
-- sem políticas públicas: nenhum acesso anônimo direto à tabela.
alter table public.records enable row level security;

-- ---------- Storage: bucket de áudio ----------
-- Cria o bucket 'recordings' (privado). O backend lê/grava com service role.
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;
