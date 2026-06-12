# 📋 Coleta de Informações — Documentação do Aplicativo

Aplicação para **registrar conversas com clientes/operadores por voz ou texto**, com
identificação automática por IA, confirmação humana, busca consolidada e dashboard.

- **Repositório:** https://github.com/cesarmarcondes1989/coletainformacoes
- **Stack:** Next.js 14 (App Router) · Supabase (Postgres + Auth + Storage) · OpenAI (Whisper + GPT) · Vercel
- **Idiomas suportados na captura:** Português 🇧🇷 e Inglês 🇬🇧 (detecção automática)

---

## 1. Visão geral

Qualquer pessoa autenticada pode registrar uma conversa **falando no microfone** ou
**escrevendo**. A IA transcreve (quando áudio), detecta o idioma e identifica **cliente**
e **operador**. O usuário confirma/corrige os nomes — com **auto-checagem** contra a base
para evitar duplicados — e salva. Depois é possível **buscar informações consolidadas**
sobre qualquer cliente ou operador, e acompanhar um **dashboard** de produtividade.

### Princípio central: o áudio nunca é perdido
Ao gravar, o áudio é enviado **primeiro** ao Supabase Storage e o registro é criado
apontando para ele **antes** de qualquer transcrição. Se a transcrição falhar, o áudio
**permanece salvo** para nova tentativa. Um trigger no banco **bloqueia o DELETE** de
qualquer registro que tenha áudio.

---

## 2. Fluxo do usuário

```
┌─────────────┐   ┌──────────────────┐   ┌─────────────────────┐   ┌──────────────┐
│ 1. Login    │ → │ 2. Captura       │ → │ 3. IA processa      │ → │ 4. Confirmar │
│ (Supabase   │   │ 🎤 microfone ou  │   │ transcreve (Whisper)│   │ cliente +    │
│  Auth)      │   │ ✍️ escrever      │   │ idioma + nomes (GPT)│   │ operador     │
└─────────────┘   └──────────────────┘   └─────────────────────┘   └──────┬───────┘
                                                                           │
        ┌──────────────────────────────────────────────────────────────────┘
        ▼
┌─────────────────┐   ┌───────────────────────────────────────────────┐
│ 5. Salvo        │ → │ 6. Buscar mais informações? → Resumo por IA   │
│ (com autor +    │   │    do cliente (quem falou e o que disse)      │
│  data/hora)     │   └───────────────────────────────────────────────┘
└─────────────────┘
```

### Etapas em detalhe
1. **Login / Cadastro** — e-mail + senha (Supabase Auth). O nome do cadastro vira o "quem gravou".
2. **Captura** — um único campo: clique no 🎤 para gravar ou comece a escrever ✍️.
3. **IA processa** — transcrição (Whisper) + detecção de idioma + identificação de cliente/operador (GPT).
4. **Confirmação** — campos editáveis. A **auto-checagem** sugere clientes/operadores já existentes (anti-duplicidade); se nada parecido, oferece criar novo.
5. **Salvo** — registro vinculado ao usuário autenticado, com data/hora.
6. **Buscar informações** — resumo consolidado do cliente, ou a **busca universal** por cliente OU operador.

---

## 3. Funcionalidades

| # | Funcionalidade | Descrição |
|---|----------------|-----------|
| 🎤 | **Captura por voz ou texto** | Microfone (MediaRecorder) ou digitação, no mesmo campo. |
| 🔒 | **Áudio inviolável** | Salvo no Storage antes de transcrever; trigger impede DELETE; re-transcrição disponível. |
| ✨ | **IA identifica** | Idioma (PT/EN), nome do cliente e do operador a partir do conteúdo. |
| ✅ | **Confirmação humana** | Usuário revisa/corrige antes de salvar. |
| 🔁 | **Auto-checagem** | Sugere nomes existentes semelhantes (normalização + Levenshtein) para evitar duplicados. |
| 🔎 | **Busca universal** | Por cliente OU operador, com resumo por IA + histórico nos dois papéis. |
| 🧠 | **Resumo por IA** | Consolida quem conversou com a pessoa e o que foi dito. |
| 📊 | **Dashboard** | Quem mais coletou, clientes/operadores mais frequentes, KPIs, atividade recente. |
| 🔐 | **Autenticação** | Supabase Auth (e-mail/senha); "quem gravou" derivado no servidor. |

---

## 4. Arquitetura

```
Navegador (React / Next client)
   │  grava áudio (MediaRecorder) / digita texto
   ▼
Next.js API Routes (servidor) ──auth via cookies (@supabase/ssr)──┐
   │                                                              │
   ├── OpenAI: Whisper (transcrição) + GPT (extração/resumo)      │
   │                                                              ▼
   └── Supabase (service role) ──► Postgres (records) + Storage (recordings)
```

- **Frontend** (`src/app/page.tsx`): client component único com as telas (login, captura, confirmação, salvo, resumo, busca, dashboard).
- **API Routes** (`src/app/api/*`): toda a lógica sensível roda no servidor; exigem usuário autenticado.
- **Autenticação**: `@supabase/ssr` com cookies + `middleware.ts` renovando a sessão. O "quem gravou" é derivado da sessão **no servidor** (não confia no client).
- **Banco**: operações via `supabaseAdmin` (service role, bypassa RLS). RLS habilitada sem políticas públicas → sem acesso anônimo direto.

