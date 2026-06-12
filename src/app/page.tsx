"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRecorder } from "@/lib/useRecorder";
import { createSupabaseBrowser } from "@/lib/supabase/client";

type Step = "login" | "capture" | "processing" | "confirm" | "saved" | "summary" | "search";

interface DraftRecord {
  recordId: string | null;
  source: "audio" | "text";
  text: string;
  language: string | null;
  audioSaved: boolean;
  transcriptionFailed: boolean;
}

export default function Page() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [authReady, setAuthReady] = useState(false);
  const [step, setStep] = useState<Step>("login");
  const [view, setView] = useState<"collect" | "dashboard" | "lookup">("collect");
  const [stats, setStats] = useState<any>(null);
  const [user, setUser] = useState(""); // nome de exibição do usuário autenticado
  const [busyMsg, setBusyMsg] = useState("");

  // captura
  const [text, setText] = useState("");
  const recorder = useRecorder();

  // rascunho atual (vinculado ao áudio salvo, se houver)
  const [draft, setDraft] = useState<DraftRecord>({
    recordId: null, source: "text", text: "", language: null, audioSaved: false, transcriptionFailed: false,
  });

  // confirmação
  const [client, setClient] = useState("");
  const [operator, setOperator] = useState("");
  const [detected, setDetected] = useState({ client: "", operator: "" });
  const [matches, setMatches] = useState<{ client: any[]; operator: any[] }>({ client: [], operator: [] });

  // busca universal
  const [lookup, setLookup] = useState<any>(null);

  // salvo / resumo
  const [savedClient, setSavedClient] = useState("");
  const [summary, setSummary] = useState<any>(null);
  const [clientsList, setClientsList] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    function applyUser(u: any) {
      if (u) {
        const name = (u.user_metadata?.full_name as string) || u.email || "Usuário";
        setUser(name);
        setStep((s) => (s === "login" ? "capture" : s));
      } else {
        setUser("");
        setStep("login");
        setView("collect");
      }
      setAuthReady(true);
    }
    supabase.auth.getUser().then(({ data }) => applyUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => applyUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function logout() {
    await supabase.auth.signOut();
    setUser("");
    setStep("login");
  }
  function resetCapture() {
    setText("");
    setClient("");
    setOperator("");
    setDraft({ recordId: null, source: "text", text: "", language: null, audioSaved: false, transcriptionFailed: false });
    setStep("capture");
  }

  // ---- microfone ----
  async function toggleMic() {
    if (recorder.recording) {
      const blob = await recorder.stop();
      if (!blob) return;
      await uploadAudio(blob);
    } else {
      recorder.start();
    }
  }

  async function uploadAudio(blob: Blob) {
    setBusyMsg("Salvando áudio e transcrevendo…");
    setStep("processing");
    try {
      const fd = new FormData();
      fd.append("audio", blob, "gravacao.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok && !data.recordId) throw new Error(data.error || "Falha ao processar áudio.");

      const failed = data.transcription_status === "failed";
      setDraft({
        recordId: data.recordId,
        source: "audio",
        text: data.transcript || "",
        language: data.language || null,
        audioSaved: !!data.audio_path,
        transcriptionFailed: failed,
      });
      setText(data.transcript || "");

      if (failed || !data.transcript) {
        // Áudio salvo, mas sem transcrição. Volta para captura para o usuário
        // digitar manualmente; o áudio continua vinculado e preservado.
        setStep("capture");
      } else {
        await runExtract(data.transcript, "audio", data.recordId, data.language || null);
      }
    } catch (e: any) {
      alert(e.message);
      setStep("capture");
    }
  }

  // ---- processar texto digitado ----
  async function processText() {
    if (text.trim().length < 3) { alert("Escreva ou grave algo primeiro."); return; }
    const isAudio = draft.source === "audio" && draft.recordId;
    await runExtract(text, isAudio ? "audio" : "text", draft.recordId, draft.language);
  }

  async function runExtract(content: string, source: "audio" | "text", recordId: string | null, lang: string | null) {
    setBusyMsg("Identificando cliente e operador…");
    setStep("processing");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha na identificação.");
      setClient(data.client || "");
      setOperator(data.operator || "");
      setDetected({ client: data.client || "", operator: data.operator || "" });
      setDraft((d) => ({
        ...d,
        recordId,
        source,
        text: content,
        language: lang || data.language || d.language,
        audioSaved: source === "audio" ? d.audioSaved : false,
      }));

      // Auto-checagem: busca clientes/operadores parecidos já existentes.
      try {
        const mres = await fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client: data.client || "", operator: data.operator || "" }),
        });
        const mdata = await mres.json();
        setMatches({ client: mdata.clientMatches || [], operator: mdata.operatorMatches || [] });
      } catch {
        setMatches({ client: [], operator: [] });
      }

      setStep("confirm");
    } catch (e: any) {
      alert(e.message);
      setStep("capture");
    }
  }

  // ---- salvar ----
  async function saveRecord() {
    if (!client.trim()) { alert("Informe o nome do cliente."); return; }
    setBusyMsg("Salvando registro…");
    setStep("processing");
    try {
      const res = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: client.trim(),
          operator: operator.trim(),
          language: draft.language,
          text: text.trim(),
          source: draft.source,
          recordId: draft.recordId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar.");
      setSavedClient(client.trim());
      setStep("saved");
    } catch (e: any) {
      alert(e.message);
      setStep("confirm");
    }
  }

  // ---- resumo ----
  async function loadSummary(name: string) {
    setBusyMsg("Gerando resumo…");
    setStep("processing");
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao gerar resumo.");
      setSummary(data);
      setStep("summary");
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function openDashboard() {
    setView("dashboard");
    setStats(null);
    try {
      const res = await fetch("/api/stats");
      const data = await res.json();
      setStats(data);
    } catch { setStats({ error: true }); }
  }

  function clientFromDashboard(name: string) {
    setView("collect");
    loadSummary(name);
  }

  function openLookup(prefill?: string) {
    setView("lookup");
    setLookup(null);
    if (prefill) runLookup(prefill);
  }

  async function runLookup(name: string) {
    if (!name.trim()) return;
    setLookup({ loading: true });
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha na busca.");
      setLookup(data);
    } catch (e: any) {
      setLookup({ error: e.message });
    }
  }

  async function openSearch() {
    setStep("search");
    try {
      const res = await fetch("/api/records?clients=1");
      const data = await res.json();
      setClientsList(data.clients || []);
    } catch { setClientsList([]); }
  }

  const stepNum = { login: 1, capture: 2, processing: 3, confirm: 3, saved: 4, summary: 5, search: 5 }[step];

  return (
    <>
      <div className="proto-flag">v1 — Next.js · Supabase · OpenAI. O áudio é sempre salvo antes de transcrever e nunca é deletado.</div>
      <div className="wrap">
        <header className="top">
          <div className="logo"><span className="dot">🎙️</span> Coleta de Informações</div>
          {user && <div className="who">Gravando como <b>{user}</b> · <a onClick={logout}>sair</a></div>}
        </header>

        {!authReady && (
          <div className="card center"><div className="big-ic">🔐</div><h1>Carregando…</h1><p><span className="spinner" /></p></div>
        )}
        {authReady && step === "login" && <Auth supabase={supabase} />}
        {authReady && step !== "login" && (
        <>
        <div className="nav">
          <button className={view === "collect" ? "active" : ""} onClick={() => setView("collect")}>🎙️ Coletar</button>
          <button className={view === "lookup" ? "active" : ""} onClick={() => openLookup()}>🔎 Buscar</button>
          <button className={view === "dashboard" ? "active" : ""} onClick={openDashboard}>📊 Dashboard</button>
        </div>

        {view === "dashboard" && <Dashboard stats={stats} onClient={clientFromDashboard} onEntity={openLookup} />}

        {view === "lookup" && <Lookup result={lookup} onRun={runLookup} />}

        {view === "collect" && (
        <>
        <div className="steps">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className={"s" + (n === stepNum ? " active" : n < stepNum ? " done" : "")} />
          ))}
        </div>

        {step === "processing" && (
          <div className="card center">
            <div className="big-ic">✨</div>
            <h1>{busyMsg || "Processando…"}</h1>
            <p><span className="spinner" /></p>
          </div>
        )}

        {step === "capture" && (
          <Capture
            text={text}
            setText={setText}
            recorder={recorder}
            onMic={toggleMic}
            onProcess={processText}
            onBack={logout}
            audioSaved={draft.audioSaved}
            transcriptionFailed={draft.transcriptionFailed}
            recordId={draft.recordId}
          />
        )}

        {step === "confirm" && (
          <Confirm
            client={client} setClient={setClient}
            operator={operator} setOperator={setOperator}
            text={text} setText={setText}
            language={draft.language}
            source={draft.source}
            audioSaved={draft.audioSaved}
            detected={detected}
            matches={matches}
            onBack={() => setStep("capture")}
            onSave={saveRecord}
          />
        )}

        {step === "saved" && (
          <Saved client={savedClient} onNew={resetCapture} onSummary={() => loadSummary(savedClient)} />
        )}

        {step === "summary" && summary && (
          <Summary data={summary} onNew={resetCapture} onSearch={openSearch} />
        )}

        {step === "search" && (
          <Search clients={clientsList} term={searchTerm} setTerm={setSearchTerm} onBack={resetCapture} onGo={() => searchTerm.trim() && loadSummary(searchTerm.trim())} />
        )}
        </>
        )}
        </>
        )}
      </div>
    </>
  );
}

