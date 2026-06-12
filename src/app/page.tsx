"use client";

import { useEffect, useRef, useState } from "react";
import { useRecorder } from "@/lib/useRecorder";

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
  const [step, setStep] = useState<Step>("login");
  const [user, setUser] = useState("");
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

  // salvo / resumo
  const [savedClient, setSavedClient] = useState("");
  const [summary, setSummary] = useState<any>(null);
  const [clientsList, setClientsList] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const u = localStorage.getItem("coleta_user");
    if (u) { setUser(u); setStep("capture"); }
  }, []);

  function login(name: string) {
    setUser(name);
    localStorage.setItem("coleta_user", name);
    setStep("capture");
  }
  function logout() {
    localStorage.removeItem("coleta_user");
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
      fd.append("recordedBy", user);
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
      setDraft((d) => ({
        ...d,
        recordId,
        source,
        text: content,
        language: lang || data.language || d.language,
        audioSaved: source === "audio" ? d.audioSaved : false,
      }));
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
          recordedBy: user,
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
          {user && <div className="who">Gravando como <b>{user}</b> · <a onClick={logout}>trocar</a></div>}
        </header>

        <div className="steps">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className={"s" + (n === stepNum ? " active" : n < stepNum ? " done" : "")} />
          ))}
        </div>

        {step === "login" && <Login initial={user} onSubmit={login} />}

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
      </div>
    </>
  );
}

/* ---------------- Componentes ---------------- */

function Login({ initial, onSubmit }: { initial: string; onSubmit: (n: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <div className="card">
      <h1>Quem está gravando?</h1>
      <p className="sub">Toda informação fica vinculada a você. (Em breve: login via Supabase Auth.)</p>
      <label>Seu nome</label>
      <input type="text" value={name} placeholder="Ex.: Mariana Alves"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && name.trim().length >= 2 && onSubmit(name.trim())} autoFocus />
      <div className="row end">
        <button className="btn" disabled={name.trim().length < 2} onClick={() => onSubmit(name.trim())}>Continuar →</button>
      </div>
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
        <button className="btn ghost" onClick={onBack}>← Trocar usuário</button>
        <button className="btn" onClick={onProcess} disabled={recorder.recording}>Processar com IA →</button>
      </div>
      {recordId && <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>ref. áudio: {recordId}</p>}
    </div>
  );
}

function Confirm({ client, setClient, operator, setOperator, text, setText, language, source, audioSaved, onBack, onSave }: any) {
  const langLabel = language === "en" ? "🇬🇧 Inglês" : language === "pt" ? "🇧🇷 Português" : "idioma não detectado";
  return (
    <div className="card">
      <h1>Confirme antes de registrar</h1>
      <p className="sub">A IA identificou os nomes abaixo. <b>Revise e corrija</b> antes de salvar.</p>

      <div className="ai-box">
        <div className="ai-head"><span>✨</span> Identificado automaticamente
          <span className="chip lang" style={{ marginLeft: "auto" }}>{langLabel}</span></div>
        <div className="field-detected">
          <div className="k">Cliente</div>
          <div className="v"><input type="text" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Nome do cliente" /></div>
        </div>
        <div className="field-detected">
          <div className="k">Operador</div>
          <div className="v"><input type="text" value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="Nome do operador" /></div>
        </div>
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
