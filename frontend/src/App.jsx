import { useState, useEffect, useRef } from "react";
import { api } from "./api.js";

/* ── Theme Tokens ── */
const O = "#e8731a";
const OL = "#f59542";
const OD = "rgba(232,115,26,0.15)";
const BG = "#0d0e10";
const C1 = "#161820";
const C2 = "#1c1e28";
const INP = "#1a1c24";
const BD = "#2a2c36";
const T1 = "#e8e8e8";
const T2 = "#8a8c96";
const TM = "#5a5c66";
const OK = "#2ecc71";
const ERR = "#e74c3c";
const WARN = "#f39c12";

const CATEGORIES = ["Hardware", "Software", "Network", "Access", "Email", "Other"];
const PRIORITIES = ["Low", "Medium", "High", "Critical"];
const STATUSES = ["Open", "In Progress", "Resolved", "Closed"];

const pColor = (p) =>
  p === "Critical" ? ERR : p === "High" ? WARN : p === "Medium" ? O : OK;
const sColor = (s) =>
  s === "Open" ? O : s === "In Progress" ? WARN : s === "Resolved" ? OK : TM;

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/* ── Tiny Components ── */

function Badge({ children, color }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        background: color + "22",
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {children}
    </span>
  );
}

function Btn({ children, onClick, variant = "primary", disabled, style }) {
  const v = {
    primary: {
      background: `linear-gradient(135deg, ${O}, ${OL})`,
      color: "#000",
    },
    secondary: { background: C2, color: T1, border: `1px solid ${BD}` },
    ghost: { background: "transparent", color: O, border: `1px solid ${O}44` },
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        border: "none",
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "'Rajdhani', sans-serif",
        fontWeight: 700,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        padding: "10px 24px",
        fontSize: 14,
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        transition: "all 0.2s",
        ...v[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, value, onChange, placeholder, required, textarea, rows }) {
  const Tag = textarea ? "textarea" : "input";
  return (
    <div style={{ marginBottom: 16 }}>
      {label && (
        <label
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            color: T2,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 6,
            fontFamily: "'Rajdhani', sans-serif",
          }}
        >
          {label}
          {required && <span style={{ color: O }}> *</span>}
        </label>
      )}
      <Tag
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows || 4}
        style={{
          width: "100%",
          padding: "10px 14px",
          background: INP,
          border: `1px solid ${BD}`,
          borderRadius: 8,
          color: T1,
          fontSize: 14,
          fontFamily: "'Rajdhani', sans-serif",
          outline: "none",
          resize: textarea ? "vertical" : undefined,
          boxSizing: "border-box",
        }}
        onFocus={(e) => (e.target.style.borderColor = O)}
        onBlur={(e) => (e.target.style.borderColor = BD)}
      />
    </div>
  );
}

function Sel({ label, value, onChange, options, required, style }) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      {label && (
        <label
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            color: T2,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 6,
            fontFamily: "'Rajdhani', sans-serif",
          }}
        >
          {label}
          {required && <span style={{ color: O }}> *</span>}
        </label>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 14px",
          background: INP,
          border: `1px solid ${BD}`,
          borderRadius: 8,
          color: T1,
          fontSize: 14,
          fontFamily: "'Rajdhani', sans-serif",
          outline: "none",
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ── Thread Comment ── */

function Comment({ c }) {
  const ai = c.isAI;
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: 12,
        borderLeft: `2px solid ${ai ? O : BD}`,
        marginLeft: ai ? 20 : 0,
        background: ai ? OD : "transparent",
        borderRadius: "0 8px 8px 0",
        marginBottom: 4,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: ai ? `linear-gradient(135deg,${O},${OL})` : C2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          color: ai ? "#000" : T2,
          flexShrink: 0,
          border: ai ? "none" : `1px solid ${BD}`,
        }}
      >
        {ai ? "AI" : (c.author?.[0] || "U").toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: ai ? O : T1,
              fontFamily: "'Rajdhani', sans-serif",
            }}
          >
            {ai ? "AI Assistant" : c.author || "You"}
          </span>
          <span style={{ fontSize: 11, color: TM }}>{fmtDate(c.time)}</span>
        </div>
        <p
          style={{
            fontSize: 13,
            color: T2,
            margin: 0,
            lineHeight: 1.5,
            wordBreak: "break-word",
          }}
        >
          {c.text}
        </p>
      </div>
    </div>
  );
}