/* ---------------- Componentes ---------------- */

function Auth({ supabase }: { supabase: any }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "warn" | "ok" | "info"; text: string } | null>(null);

  async function submit() {
    setMsg(null);
    if (!email.trim() || password.length < 6) {
      setMsg({ type: "warn", text: "Informe e-mail e senha (mín. 6 caracteres)." });
      return;
    }
    if (mode === "signup" && fullName.trim().length < 2) {
      setMsg({ type: "warn", text: "Informe seu nome." });
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw error;
        // Se a confirmação de e-mail estiver ativa, não há sessão ainda.
        if (!data.session) {
          setMsg({ type: "info", text: "Conta criada! Verifique seu e-mail para confirmar e depois faça login." });
          setMode("login");
        }
        // Se confirmação estiver desativada, o onAuthStateChange já loga.
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (e: any) {
      setMsg({ type: "warn", text: e?.message || "Falha na autenticação." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h1>{mode === "login" ? "Entrar" : "Criar conta"}</h1>
      <p className="sub">Toda informação registrada fica vinculada à sua conta (Supabase Auth).</p>

      {mode === "signup" && (
        <>
          <label>Seu nome</label>
          <input type="text" value={fullName} placeholder="Ex.: Mariana Alves" onChange={(e) => setFullName(e.target.value)} />
        </>
      )}
      <label>E-mail</label>
      <input type="text" value={email} placeholder="voce@empresa.com" onChange={(e) => setEmail(e.target.value)} />
      <label>Senha</label>
      <input type="password" value={password} placeholder="mín. 6 caracteres"
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} />

      {msg && <div className={"note " + msg.type}>{msg.text}</div>}

      <div className="row end">
        <button className="btn" disabled={busy} onClick={submit}>
          {busy ? <span className="spinner" /> : mode === "login" ? "Entrar →" : "Criar conta →"}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
        {mode === "login" ? "Não tem conta? " : "Já tem conta? "}
        <a onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMsg(null); }}>
          {mode === "login" ? "Criar conta" : "Entrar"}
        </a>
      </p>
    </div>
  );
}

