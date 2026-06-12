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

## 🚀 App v1 (Next.js + Supabase + OpenAI)

Aplicação real na raiz do projeto. Fluxo:

- **Captura única**: um campo de texto onde a pessoa **clica no microfone para gravar** ou simplesmente **escreve**.
- **Áudio é sacrossanto**: ao gravar, o áudio vai **primeiro** para o Supabase Storage e um registro é criado apontando para ele — **antes** de qualquer transcrição. Se a transcrição (Whisper) falhar, o áudio **permanece salvo** (`transcription_status = failed`) e pode ser re-tentado depois (`/api/transcribe/retry`). Um trigger no banco **impede o DELETE** de qualquer registro com áudio.
- **IA** identifica idioma (PT/EN), cliente e operador → usuário **confirma/corrige** → salva.
- **Resumo** consolida todos os registros do cliente.

### Autenticação (Supabase Auth)
- Login/cadastro por **e-mail + senha**. O nome informado no cadastro vira o "quem gravou".
- **"Quem gravou" é derivado no servidor** a partir da sessão autenticada — o usuário não consegue registrar em nome de outro (dashboard confiável).
- Todas as rotas `/api/*` exigem autenticação.
- ⚙️ No Supabase: *Authentication → Providers → Email*. Para entrar imediatamente após o cadastro (sem e-mail de confirmação), **desative "Confirm email"** em *Authentication → Sign In / Providers*. Com confirmação ativa, o usuário precisa clicar no link enviado por e-mail antes do primeiro login.

### Setup local
```bash
npm install
cp .env.example .env.local      # preencha Supabase + OpenAI
# No Supabase: rode supabase/schema.sql no SQL Editor (cria tabela + bucket + triggers)
npm run dev                      # http://localhost:3000
```

### Deploy na Vercel
1. Importe o repositório na Vercel (framework Next.js, detectado automaticamente).
2. Configure as variáveis de ambiente (as mesmas do `.env.example`).
3. Deploy.

### Rotas de API
| Rota | Função |
|------|--------|
| `POST /api/transcribe` | Salva o áudio no Storage, cria o registro e tenta transcrever (Whisper). Áudio nunca é deletado. |
| `POST /api/transcribe/retry` | Re-tenta transcrever um registro pendente/falho baixando o áudio salvo. |
| `POST /api/extract` | GPT identifica cliente, operador e idioma do texto/transcrição. |
| `POST /api/records` | Confirma e salva o registro (update do áudio ou insert de texto). |
| `POST /api/summary` | Consolida todos os registros de um cliente + resumo por IA. |
| `GET /api/stats` | Dashboard: ranking de quem mais coletou e clientes com mais informações. |
| `POST /api/match` | Auto-checagem: nomes de cliente/operador semelhantes já existentes (dedupe). |
| `POST /api/lookup` | Busca universal por cliente OU operador (resumo por IA + histórico nos dois papéis). |

### Auto-checagem (anti-duplicidade)
Depois que a IA identifica os nomes, o app compara com a base (similaridade com acentos/caixa normalizados + Levenshtein) e sugere **registros já existentes** como chips clicáveis. Se nada for parecido, mostra **"criar novo"**. Evita duplicados como `João Pereira` vs `Joao pereira`.

### Busca universal (aba 🔎 Buscar)
Busca por **cliente OU operador** num único campo (com autocomplete). Reúne tudo sobre a pessoa nos dois papéis, com **resumo por IA + histórico**. Operadores no dashboard são clicáveis e caem direto nessa busca.

### Dashboard
Aba **📊 Dashboard** no topo mostra:
- **KPIs**: total de registros, clientes, coletores, áudio vs texto, transcrições pendentes.
- **🏆 Quem mais coletou informações** — ranking por nº de registros.
- **👥 Clientes com mais informações** — ranking clicável (abre o resumo do cliente).
- **🕒 Atividade recente**.

## 🎨 Design "Clarity"

A interface segue o design **Clarity** (mockup criado no Claude Design), mobile-first:
- Fundo azul claro (`#EBF0FF`), accent `#3859E8`, tipografia **Inter**.
- **Navegação inferior**: Gravar · Buscar · Painel.
- Telas: Login → Captura (mic grande pulsante + texto) → Gravando (waveform + timer) → IA processando (Whisper / GPT-4o) → Confirmar (auto-checagem + alerta de duplicidade) → Salvo → Buscar (lista ao vivo) → Resumo IA → Dashboard (KPIs + atividade + top usuários).
- Estilos centralizados em `src/app/globals.css` (design tokens em CSS variables); ícones em `src/lib/icons.tsx`.

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
- [x] Protótipo navegável do fluxo (`prototipo/`)
- [x] App Next.js + Supabase + OpenAI (v1)
- [x] Captura por microfone/texto num único campo
- [x] Áudio preservado mesmo sem transcrição
- [x] Login real (Supabase Auth — email/senha)
- [x] Dashboard (quem mais coletou / clientes com mais informações)
- [ ] Deploy na Vercel
