"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRecorder } from "@/lib/useRecorder";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { Mic, Lupa, Grid, Back, Check, WarnIcon, ACC } from "@/lib/icons";

type Screen =
  | "login" | "capture" | "recording" | "processing"
  | "confirm" | "saved" | "search" | "summary" | "dashboard";

interface Draft {
  recordId: string | null;
  source: "audio" | "text";
  language: string | null;
  audioSaved: boolean;
  transcriptionFailed: boolean;
}
interface ConfirmData {
  transcript: string;
  client: string;
  operator: string;
  lang: string | null;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const initials = (name: string) =>
  (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
const langBadge = (l: string | null) => (l === "en" ? "🇬🇧 EN" : "🇧🇷 PT");
const todayLabel = () =>
  new Date().toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "long" });

export default function Page() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const recorder = useRecorder();

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState("");
  const [screen, setScreen] = useState<Screen>("login");
  const [tab, setTab] = useState(0);

  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft>({ recordId: null, source: "text", language: null, audioSaved: false, transcriptionFailed: false });
  const [confirmData, setConfirmData] = useState<ConfirmData | null>(null);
  const [detected, setDetected] = useState({ client: "", operator: "" });
  const [matches, setMatches] = useState<{ client: any[]; operator: any[] }>({ client: [], operator: [] });
  const [savedData, setSavedData] = useState<any>(null);

  const [stats, setStats] = useState<any>(null);
  const [entities, setEntities] = useState<any[]>([]);
  const [lookup, setLookup] = useState<any>(null);

  /* ── auth ── */
  useEffect(() => {
    function apply(u: any) {
      if (u) {
        setUser((u.user_metadata?.full_name as string) || u.email || "Usuário");
        setScreen((s) => (s === "login" ? "capture" : s));
      } else {
        setUser("");
        setScreen("login");
        setTab(0);
      }
      setAuthReady(true);
    }
    supabase.auth.getUser().then(({ data }) => apply(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => apply(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  /* ── stats (dashboard + recentes + busca) ── */
  async function loadStats() {
    try {
      const res = await fetch("/api/stats");
      const data = await res.json();
      if (res.ok) {
        setStats(data);
        setEntities(buildEntities(data));
      }
    } catch { /* noop */ }
  }
  useEffect(() => { if (authReady && user) loadStats(); }, [authReady, user]);

  async function logout() { await supabase.auth.signOut(); }

  /* ── navegação inferior ── */
  function nav(i: number) {
    setTab(i);
    if (i === 0) setScreen("capture");
    if (i === 1) { setScreen("search"); }
    if (i === 2) { loadStats(); setScreen("dashboard"); }
  }

  /* ── gravação ── */
  async function startRecording() {
    await recorder.start();
    setScreen("recording");
  }
  async function stopRecording() {
    const blob = await recorder.stop();
    if (!blob || blob.size === 0) { setScreen("capture"); return; }
    await uploadAudio(blob);
  }

  async function uploadAudio(blob: Blob) {
    setScreen("processing");
    try {
      const fd = new FormData();
      fd.append("audio", blob, "gravacao.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok && !data.recordId) throw new Error(data.error || "Falha ao processar áudio.");

      const failed = data.transcription_status === "failed";
      const d: Draft = {
        recordId: data.recordId, source: "audio",
        language: data.language || null, audioSaved: !!data.audio_path, transcriptionFailed: failed,
      };
      setDraft(d);

      if (data.transcript) {
        await runExtract(data.transcript, d);
      } else {
        // Áudio salvo, mas sem transcrição — segue para confirmação manual.
        setConfirmData({ transcript: "", client: "", operator: "", lang: data.language || null });
        setDetected({ client: "", operator: "" });
        setMatches({ client: [], operator: [] });
        setScreen("confirm");
      }
    } catch (e: any) {
      alert(e.message);
      setScreen("capture");
    }
  }

  async function registerText() {
    if (text.trim().length < 3) return;
    const d: Draft = { recordId: null, source: "text", language: null, audioSaved: false, transcriptionFailed: false };
    setDraft(d);
    setScreen("processing");
    await runExtract(text.trim(), d);
  }

  async function runExtract(content: string, d: Draft) {
    try {
      const res = await fetch("/api/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha na identificação.");
      const lang = d.language || data.language || null;
      setDraft({ ...d, language: lang });
      setConfirmData({ transcript: content, client: data.client || "", operator: data.operator || "", lang });
      setDetected({ client: data.client || "", operator: data.operator || "" });

      try {
        const mres = await fetch("/api/match", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client: data.client || "", operator: data.operator || "" }),
        });
        const mdata = await mres.json();
        setMatches({ client: mdata.clientMatches || [], operator: mdata.operatorMatches || [] });
      } catch { setMatches({ client: [], operator: [] }); }

      setScreen("confirm");
    } catch (e: any) {
      alert(e.message);
      setScreen("capture");
    }
  }

  async function saveRecord(client: string, operator: string) {
    if (!client.trim() || !confirmData) { alert("Informe o nome do cliente."); return; }
    setScreen("processing");
    try {
      const res = await fetch("/api/records", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: client.trim(), operator: operator.trim(),
          language: draft.language, text: confirmData.transcript,
          source: draft.source, recordId: draft.recordId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar.");
      setSavedData({
        client: client.trim(), operator: operator.trim(),
        lang: draft.language, by: user,
        date: new Date().toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        audioSaved: draft.audioSaved,
      });
      loadStats();
      setScreen("saved");
    } catch (e: any) {
      alert(e.message);
      setScreen("confirm");
    }
  }

  async function runLookup(name: string) {
    if (!name.trim()) return;
    setLookup({ loading: true, name });
    setScreen("summary");
    try {
      const res = await fetch("/api/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha na busca.");
      setLookup(data);
    } catch (e: any) {
      setLookup({ error: e.message, name });
    }
  }

  function resetCapture() {
    setText(""); setConfirmData(null); setDraft({ recordId: null, source: "text", language: null, audioSaved: false, transcriptionFailed: false });
    setTab(0); setScreen("capture");
  }

  /* ── render ── */
  return (
    <div className="app">
      {!authReady && (
        <div className="screen white center"><span className="spinner lg" /></div>
      )}

      {authReady && screen === "login" && <LoginScreen supabase={supabase} />}

      {authReady && screen === "capture" && (
        <CaptureScreen
          user={user} text={text} setText={setText}
          recent={stats?.recent || []}
          onRecord={startRecording} onText={registerText}
          tab={tab} go={nav} onAvatar={logout}
        />
      )}

      {authReady && screen === "recording" && (
        <RecordingScreen secs={recorder.seconds} error={recorder.error} onStop={stopRecording} onCancel={() => setScreen("capture")} />
      )}

      {authReady && screen === "processing" && <ProcessingScreen />}

      {authReady && screen === "confirm" && confirmData && (
        <ConfirmScreen
          data={confirmData} draft={draft} detected={detected} matches={matches}
          onBack={() => setScreen("capture")} onSave={saveRecord}
        />
      )}

      {authReady && screen === "saved" && savedData && (
        <SavedScreen data={savedData} onNew={resetCapture} onSummary={() => { setTab(1); runLookup(savedData.client); }} />
      )}

      {authReady && screen === "search" && (
        <SearchScreen entities={entities} onResult={(name: string) => runLookup(name)} tab={tab} go={nav} />
      )}

      {authReady && screen === "summary" && (
        <SummaryScreen data={lookup} onBack={() => setScreen(tab === 1 ? "search" : "saved")} />
      )}

      {authReady && screen === "dashboard" && (
        <DashboardScreen stats={stats} onEntity={(name: string) => runLookup(name)} tab={tab} go={nav} />
      )}
    </div>
  );
}

/* helper: monta lista de entidades (clientes + operadores) a partir das stats */
function buildEntities(stats: any) {
  const map = new Map<string, { name: string; cli: number; ope: number }>();
  for (const c of stats?.byClient || []) {
    const k = c.name; const e = map.get(k) || { name: k, cli: 0, ope: 0 }; e.cli += c.count; map.set(k, e);
  }
  for (const o of stats?.byOperator || []) {
    const k = o.name; const e = map.get(k) || { name: k, cli: 0, ope: 0 }; e.ope += o.count; map.set(k, e);
  }
  return Array.from(map.values())
    .map((e) => ({ name: e.name, role: e.cli >= e.ope ? "cliente" : "operador", entries: e.cli + e.ope }))
    .sort((a, b) => b.entries - a.entries);
}

/* ════════ NAV ════════ */
function Nav({ tab, go }: { tab: number; go: (i: number) => void }) {
  const items: [string, (a: boolean) => React.ReactNode][] = [
    ["Gravar", (a) => <Mic c={a ? ACC : "#AAB5CC"} s={22} />],
    ["Buscar", (a) => <Lupa c={a ? ACC : "#AAB5CC"} s={21} />],
    ["Painel", (a) => <Grid c={a ? ACC : "#AAB5CC"} s={21} />],
  ];
  return (
    <div className="bottom-nav">
      {items.map(([l, ico], i) => (
        <button key={i} className={"nav-item" + (tab === i ? " on" : "")} onClick={() => go(i)}>
          {ico(tab === i)}<span>{l}</span>
        </button>
      ))}
    </div>
  );
}

/* ════════ 1. LOGIN ════════ */
function LoginScreen({ supabase }: { supabase: any }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "warn" | "info"; x: string } | null>(null);

  async function submit() {
    setMsg(null);
    if (!email.trim() || password.length < 6) { setMsg({ t: "warn", x: "Informe e-mail e senha (mín. 6 caracteres)." }); return; }
    if (mode === "signup" && fullName.trim().length < 2) { setMsg({ t: "warn", x: "Informe seu nome." }); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: fullName.trim() } } });
        if (error) throw error;
        if (!data.session) { setMsg({ t: "info", x: "Conta criada! Confirme o e-mail e faça login." }); setMode("login"); }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (e: any) { setMsg({ t: "warn", x: e?.message || "Falha na autenticação." }); }
    finally { setBusy(false); }
  }

  return (
    <div className="screen center" style={{ paddingTop: 0 }}>
      <div className="px-lg flex-col items-center" style={{ gap: 24, width: "100%", padding: "40px 32px" }}>
        <div className="text-center">
          <div style={{ width: 72, height: 72, borderRadius: 22, background: "var(--acc)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", boxShadow: "0 10px 28px var(--acc-sh)" }}>
            <Mic c="#fff" s={32} />
          </div>
          <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: -1.2 }}>Coleta</div>
          <div className="t-sub">Inteligência de mercado em campo</div>
        </div>

        <div className="flex-col" style={{ gap: 10, width: "100%" }}>
          {mode === "signup" && (
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome" />
          )}
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha" onKeyDown={(e) => e.key === "Enter" && submit()} />
          {msg && (
            <div className="warn-box" style={msg.t === "info" ? { background: "var(--acc-dim)", borderColor: "var(--acc)" } : undefined}>
              <span className="text" style={msg.t === "info" ? { color: "var(--acc)" } : undefined}>{msg.x}</span>
            </div>
          )}
        </div>

        <button className="btn" onClick={submit} disabled={busy} style={{ width: "100%" }}>
          {busy ? <span className="spinner" style={{ borderTopColor: "#fff", borderColor: "rgba(255,255,255,.4)" }} /> : mode === "login" ? "Entrar" : "Criar conta"}
        </button>
        <div style={{ fontSize: 13, color: "var(--txt2)" }}>
          {mode === "login" ? "Não tem conta? " : "Já tem conta? "}
          <span style={{ color: "var(--acc)", fontWeight: 600, cursor: "pointer" }} onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMsg(null); }}>
            {mode === "login" ? "Criar conta" : "Entrar"}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ════════ 2. CAPTURA ════════ */