function Capture({ text, setText, recorder, onMic, onProcess, onBack, audioSaved, transcriptionFailed, recordId }: any) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mmss = `${String(Math.floor(recorder.seconds / 60)).padStart(2, "0")}:${String(recorder.seconds % 60).padStart(2, "0")}`;
  return (
    <div className="card">
      <h1>Registrar conversa</h1>
      <p className="sub">Conte com quem conversou e o que foi tratado. <b>Clique no microfone para gravar</b> ou comece a <b>escrever</b>. A IA detecta o idioma (PT/EN) e identifica cliente e operador.</p>

      <div className="capture">
        <textarea ref={taRef} value={text} placeholder="Escreva aqui… ou toque no microfone para falar."
          onChange={(e) => setText(e.target.value)} disabled={recorder.recording} />
        <div className="capture-bar">
          <button className={"mic-btn" + (recorder.recording ? " live" : "")} onClick={onMic} title={recorder.recording ? "Parar" : "Gravar"}>
            {recorder.recording ? "■" : "🎤"}
          </button>
          {recorder.recording
            ? <span className="rec-time">{mmss}</span>
            : <span className="capture-hint" onClick={() => taRef.current?.focus()} style={{ cursor: "text" }}>ou clique aqui para escrever ✍️</span>}
        </div>
      </div>

      {recorder.error && <div className="note warn">⚠️ {recorder.error}</div>}

      {audioSaved && transcriptionFailed && (
        <div className="note warn">
          ⚠️ O áudio foi <b>salvo com segurança</b>, mas não foi possível transcrever automaticamente.
          Ele está preservado e poderá ser transcrito depois. Você pode <b>digitar o conteúdo manualmente</b> abaixo e seguir.
        </div>
      )}
      {audioSaved && !transcriptionFailed && (
        <div className="note ok">✅ Áudio salvo e transcrito. Revise o texto acima se precisar.</div>
      )}

      <div className="row between">
        <button className="btn ghost" onClick={onBack}>← Sair</button>
        <button className="btn" onClick={onProcess} disabled={recorder.recording}>Processar com IA →</button>
      </div>
      {recordId && <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>ref. áudio: {recordId}</p>}
    </div>
  );
}