### Estrutura de arquivos
```
.
├── prototipo/index.html          # protótipo navegável inicial (mock)
├── supabase/schema.sql           # tabela, índices, triggers, bucket
├── src/
│   ├── middleware.ts             # renova sessão Supabase
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx              # toda a UI / fluxo
│   │   └── api/
│   │       ├── transcribe/route.ts        # salva áudio + transcreve
│   │       ├── transcribe/retry/route.ts  # re-tenta transcrição
│   │       ├── extract/route.ts           # GPT: cliente/operador/idioma
│   │       ├── match/route.ts             # auto-checagem (dedupe)
│   │       ├── records/route.ts           # salvar registro + listas
│   │       ├── summary/route.ts           # resumo por cliente
│   │       ├── lookup/route.ts            # busca universal (cliente/operador)
│   │       └── stats/route.ts             # dashboard
│   └── lib/
│       ├── supabaseAdmin.ts      # client service role (servidor)
│       ├── supabase/client.ts    # client navegador (auth)
│       ├── supabase/server.ts    # client servidor + getAuthedUser()
│       ├── openai.ts             # client OpenAI + helpers
│       └── useRecorder.ts        # hook de gravação (MediaRecorder)
├── .env.example
├── vercel.json
└── package.json
```

---

## 5. Modelo de dados (`records`)

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid | PK |
| `recorded_by` | text | Nome de quem gravou (derivado da sessão) |
| `recorded_by_id` | uuid | ID do usuário autenticado (`auth.users`) |
| `client_name` | text | Cliente identificado/confirmado |
| `operator_name` | text | Operador identificado/confirmado |
| `language` | text | `pt` ou `en` |
| `source` | text | `audio` ou `text` |
| `audio_path` | text | Caminho no Storage (**nunca deletado**) |
| `transcript` | text | Transcrição/texto (pode ser vazio se falhou) |
| `transcription_status` | text | `pending` / `done` / `failed` / `not_needed` |
| `transcription_error` | text | Mensagem do último erro de transcrição |
| `transcription_attempts` | int | Nº de tentativas de transcrição |
| `confirmed` | boolean | `true` após confirmação do usuário |
| `created_at` / `updated_at` | timestamptz | Datas |

**Salvaguardas no banco:**
- Trigger `prevent_audio_delete` → bloqueia `DELETE` de registros com `audio_path`.
- Trigger `touch_updated_at` → mantém `updated_at`.
- Bucket de Storage `recordings` (privado).

---

## 6. API (rotas)

Todas exigem usuário autenticado (401 caso contrário).

| Método | Rota | Função |
|--------|------|--------|
| POST | `/api/transcribe` | Salva o áudio no Storage, cria o registro e tenta transcrever (Whisper). |
| POST | `/api/transcribe/retry` | Re-tenta transcrever um registro pendente/falho (áudio preservado). |
| POST | `/api/extract` | GPT identifica cliente, operador e idioma do texto/transcrição. |
| POST | `/api/match` | Sugere cliente/operador semelhantes já existentes (anti-duplicidade). |
| POST | `/api/records` | Confirma e salva o registro (update do áudio ou insert de texto). |
| GET | `/api/records?clients=1` | Lista distinta de clientes (autocomplete). |
| GET | `/api/records?entities=1` | Lista distinta de clientes + operadores (autocomplete da busca universal). |
| POST | `/api/summary` | Resumo consolidado de um cliente (IA + histórico). |
| POST | `/api/lookup` | Busca universal por cliente OU operador (IA + histórico nos dois papéis). |
| GET | `/api/stats` | Dados do dashboard. |

---

## 7. Variáveis de ambiente

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...            # só no servidor
SUPABASE_AUDIO_BUCKET=recordings

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_TRANSCRIBE_MODEL=whisper-1
OPENAI_CHAT_MODEL=gpt-4o-mini
```

> ⚠️ As variáveis `NEXT_PUBLIC_*` são injetadas **no build** — configure-as na Vercel antes do deploy.

---

## 8. Rodar localmente

```bash
npm install
cp .env.example .env.local        # preencha Supabase + OpenAI
# no Supabase: rode supabase/schema.sql no SQL Editor
npm run dev                       # http://localhost:3000
```

> O microfone exige contexto seguro: funciona em `localhost` e em HTTPS (Vercel).

## 9. Deploy na Vercel

1. **Supabase** → SQL Editor → rode `supabase/schema.sql`.
2. **Supabase** → Authentication → Email → desative *"Confirm email"* (para login imediato após cadastro).
3. **Vercel** → Import do repositório (Next.js detectado) → configure as variáveis de ambiente.
4. **Deploy.**

---

## 10. Segurança e privacidade

- "Quem gravou" é **derivado da sessão no servidor** — ninguém registra em nome de outro.
- Todas as rotas `/api/*` exigem autenticação.
- Service role usada **apenas no servidor**; nunca exposta ao navegador.
- Bucket de áudio **privado**; RLS habilitada sem acesso anônimo direto.
- Áudio é **imutável a deleção** por trigger no banco.

---

## 11. Roadmap (próximos passos sugeridos)

- [ ] Lista de operadores cadastrada (em vez de texto livre da IA).
- [ ] Player do áudio salvo na interface.
- [ ] Botão de re-transcrição na UI (o endpoint `/api/transcribe/retry` já existe).
- [ ] Edição/exclusão controlada de registros (respeitando a regra do áudio).
- [ ] Papéis/permissões (admin vs. operador).
- [ ] Exportação (CSV/PDF) dos resumos.

---

*Documentação gerada para o projeto Coleta de Informações.*