function CaptureScreen({ user, text, setText, recent, onRecord, onText, tab, go, onAvatar }: any) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="screen with-nav">
      <div className="px-lg flex items-center justify-between" style={{ paddingTop: 4 }}>
        <div>
          <div className="t-title">Olá, {user.split(" ")[0]} 👋</div>
          <div className="t-sub" style={{ textTransform: "capitalize" }}>{todayLabel()}</div>
        </div>
        <div className="avatar acc-solid round" style={{ width: 40, height: 40, fontSize: 14, cursor: "pointer" }} onClick={onAvatar} title="Sair">{initials(user)}</div>
      </div>

      <div className="card-lg" style={{ margin: "18px 18px 0" }}>
        <div className="flex-col items-center" style={{ gap: 20 }}>
          <button className="mic-main" onClick={onRecord}><Mic c="#fff" s={40} /></button>
          <div className="text-center">
            <div style={{ fontSize: 17, fontWeight: 700 }}>Toque para gravar</div>
            <div className="t-sub">Suporte a PT 🇧🇷 e EN 🇬🇧 — detecção automática</div>
          </div>
          <div className="divider" style={{ width: "100%" }}><span>ou escreva</span></div>
          <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)} rows={3}
            placeholder="Descreva sua inteligência de mercado..." style={{ background: "var(--surf2)" }} />
          {text.trim() && (
            <button className="btn" onClick={onText} style={{ padding: 13, fontSize: 14, boxShadow: "0 6px 18px var(--acc-sh)" }}>Registrar texto →</button>
          )}
        </div>
      </div>

      <div className="px" style={{ marginTop: 18 }}>
        <div className="t-sub" style={{ fontWeight: 600, color: "var(--txt2)", marginBottom: 10 }}>Recentes</div>
        {recent.length === 0 ? (
          <div className="card text-center" style={{ color: "var(--txt3)", fontSize: 13, padding: 24 }}>Nenhum registro ainda</div>
        ) : (
          <div className="list-card">
            {recent.slice(0, 3).map((r: any, i: number) => (
              <div className="list-row" key={i}>
                <div className="avatar" style={{ width: 38, height: 38, fontSize: 12 }}>{(r.client_name || "?").slice(0, 2)}</div>
                <div className="info">
                  <div className="name">{r.client_name}</div>
                  <div className="meta">{r.operator_name || "—"}</div>
                </div>
                <div className="side">
                  <div style={{ fontSize: 12, color: "var(--txt3)" }}>{new Date(r.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</div>
                  <div className="chip acc sm" style={{ marginTop: 3 }}>{r.language === "en" ? "EN" : "PT"}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" style={{ minHeight: 12 }} />
      <Nav tab={tab} go={go} />
    </div>
  );
}

/* ════════ 3. GRAVANDO ════════ */
function RecordingScreen({ secs, error, onStop, onCancel }: any) {
  const heights = [6, 16, 24, 10, 30, 18, 8, 26, 20, 14, 28, 8, 22, 16, 28, 10, 20, 26, 12, 18];
  return (
    <div className="screen white center">
      <div className="flex-col items-center" style={{ gap: 32, padding: "0 32px" }}>
        <div className="waveform">
          {heights.map((h, i) => (
            <span key={i} style={{ height: h, animationDuration: `${0.55 + i * 0.045}s`, animationDelay: `${i * 0.05}s` }} />
          ))}
        </div>
        <div style={{ fontSize: 58, fontWeight: 900, letterSpacing: -3, fontVariantNumeric: "tabular-nums" }}>{fmtTime(secs)}</div>
        <div className="flex items-center" style={{ gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--err)", animation: "dotblink 1s infinite" }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--err)", letterSpacing: .5 }}>Gravando</span>
        </div>
        <button className="stop-btn" onClick={onStop} style={{ marginTop: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--err)" }} />
        </button>
        <div className="t-sub">Toque para parar</div>
        {error && <div className="warn-box" style={{ maxWidth: 280 }}><WarnIcon /><span className="text">{error} <span style={{ color: "var(--acc)", fontWeight: 600, cursor: "pointer" }} onClick={onCancel}>Voltar</span></span></div>}
      </div>
    </div>
  );
}

/* ════════ 4. PROCESSANDO ════════ */
function ProcessingScreen() {
  return (
    <div className="screen white center">
      <div className="flex-col items-center" style={{ gap: 26, padding: "0 40px", animation: "fadeIn .3s ease" }}>
        <span className="spinner lg" />
        <div className="text-center">
          <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 8 }}>IA processando...</div>
          <div className="t-sub" style={{ lineHeight: 1.65 }}>Transcrevendo áudio e identificando<br />cliente e operador automaticamente</div>
        </div>
        <div className="flex" style={{ gap: 8 }}>
          {["Whisper", "GPT-4o mini"].map((l) => <div key={l} className="chip acc" style={{ padding: "5px 12px", borderRadius: 20 }}>{l}</div>)}
        </div>
      </div>
    </div>
  );
}

/* ════════ 5. CONFIRMAR ════════ */
function ConfirmScreen({ data, draft, detected, matches, onBack, onSave }: any) {
  const [client, setClient] = useState(data.client);
  const [operator, setOperator] = useState(data.operator);
  const [clientFocus, setClientFocus] = useState(true);

  const norm = (s: string) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const clientSimilar = (matches?.client || []).find((m: any) => !m.exact);
  const [warnDismissed, setWarnDismissed] = useState(false);

  return (
    <div className="screen">
      <div className="flex items-center px" style={{ gap: 12, paddingTop: 4, paddingBottom: 14 }}>
        <button className="btn-icon" onClick={onBack}><Back /></button>
        <div className="flex-1">
          <div className="t-caps" style={{ marginBottom: 2 }}>Passo 2 de 2</div>
          <div className="t-head">Confirmar registro</div>
        </div>
        <div className="chip lang">{langBadge(data.lang)}</div>
      </div>

      <div className="card" style={{ margin: "0 18px 14px" }}>
        <div className="t-caps">Transcrição</div>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: data.transcript ? "var(--txt)" : "var(--txt3)" }}>
          {data.transcript || (draft.transcriptionFailed ? "Áudio salvo — transcrição pendente. Preencha os campos manualmente." : "—")}
        </div>
      </div>

      {draft.transcriptionFailed && (
        <div className="px" style={{ marginBottom: 12 }}>
          <div className="warn-box"><WarnIcon /><span className="text">O áudio foi salvo com segurança e não será perdido. A transcrição pode ser refeita depois.</span></div>
        </div>
      )}

      <div className="px flex-col" style={{ gap: 14 }}>
        {/* Cliente */}
        <div>
          <div className="flex items-center" style={{ gap: 7, marginBottom: 7 }}>
            <div className="t-label" style={{ margin: 0 }}>Cliente</div>
            {detected?.client && <div className="chip acc sm">Sugerido por IA</div>}
          </div>
          <input value={client} onChange={(e) => { setClient(e.target.value); setWarnDismissed(true); }}
            onFocus={() => setClientFocus(true)} onBlur={() => setClientFocus(false)}
            className={clientFocus ? "input-focused" : ""} placeholder="Nome do cliente" />
          <AutoCheck label="cliente" value={client} detected={detected?.client} list={matches?.client} onPick={setClient} norm={norm} />
          {clientSimilar && !warnDismissed && norm(client) !== norm(clientSimilar.name) && (
            <div className="warn-box" onClick={() => { setClient(clientSimilar.name); setWarnDismissed(true); }}>
              <WarnIcon />
              <span className="text">Similar encontrado: “{clientSimilar.name}” ({clientSimilar.count} reg.) — é o mesmo?</span>
              <span style={{ fontSize: 14, color: "var(--txt3)" }} onClick={(e) => { e.stopPropagation(); setWarnDismissed(true); }}>×</span>
            </div>
          )}
        </div>
        {/* Operador */}
        <div>
          <div className="flex items-center" style={{ gap: 7, marginBottom: 7 }}>
            <div className="t-label" style={{ margin: 0 }}>Operador</div>
            {detected?.operator && <div className="chip acc sm">Sugerido por IA</div>}
          </div>
          <input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="Nome do operador" />
          <AutoCheck label="operador" value={operator} detected={detected?.operator} list={matches?.operator} onPick={setOperator} norm={norm} />
        </div>
      </div>

      <div className="flex-1" style={{ minHeight: 16 }} />
      <div className="px" style={{ paddingBottom: 24 }}>
        <button className="btn" onClick={() => onSave(client, operator)}>Salvar registro</button>
      </div>
    </div>
  );
}

function AutoCheck({ label, value, detected, list, onPick, norm }: any) {
  if (!detected) return null;
  const items = (list || []) as any[];
  if (items.length === 0) {
    return <div className="autocheck"><span className="ac-label">nenhum {label} parecido — será criado novo ✨</span></div>;
  }
  const valueExists = items.some((m) => norm(m.name) === norm(value || ""));
  const exact = items.find((m) => m.exact);
  return (
    <div className="autocheck">
      <span className="ac-label">{exact ? "✓ já existe:" : "parecidos:"}</span>
      {items.map((m) => (
        <button key={m.name} type="button" className={"ac-chip" + (norm(m.name) === norm(value || "") ? " on" : "")} onClick={() => onPick(m.name)}>
          {m.name} <i>· {m.count}</i>
        </button>
      ))}
      {!valueExists && <button type="button" className="ac-chip new" onClick={() => onPick(detected)}>+ criar “{detected}”</button>}
    </div>
  );
}

/* ════════ 6. SALVO ════════ */
function SavedScreen({ data, onNew, onSummary }: any) {
  const rows: [string, string][] = [
    ["Cliente", data.client],
    ["Operador", data.operator || "—"],
    ["Idioma", data.lang === "en" ? "English 🇬🇧" : "Português 🇧🇷"],
    ["Gravado por", data.by],
    ["Data", data.date],
  ];
  return (
    <div className="screen white center">
      <div className="flex-col items-center" style={{ gap: 22, padding: "0 32px", width: "100%" }}>
        <Check />
        <div className="text-center">
          <div className="t-title">Registro salvo!</div>
          <div className="t-sub">{data.audioSaved ? "Áudio preservado no Storage · " : ""}Confirmado</div>
        </div>
        <div style={{ width: "100%", background: "var(--bg)", borderRadius: 18, padding: 16 }} className="flex-col">
          {rows.map(([l, v], i) => (
            <div key={i} className="flex items-center justify-between" style={{ paddingBottom: i < rows.length - 1 ? 10 : 0, borderBottom: i < rows.length - 1 ? "1px solid var(--brd)" : "none", marginTop: i ? 0 : 0 }}>
              <span style={{ fontSize: 12, color: "var(--txt2)" }}>{l}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
        <button className="btn-ghost" onClick={onSummary}>Ver resumo de {data.client} →</button>
        <button className="btn" onClick={onNew} style={{ padding: 14, fontSize: 14, boxShadow: "0 8px 20px var(--acc-sh)" }}>Nova gravação</button>
      </div>
    </div>
  );
}

/* ════════ 7. BUSCAR ════════ */
function SearchScreen({ entities, onResult, tab, go }: any) {
  const [q, setQ] = useState("");
  const results = q.trim() ? entities.filter((d: any) => d.name.toLowerCase().includes(q.toLowerCase())) : entities;
  return (
    <div className="screen with-nav">
      <div className="px" style={{ paddingTop: 4, paddingBottom: 14 }}>
        <div className="t-title" style={{ marginBottom: 14 }}>Buscar</div>
        <div className="search-wrap">
          <span className="s-icon"><Lupa c="#AAB5CC" s={18} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente ou operador..."
            onKeyDown={(e) => e.key === "Enter" && (results[0] ? onResult(results[0].name) : q.trim() && onResult(q.trim()))} />
        </div>
      </div>
      <div className="px flex-1">
        <div className="t-sub" style={{ fontWeight: 600, color: "var(--txt2)", marginBottom: 10 }}>
          {q ? `${results.length} resultado${results.length !== 1 ? "s" : ""}` : `${entities.length} contatos`}
        </div>
        <div className="list-card">
          {results.length === 0 ? (
            <div className="text-center" style={{ padding: 32, color: "var(--txt3)", fontSize: 13 }}>
              {q.trim() ? <>Nenhum cadastrado. <span style={{ color: "var(--acc)", fontWeight: 600, cursor: "pointer" }} onClick={() => onResult(q.trim())}>Buscar “{q.trim()}”</span></> : "Nenhum contato ainda"}
            </div>
          ) : results.map((r: any, i: number) => (
            <div className="list-row" key={i} style={{ cursor: "pointer" }} onClick={() => onResult(r.name)}>
              <div className={"avatar" + (r.role === "operador" ? " ok" : "")} style={{ width: 42, height: 42, fontSize: 13 }}>{r.name.slice(0, 2)}</div>
              <div className="info">
                <div className="name">{r.name}</div>
                <div className="meta">{r.entries} registro{r.entries !== 1 ? "s" : ""}</div>
              </div>
              <div className={"chip " + (r.role === "operador" ? "ok" : "acc")}>{r.role}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1" style={{ minHeight: 12 }} />
      <Nav tab={tab} go={go} />
    </div>
  );
}

/* ════════ 8. RESUMO (lookup) ════════ */
function SummaryScreen({ data, onBack }: any) {
  if (!data || data.loading) {
    return <div className="screen white center"><div className="flex-col items-center" style={{ gap: 18 }}><span className="spinner lg" /><div className="t-sub">Reunindo informações sobre {data?.name}…</div></div></div>;
  }
  if (data.error) {
    return (
      <div className="screen">
        <div className="flex items-center px" style={{ gap: 12, paddingTop: 4, paddingBottom: 16 }}>
          <button className="btn-icon" onClick={onBack}><Back /></button>
          <div className="t-head flex-1">{data.name}</div>
        </div>
        <div className="px"><div className="warn-box"><WarnIcon /><span className="text">{data.error}</span></div></div>
      </div>
    );
  }
  const roles = data.roles || { asClient: 0, asOperator: 0 };
  const isClient = roles.asClient >= roles.asOperator;
  const records = data.records || [];
  return (
    <div className="screen" style={{ animation: "slideIn .22s ease both" }}>
      <div className="flex items-center px" style={{ gap: 12, paddingTop: 4, paddingBottom: 16 }}>
        <button className="btn-icon" onClick={onBack}><Back /></button>
        <div className="t-head flex-1">{data.name}</div>
        <div className={"chip " + (isClient ? "acc" : "ok")}>{isClient ? "cliente" : "operador"}</div>
      </div>

      {records.length === 0 ? (
        <div className="px"><div className="card"><div className="t-sub">{data.summary}</div></div></div>
      ) : (
        <>
          <div className="card" style={{ margin: "0 18px 14px" }}>
            <div className="flex items-center" style={{ gap: 8, marginBottom: 10 }}>
              <div className="chip acc" style={{ padding: "3px 10px", borderRadius: 20 }}>✦ Resumo IA</div>
              <div style={{ fontSize: 11, color: "var(--txt3)" }}>{data.stats?.total || records.length} registros</div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{data.summary}</div>
          </div>

          <div className="px flex-1">
            <div className="t-sub" style={{ fontWeight: 600, color: "var(--txt2)", marginBottom: 10 }}>Histórico de registros</div>
            <div className="list-card">
              {records.map((r: any, i: number) => (
                <div key={r.id || i} style={{ padding: "13px 16px", borderTop: i ? "1px solid var(--brd)" : "none" }}>
                  <div className="flex justify-between" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{r.client_name}{r.operator_name ? ` · ${r.operator_name}` : ""}</span>
                    <span style={{ fontSize: 11, color: "var(--txt3)" }}>{new Date(r.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.55 }}>{r.transcript || "(áudio salvo — transcrição pendente)"}</div>
                  <div style={{ fontSize: 11, color: "var(--txt3)", marginTop: 5 }}>por {r.recorded_by} {r.source === "audio" ? "🎤" : "✍️"}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      <div style={{ height: 24 }} />
    </div>
  );
}

/* ════════ 9. DASHBOARD ════════ */
function DashboardScreen({ stats, onEntity, tab, go }: any) {
  const t = stats?.totals || {};
  const recent = stats?.recent || [];
  const top = stats?.byRecorder || [];
  const maxTop = Math.max(1, ...top.map((x: any) => x.count));
  const kpis = [
    { v: t.records ?? 0, l: "Registros", hi: true },
    { v: t.clients ?? 0, l: "Clientes" },
    { v: t.recorders ?? 0, l: "Coletores" },
  ];
  return (
    <div className="screen with-nav">
      <div className="px-lg flex justify-between items-center" style={{ paddingTop: 4, paddingBottom: 16 }}>
        <div>
          <div className="t-title">Dashboard</div>
          <div className="t-sub" style={{ textTransform: "capitalize" }}>{todayLabel()}</div>
        </div>
        <div className="chip acc" style={{ padding: "5px 12px" }}>Minha equipe</div>
      </div>

      <div className="kpis px" style={{ paddingBottom: 16 }}>
        {kpis.map((s, i) => (
          <div key={i} className={"kpi" + (s.hi ? " hi" : "")}>
            <div className="n">{s.v}</div><div className="l">{s.l}</div>
          </div>
        ))}
      </div>

      {t.pendingTranscriptions > 0 && (
        <div className="px" style={{ paddingBottom: 14 }}>
          <div className="warn-box" style={{ cursor: "default" }}><WarnIcon /><span className="text">{t.pendingTranscriptions} áudio(s) com transcrição pendente — preservados para nova tentativa.</span></div>
        </div>
      )}

      <div className="px flex-1">
        <div className="t-sub" style={{ fontWeight: 600, color: "var(--txt2)", marginBottom: 10 }}>Atividade recente</div>
        {recent.length === 0 ? (
          <div className="card text-center" style={{ color: "var(--txt3)", fontSize: 13, padding: 24 }}>Sem atividade ainda</div>
        ) : (
          <div className="list-card">
            {recent.slice(0, 4).map((r: any, i: number) => (
              <div className="list-row" key={i} style={{ cursor: "pointer" }} onClick={() => onEntity(r.client_name)}>
                <div className="avatar" style={{ width: 38, height: 38, fontSize: 12 }}>{(r.client_name || "?").slice(0, 2)}</div>
                <div className="info">
                  <div className="name">{r.client_name}</div>
                  <div className="meta">{r.operator_name || "—"} · {r.source === "audio" ? "🎤" : "✍️"}</div>
                </div>
                <div style={{ fontSize: 12, color: "var(--txt3)" }}>{new Date(r.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {top.length > 0 && (
        <div className="px" style={{ paddingTop: 16, paddingBottom: 8 }}>
          <div className="t-sub" style={{ fontWeight: 600, color: "var(--txt2)", marginBottom: 10 }}>Top usuários</div>
          {top.slice(0, 5).map((r: any, i: number) => (
            <div key={i} className="flex items-center" style={{ gap: 10, marginBottom: 10 }}>
              <div className="avatar round" style={{ width: 30, height: 30, fontSize: 10 }}>{initials(r.name)}</div>
              <div className="flex-1">
                <div className="flex justify-between" style={{ marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: "var(--txt2)" }}>{r.count} reg.</span>
                </div>
                <div className="prog"><div className={"fill" + (i === 0 ? "" : " dim")} style={{ width: `${Math.round((r.count / maxTop) * 100)}%` }} /></div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Nav tab={tab} go={go} />
    </div>
  );
}