function Confirm({ client, setClient, operator, setOperator, text, setText, language, source, audioSaved, detected, matches, onBack, onSave }: any) {
  const langLabel = language === "en" ? "🇬🇧 Inglês" : language === "pt" ? "🇧🇷 Português" : "idioma não detectado";
  return (
    <div className="card">
      <h1>Confirme antes de registrar</h1>
      <p className="sub">A IA identificou os nomes abaixo. <b>Revise e corrija</b> antes de salvar. Comparamos com a base e sugerimos registros já existentes para evitar duplicados.</p>

      <div className="ai-box">
        <div className="ai-head"><span>✨</span> Identificado automaticamente
          <span className="chip lang" style={{ marginLeft: "auto" }}>{langLabel}</span></div>
        <div className="field-detected">
          <div className="k">Cliente</div>
          <div className="v"><input type="text" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Nome do cliente" /></div>
        </div>
        <AutoCheck label="cliente" value={client} detected={detected?.client} matches={matches?.client} onPick={setClient} />
        <div className="field-detected">
          <div className="k">Operador</div>
          <div className="v"><input type="text" value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="Nome do operador" /></div>
        </div>
        <AutoCheck label="operador" value={operator} detected={detected?.operator} matches={matches?.operator} onPick={setOperator} />
      </div>

      <label>Conteúdo registrado {source === "audio" ? "(transcrição)" : "(texto)"}</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} />
      {source === "audio" && audioSaved && <p className="muted" style={{ fontSize: 11 }}>🔒 O áudio original permanece salvo e não será deletado.</p>}

      <div className="row between">
        <button className="btn ghost" onClick={onBack}>← Refazer</button>
        <button className="btn ok" onClick={onSave}>✓ Confirmar e registrar</button>
      </div>
    </div>
  );
}

