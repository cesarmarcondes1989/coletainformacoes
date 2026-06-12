# Coleta de Informações

Solução para registrar conversas (áudio ou texto) com clientes/operadores, identificando
automaticamente **quem gravou**, o **cliente** e o **operador** via IA, com confirmação humana
antes de salvar — e geração de **resumos consolidados** por cliente.

## 🧪 Protótipo navegável (esta fase)

Abra **`prototipo/index.html`** no navegador. É 100% client-side e simula:

- **Supabase** → `localStorage`
- **OpenAI (Whisper + GPT)** → regras locais (detecção de idioma, extração de nomes, transcrição de exemplo)

### Fluxo demonstrado
1. **Quem está gravando** — identifica o usuário (futuramente Supabase Auth).
2. **Captura** — gravar áudio (mic), enviar arquivo, ou digitar texto.
3. **IA** — detecta idioma (🇧🇷 PT / 🇬🇧 EN) e identifica cliente + operador.
4. **Confirmação** — campos editáveis para o usuário validar/corrigir antes de salvar.
5. **Salvo** — registra com autor + data/hora; pergunta se deseja buscar mais informações.
6. **Resumo** — consolida todos os registros do cliente: quem conversou e o que foi dito.

> O protótipo já vem com dados de exemplo (cliente "João Pereira" tem 2 registros) para
> demonstrar a busca/resumo.

### Como rodar
```bash
# qualquer servidor estático, ex.:
python3 -m http.server 8080 --directory prototipo
# abra http://localhost:8080
```

## 🏗️ Arquitetura planejada (código completo — próxima fase)

- **Frontend/Backend:** Next.js (App Router) na **Vercel**
- **Banco + Auth + Storage:** **Supabase** (Postgres, RLS, áudio no Storage)
- **IA:** **OpenAI** — `whisper-1` (transcrição + idioma) e `gpt` (extração de cliente/operador + resumo)

### Modelo de dados (rascunho)
```sql
-- quem grava vem de auth.users
create table records (
  id uuid primary key default gen_random_uuid(),
  recorded_by uuid references auth.users(id),   -- QUEM gravou
  client_name text not null,
  operator_name text,
  language text,                                 -- 'pt' | 'en'
  source text,                                   -- 'audio' | 'file' | 'text'
  audio_path text,                               -- Supabase Storage
  transcript text not null,
  created_at timestamptz default now()
);
```

### Pipeline real
1. Áudio → Supabase Storage → OpenAI Whisper (transcrição + idioma).
2. Transcrição → GPT (function calling) → `{ client_name, operator_name }`.
3. Usuário confirma/edita → `insert into records`.
4. Resumo → busca registros do cliente → GPT consolida → exibe.

## Status
- [x] Protótipo navegável do fluxo
- [ ] App Next.js + Supabase + OpenAI
- [ ] Deploy na Vercel