/* ── Ticket Detail ── */

function Detail({ ticket, onBack, onRefresh }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(ticket.status);
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [ticket.thread]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.addComment(ticket.id, text, "You");
      setText("");
      onRefresh();
    } catch (e) {
      console.error(e);
    }
    setSending(false);
  };

  const changeStatus = async (s) => {
    setStatus(s);
    await api.updateTicket(ticket.id, { status: s });
    onRefresh();
  };

  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      <button
        onClick={onBack}
        style={{
          background: "none",
          border: "none",
          color: O,
          cursor: "pointer",
          fontSize: 14,
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 20,
          padding: 0,
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        ← Back to Tickets
      </button>

      <div
        style={{
          background: C1,
          borderRadius: 12,
          border: `1px solid ${BD}`,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: 24,
            borderBottom: `1px solid ${BD}`,
            background: `linear-gradient(135deg,${C1},${C2})`,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <span
                style={{
                  fontSize: 12,
                  color: TM,
                  fontFamily: "'Rajdhani', sans-serif",
                  fontWeight: 600,
                }}
              >
                {ticket.id}
              </span>
              <h2
                style={{
                  fontSize: 22,
                  color: T1,
                  margin: "4px 0 8px",
                  fontFamily: "'Rajdhani', sans-serif",
                  fontWeight: 700,
                }}
              >
                {ticket.title}
              </h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Badge color={pColor(ticket.priority)}>{ticket.priority}</Badge>
                <Badge color={sColor(ticket.status)}>{ticket.status}</Badge>
                <Badge color={TM}>{ticket.category}</Badge>
              </div>
            </div>
            <Sel
              value={status}
              onChange={changeStatus}
              options={STATUSES}
              style={{ marginBottom: 0, minWidth: 140 }}
            />
          </div>
          <p style={{ fontSize: 14, color: T2, marginTop: 16, lineHeight: 1.6 }}>
            {ticket.description}
          </p>
          <span style={{ fontSize: 12, color: TM }}>{fmtDate(ticket.created)}</span>
        </div>

        {/* AI suggestion */}
        {ticket.aiResponse && (
          <div
            style={{
              padding: "16px 24px",
              borderBottom: `1px solid ${BD}`,
              background: OD,
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: `linear-gradient(135deg,${O},${OL})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                color: "#000",
                flexShrink: 0,
              }}
            >
              AI
            </div>
            <div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: O,
                  fontFamily: "'Rajdhani', sans-serif",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Quick AI Suggestion
              </span>
              <p style={{ fontSize: 14, color: T1, margin: "4px 0 0", lineHeight: 1.5 }}>
                {ticket.aiResponse}
              </p>
              <p style={{ fontSize: 12, color: TM, margin: "6px 0 0" }}>
                ✓ Ticket submitted — IT team will contact you shortly.
              </p>
            </div>
          </div>
        )}

        {/* Thread */}
        <div style={{ padding: "20px 24px" }}>
          <h3
            style={{
              fontSize: 14,
              color: T2,
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 16,
            }}
          >
            Thread ({(ticket.thread || []).length} comments)
          </h3>

          <div ref={ref} style={{ maxHeight: 400, overflowY: "auto", marginBottom: 16 }}>
            {(ticket.thread || []).length === 0 ? (
              <p
                style={{
                  fontSize: 13,
                  color: TM,
                  textAlign: "center",
                  padding: 20,
                }}
              >
                No comments yet. Start the conversation below.
              </p>
            ) : (
              (ticket.thread || []).map((c, i) => <Comment key={i} c={c} />)
            )}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Add a comment to this thread..."
                rows={2}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  background: INP,
                  border: `1px solid ${BD}`,
                  borderRadius: 8,
                  color: T1,
                  fontSize: 14,
                  fontFamily: "'Rajdhani', sans-serif",
                  outline: "none",
                  resize: "none",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => (e.target.style.borderColor = O)}
                onBlur={(e) => (e.target.style.borderColor = BD)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
            </div>
            <Btn onClick={send} disabled={!text.trim() || sending}>
              {sending ? "..." : "Send"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── New Ticket Modal ── */

function NewTicket({ onCreated, onCancel }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState("Software");
  const [pri, setPri] = useState("Medium");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || !desc.trim()) return;
    setBusy(true);
    try {
      const ticket = await api.createTicket({
        title,
        description: desc,
        category: cat,
        priority: pri,
      });
      onCreated(ticket);
    } catch (e) {
      console.error(e);
    }
    setBusy(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
        animation: "fadeIn .2s ease",
      }}
    >
      <div
        style={{
          background: C1,
          borderRadius: 16,
          border: `1px solid ${BD}`,
          width: "100%",
          maxWidth: 540,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: `0 20px 60px rgba(0,0,0,0.5)`,
        }}
      >
        <div
          style={{
            padding: "24px 24px 16px",
            borderBottom: `1px solid ${BD}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2
            style={{
              fontSize: 20,
              color: T1,
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 700,
              margin: 0,
            }}
          >
            <span style={{ color: O }}>+</span> New Ticket
          </h2>
          <button
            onClick={onCancel}
            style={{
              background: "none",
              border: "none",
              color: TM,
              cursor: "pointer",
              fontSize: 20,
              padding: "4px 8px",
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: 24 }}>
          <Field
            label="Title"
            value={title}
            onChange={setTitle}
            placeholder="Brief description of the issue"
            required
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Sel label="Category" value={cat} onChange={setCat} options={CATEGORIES} required />
            <Sel label="Priority" value={pri} onChange={setPri} options={PRIORITIES} required />
          </div>
          <Field
            label="Description"
            value={desc}
            onChange={setDesc}
            placeholder="Detailed description of the issue..."
            textarea
            rows={5}
            required
          />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <Btn variant="secondary" onClick={onCancel}>
              Cancel
            </Btn>
            <Btn onClick={submit} disabled={!title.trim() || !desc.trim() || busy}>
              {busy ? "⚡ AI Analyzing..." : "Submit Ticket"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Stat Card ── */

function Stat({ label, value }) {
  return (
    <div
      style={{
        background: C1,
        borderRadius: 12,
        border: `1px solid ${BD}`,
        padding: 20,
        flex: "1 1 150px",
        minWidth: 140,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: TM,
          textTransform: "uppercase",
          letterSpacing: 1,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: O, marginTop: 4 }}>{value}</div>
    </div>
  );
}

/* ── Main App ── */

export default function App() {
  const [tickets, setTickets] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await api.getTickets();
      setTickets(data);
    } catch (e) {
      console.error("Failed to load tickets:", e);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // Re-fetch when navigating to detail or back
  const refresh = () => load();

  const filtered = tickets.filter((t) => {
    const mf = filter === "All" || t.status === filter;
    const ms =
      !search ||
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.id.toLowerCase().includes(search.toLowerCase());
    return mf && ms;
  });

  const cur = tickets.find((t) => t.id === selected);
  const openC = tickets.filter((t) => t.status === "Open").length;
  const ipC = tickets.filter((t) => t.status === "In Progress").length;
  const resC = tickets.filter(
    (t) => t.status === "Resolved" || t.status === "Closed"
  ).length;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: BG,
        color: T1,
        fontFamily: "'Rajdhani', sans-serif",
      }}
    >
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        select option{background:${INP};color:${T1}}
      `}</style>

      {/* Header */}
      <header
        style={{
          padding: "16px 28px",
          borderBottom: `1px solid ${BD}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: `linear-gradient(180deg,${C1},${BG})`,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: `linear-gradient(135deg,${O},${OL})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 700,
              color: "#000",
            }}
          >
            M
          </div>
          <div>
            <h1
              style={{
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                lineHeight: 1,
              }}
            >
              <span style={{ color: O }}>Mindstorm</span>{" "}
              <span style={{ color: T1 }}>IT Desk</span>
            </h1>
            <span
              style={{
                fontSize: 11,
                color: TM,
                letterSpacing: 3,
                textTransform: "uppercase",
              }}
            >
              Support Ticketing System
            </span>
          </div>
        </div>
        <Btn onClick={() => setShowNew(true)}>+ New Ticket</Btn>
      </header>

      <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: TM }}>
            <div
              style={{
                width: 40,
                height: 40,
                border: `3px solid ${BD}`,
                borderTopColor: O,
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                margin: "0 auto 16px",
              }}
            />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <p style={{ fontSize: 16, fontWeight: 600 }}>Loading tickets...</p>
          </div>
        ) : cur ? (
          <Detail
            ticket={cur}
            onBack={() => {
              setSelected(null);
              refresh();
            }}
            onRefresh={refresh}
          />
        ) : (
          <>
            {/* Stats */}
            <div
              style={{
                display: "flex",
                gap: 14,
                marginBottom: 24,
                flexWrap: "wrap",
              }}
            >
              <Stat label="Open" value={openC} />
              <Stat label="In Progress" value={ipC} />
              <Stat label="Resolved" value={resC} />
              <Stat label="Total" value={tickets.length} />
            </div>

            {/* Filters */}
            <div
              style={{
                display: "flex",
                gap: 12,
                marginBottom: 20,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["All", ...STATUSES].map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    style={{
                      padding: "6px 16px",
                      borderRadius: 20,
                      border: `1px solid ${filter === s ? O : BD}`,
                      background: filter === s ? OD : "transparent",
                      color: filter === s ? O : T2,
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "'Rajdhani', sans-serif",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      transition: "all 0.2s",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tickets..."
                style={{
                  padding: "8px 14px",
                  background: INP,
                  border: `1px solid ${BD}`,
                  borderRadius: 20,
                  color: T1,
                  fontSize: 13,
                  fontFamily: "'Rajdhani', sans-serif",
                  outline: "none",
                  flex: "1 1 200px",
                  minWidth: 160,
                }}
              />
            </div>

            {/* Ticket list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 20px", color: TM }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                  <p style={{ fontSize: 16, fontWeight: 600 }}>No tickets found</p>
                  <p style={{ fontSize: 13 }}>Create a new ticket to get started.</p>
                </div>
              ) : (
                filtered.map((t, i) => (
                  <div
                    key={t.id}
                    onClick={() => setSelected(t.id)}
                    style={{
                      background: C1,
                      borderRadius: 10,
                      border: `1px solid ${BD}`,
                      padding: "16px 20px",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      animation: `fadeIn .3s ease ${i * 0.05}s both`,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = O + "66";
                      e.currentTarget.style.background = C2;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = BD;
                      e.currentTarget.style.background = C1;
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          marginBottom: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: 11, color: TM, fontWeight: 600 }}>{t.id}</span>
                        <Badge color={pColor(t.priority)}>{t.priority}</Badge>
                        <Badge color={sColor(t.status)}>{t.status}</Badge>
                      </div>
                      <h3
                        style={{
                          fontSize: 16,
                          fontWeight: 700,
                          color: T1,
                          margin: "0 0 4px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.title}
                      </h3>
                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: 12, color: TM }}>{t.category}</span>
                        <span style={{ fontSize: 12, color: TM }}>{fmtDate(t.created)}</span>
                        {(t.thread || []).length > 0 && (
                          <span style={{ fontSize: 12, color: O }}>
                            💬 {t.thread.length}
                          </span>
                        )}
                      </div>
                    </div>
                    <span style={{ color: TM, fontSize: 18 }}>→</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {showNew && (
        <NewTicket
          onCreated={(t) => {
            setShowNew(false);
            refresh();
            setSelected(t.id);
          }}
          onCancel={() => setShowNew(false)}
        />
      )}
    </div>
  );
}