function AutoCheck({ label, value, detected, matches, onPick }: any) {
  if (!detected) return null;
  const list = (matches || []) as any[];
  const exact = list.find((m) => m.exact);
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const valueIsExisting = list.some((m) => norm(m.name) === norm(value || ""));

  return (
    <div className="autocheck">
      {list.length > 0 ? (
        <>
          <span className="ac-label">{exact ? "✓ já existe na base:" : "parecidos na base:"}</span>
          {list.map((m) => (
            <button key={m.name} type="button"
              className={"ac-chip" + (norm(m.name) === norm(value || "") ? " on" : "")}
              onClick={() => onPick(m.name)} title={`${m.count} registro(s)`}>
              {m.name} <i>· {m.count}</i>
            </button>
          ))}
          {!valueIsExisting && (
            <button type="button" className="ac-chip new" onClick={() => onPick(detected)}>+ criar novo “{detected}”</button>
          )}
        </>
      ) : (
        <span className="ac-label">nenhum {label} parecido — será criado novo ✨</span>
      )}
    </div>
  );
}

function Lookup({ result, onRun }: any) {
  const [term, setTerm] = useState("");
  const [entities, setEntities] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/records?entities=1").then((r) => r.json()).then((d) => setEntities(d.names || [])).catch(() => setEntities([]));
  }, []);

  return (
    <>
      <div className="card">
        <h1>🔎 Buscar informações</h1>
        <p className="sub">Busque por <b>cliente ou operador</b>. Reunimos tudo que se sabe sobre a pessoa — nos dois papéis — com resumo por IA e histórico.</p>
        <label>Nome (cliente ou operador)</label>
        <input type="text" list="entityList" value={term} placeholder="Digite ou escolha…"
          onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onRun(term)} />
        <datalist id="entityList">{entities.map((n) => <option key={n} value={n} />)}</datalist>
        {entities.length > 0 && (
          <div className="examples">{entities.slice(0, 12).map((n) => <span className="ex" key={n} onClick={() => { setTerm(n); onRun(n); }}>{n}</span>)}</div>
        )}
        <div className="row end">
          <button className="btn" onClick={() => onRun(term)}>Buscar →</button>
        </div>
      </div>

      {result?.loading && (
        <div className="card center"><div className="big-ic">🧠</div><h2>Reunindo informações…</h2><p><span className="spinner" /></p></div>
      )}
      {result?.error && <div className="card"><p className="note warn">⚠️ {result.error}</p></div>}
      {result && !result.loading && !result.error && <LookupResult data={result} />}
    </>
  );
}

function LookupResult({ data }: any) {
  const roles = data.roles || { asClient: 0, asOperator: 0 };
  const stats = data.stats || {};
  if (!data.records || data.records.length === 0) {
    return <div className="card"><h2>{data.name}</h2><p className="sub">{data.summary}</p></div>;
  }
  return (
    <>
      <div className="card">
        <h1>{data.name}</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {roles.asClient > 0 && <span className="chip">👤 Cliente em <b>{roles.asClient}</b></span>}
          {roles.asOperator > 0 && <span className="chip">🎧 Operador em <b>{roles.asOperator}</b></span>}
          <span className="chip">Total: <b>{stats.total || data.records.length}</b></span>
        </div>
        {(stats.operatorsWhoServed?.length > 0) && <p className="sub" style={{ margin: "4px 0" }}>Atendido por: <b>{stats.operatorsWhoServed.join(", ")}</b></p>}
        {(stats.clientsServed?.length > 0) && <p className="sub" style={{ margin: "4px 0" }}>Clientes atendidos: <b>{stats.clientsServed.join(", ")}</b></p>}
        <div className="summary">{data.summary}</div>
      </div>
      <div className="card">
        <h2>Histórico completo</h2>
        {data.records.map((r: any) => (
          <div className="record-item" key={r.id}>
            <div className="h">
              <div className="names">{r.source === "audio" ? "🎤" : "✍️"} {r.client_name}{r.operator_name ? ` · operador ${r.operator_name}` : ""}</div>
              <div className="meta">{new Date(r.created_at).toLocaleString("pt-BR")}<br />por {r.recorded_by} {r.language === "en" ? "🇬🇧" : r.language === "pt" ? "🇧🇷" : ""}</div>
            </div>
            <div className="txt">{r.transcript || (r.transcription_status === "failed" || r.transcription_status === "pending" ? "(áudio salvo — transcrição pendente)" : "")}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function Saved({ client, onNew, onSummary }: any) {
  return (
    <>
      <div className="card center">
        <div className="big-ic">✅</div>
        <h1>Registro salvo!</h1>
        <p className="sub">Cliente <b>{client}</b> registrado com sucesso.</p>
      </div>
      <div className="card center">
        <h2>Buscar mais informações sobre <span className="badge">{client}</span>?</h2>
        <p className="sub">O sistema consulta todos os registros (de todos os clientes e usuários) e gera um resumo geral: quem conversou e o que foi dito.</p>
        <div className="row center">
          <button className="btn ghost" onClick={onNew}>Não, novo registro</button>
          <button className="btn" onClick={onSummary}>🔎 Sim, buscar resumo</button>
        </div>
      </div>
    </>
  );
}

function Summary({ data, onNew, onSearch }: any) {
  const stats = data.stats || { total: 0, operators: [], recorders: [] };
  return (
    <>
      <div className="card">
        <h1>Resumo de {data.client}</h1>
        <p className="sub">Consolidado de todos os registros encontrados.</p>
        <div className="stat-row">
          <div className="stat"><div className="n">{stats.total}</div><div className="l">registros</div></div>
          <div className="stat"><div className="n">{stats.operators?.length || 0}</div><div className="l">operadores</div></div>
          <div className="stat"><div className="n">{stats.recorders?.length || 0}</div><div className="l">quem gravou</div></div>
        </div>
        <div className="summary">{data.summary}</div>
      </div>
      <div className="card">
        <h2>Histórico completo</h2>
        {(data.records || []).map((r: any) => (
          <div className="record-item" key={r.id}>
            <div className="h">
              <div className="names">👤 {r.client_name}{r.operator_name ? ` · operador ${r.operator_name}` : ""}</div>
              <div className="meta">{new Date(r.created_at).toLocaleString("pt-BR")}<br />por {r.recorded_by} {r.language === "en" ? "🇬🇧" : r.language === "pt" ? "🇧🇷" : ""}</div>
            </div>
            <div className="txt">{r.transcript || (r.transcription_status === "failed" || r.transcription_status === "pending" ? "(áudio salvo — transcrição pendente)" : "")}</div>
          </div>
        ))}
      </div>
      <div className="row center">
        <button className="btn ghost" onClick={onNew}>+ Novo registro</button>
        <button className="btn" onClick={onSearch}>🔎 Buscar outro cliente</button>
      </div>
    </>
  );
}

function Dashboard({ stats, onClient, onEntity }: any) {
  if (!stats) {
    return <div className="card center"><div className="big-ic">📊</div><h1>Carregando dashboard…</h1><p><span className="spinner" /></p></div>;
  }
  if (stats.error) {
    return <div className="card"><h1>Dashboard</h1><p className="sub">Não foi possível carregar as estatísticas.</p></div>;
  }
  const t = stats.totals || {};
  const maxR = Math.max(1, ...(stats.byRecorder || []).map((x: any) => x.count));
  const maxC = Math.max(1, ...(stats.byClient || []).map((x: any) => x.count));
  const maxO = Math.max(1, ...(stats.byOperator || []).map((x: any) => x.count));
  return (
    <>
      <div className="card">
        <h1>📊 Dashboard</h1>
        <p className="sub">Visão geral de tudo que foi coletado.</p>
        <div className="kpis">
          <div className="kpi"><div className="n">{t.records || 0}</div><div className="l">registros</div></div>
          <div className="kpi"><div className="n">{t.clients || 0}</div><div className="l">clientes</div></div>
          <div className="kpi"><div className="n">{t.recorders || 0}</div><div className="l">coletores</div></div>
          <div className="kpi"><div className="n">{t.audio || 0}🎤 / {t.text || 0}✍️</div><div className="l">áudio / texto</div></div>
        </div>
        {t.pendingTranscriptions > 0 && (
          <div className="note warn" style={{ marginTop: 14 }}>
            ⚠️ {t.pendingTranscriptions} áudio(s) com transcrição pendente/falha — preservados para nova tentativa.
          </div>
        )}
      </div>

      <div className="card">
        <h2>🏆 Quem mais coletou informações</h2>
        <p className="sub">Ranking por número de registros.</p>
        {(stats.byRecorder || []).length === 0 && <p className="muted">Nenhum dado ainda.</p>}
        {(stats.byRecorder || []).map((r: any, i: number) => (
          <div className="rankrow" key={r.name}>
            <div className={"pos" + (i < 3 ? " top" : "")}>{i + 1}</div>
            <div className="nm">{r.name}</div>
            <div className="bar"><i style={{ width: `${(r.count / maxR) * 100}%` }} /></div>
            <div className="ct">{r.count}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>👥 Clientes com mais informações</h2>
        <p className="sub">Clique em um cliente para ver o resumo consolidado.</p>
        {(stats.byClient || []).length === 0 && <p className="muted">Nenhum dado ainda.</p>}
        {(stats.byClient || []).map((c: any, i: number) => (
          <div className="rankrow" key={c.name}>
            <div className={"pos" + (i < 3 ? " top" : "")}>{i + 1}</div>
            <div className="nm link" onClick={() => onClient(c.name)}>{c.name}</div>
            <div className="bar"><i style={{ width: `${(c.count / maxC) * 100}%` }} /></div>
            <div className="ct">{c.count}</div>
          </div>
        ))}
      </div>

      {(stats.byOperator || []).length > 0 && (
        <div className="card">
          <h2>🎧 Operadores mais ativos</h2>
          <p className="sub">Clique em um operador para buscar tudo sobre ele.</p>
          {(stats.byOperator || []).map((o: any, i: number) => (
            <div className="rankrow" key={o.name}>
              <div className={"pos" + (i < 3 ? " top" : "")}>{i + 1}</div>
              <div className="nm link" onClick={() => onEntity && onEntity(o.name)}>{o.name}</div>
              <div className="bar"><i style={{ width: `${(o.count / maxO) * 100}%` }} /></div>
              <div className="ct">{o.count}</div>
            </div>
          ))}
        </div>
      )}

      {(stats.recent || []).length > 0 && (
        <div className="card">
          <h2>🕒 Atividade recente</h2>
          {(stats.recent || []).map((r: any, i: number) => (
            <div className="record-item" key={i}>
              <div className="h">
                <div className="names">{r.source === "audio" ? "🎤" : "✍️"} {r.client_name}{r.operator_name ? ` · ${r.operator_name}` : ""}</div>
                <div className="meta">{new Date(r.created_at).toLocaleString("pt-BR")}<br />por {r.recorded_by} {r.language === "en" ? "🇬🇧" : r.language === "pt" ? "🇧🇷" : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Search({ clients, term, setTerm, onBack, onGo }: any) {
  return (
    <div className="card">
      <h1>Buscar cliente</h1>
      <p className="sub">Escolha um cliente para ver o resumo consolidado.</p>
      <label>Nome do cliente</label>
      <input type="text" list="clientList" value={term} placeholder="Digite ou escolha…" onChange={(e) => setTerm(e.target.value)} />
      <datalist id="clientList">{clients.map((c: string) => <option key={c} value={c} />)}</datalist>
      {clients.length > 0 && (
        <div className="examples">{clients.map((c: string) => <span className="ex" key={c} onClick={() => setTerm(c)}>{c}</span>)}</div>
      )}
      <div className="row between">
        <button className="btn ghost" onClick={onBack}>← Voltar</button>
        <button className="btn" onClick={onGo}>Ver resumo →</button>
      </div>
    </div>
  );
}
