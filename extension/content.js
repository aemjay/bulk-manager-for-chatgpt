(() => {
  if (window.__cgbm) return;
  window.__cgbm = true;

  /* =========================================================
   * API
   * ======================================================= */
  const PRIVACY_URL = "https://aemjay.github.io/bulk-manager-for-chatgpt/privacy.html";
  const ORIGIN = location.origin;
  const API = ORIGIN + "/backend-api";
  const DAY = 864e5;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Aktuelle Sitzung: Token plus stabile Identität (Nutzer + Konto). Wird nie persistiert.
  let session = null;

  class HttpError extends Error {
    constructor(status, retryAfter) {
      super("HTTP " + status);
      this.status = status;
      this.retryAfter = retryAfter;
    }
  }

  class SessionChanged extends Error {
    constructor() {
      super("Konto oder Sitzung hat sich geändert.");
      this.sessionChanged = true;
    }
  }

  // Liest die Sitzung immer frisch vom Server. Identität = Nutzer-ID + Konto-ID; fehlen beide,
  // dient das Token selbst als Identität (dann gilt jeder Tokenwechsel als Sitzungswechsel).
  async function fetchSession() {
    session = null;
    const r = await fetch(ORIGIN + "/api/auth/session", { credentials: "include", cache: "no-store" });
    if (!r.ok) throw new Error(`Sitzung nicht lesbar (HTTP ${r.status}).`);
    const j = await r.json().catch(() => ({}));
    if (!j.accessToken) throw new Error("Nicht angemeldet. Bitte ChatGPT neu laden.");
    const uid = (j.user && (j.user.id || j.user.email)) || "";
    const acc = (j.account && (j.account.id || j.account.account_id)) || "";
    return (session = { token: j.accessToken, identity: uid ? `u:${uid}|a:${acc}` : `t:${j.accessToken}` });
  }
  const getSession = () => session || fetchSession();
  const sameIdentity = (a, b) => !!a && !!b && a === b;

  function deviceId() {
    const m = document.cookie.match(/(?:^|; )oai-did=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // expect: Identität, unter der die Anfrage laufen MUSS (für Schreibaufrufe). Passt die aktuelle
  // Sitzung nicht, wird gar nicht erst gesendet. Nach 401 wird nur bei gleicher Identität wiederholt.
  async function api(path, opts = {}, { expect = null, retried = false } = {}) {
    const s = await getSession();
    if (expect && !sameIdentity(s.identity, expect)) throw new SessionChanged();
    const headers = {
      Authorization: "Bearer " + s.token,
      "Content-Type": "application/json",
    };
    const did = deviceId();
    if (did) headers["oai-device-id"] = did;
    const r = await fetch(API + path, { credentials: "include", ...opts, headers });
    if (r.status === 401 && !retried) {
      const fresh = await fetchSession();
      if (!sameIdentity(fresh.identity, s.identity)) throw new SessionChanged();
      return api(path, opts, { expect, retried: true });
    }
    if (!r.ok) {
      const ra = parseFloat(r.headers.get("retry-after"));
      throw new HttpError(r.status, isNaN(ra) ? null : ra * 1000);
    }
    return r.status === 204 ? null : r.json().catch(() => null);
  }

  // Adaptive Drosselung: wird bei 429 langsamer, erholt sich bei Erfolg.
  const pacer = { delay: 300, min: 300, max: 8000 };

  async function patchConversation(id, body, expect) {
    for (let attempt = 0; ; attempt++) {
      try {
        await api(`/conversation/${id}`, { method: "PATCH", body: JSON.stringify(body) }, { expect });
        pacer.delay = Math.max(pacer.min, pacer.delay * 0.85);
        return;
      } catch (e) {
        if (e.sessionChanged) throw e;
        const retriable = !e.status || e.status === 429 || e.status >= 500;
        if (!retriable || attempt >= 4) throw e;
        if (e.status === 429) pacer.delay = Math.min(pacer.max, pacer.delay * 2);
        await sleep(e.retryAfter ?? Math.min(30000, 1000 * 2 ** attempt + Math.random() * 400));
      }
    }
  }

  const toMs = (v) =>
    v == null ? 0 : typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v) || 0;

  const normalize = (it) => ({
    id: it.id,
    title: (it.title || "").trim() || "Ohne Titel",
    t: toMs(it.update_time) || toMs(it.create_time),
    pinned: !!(it.is_starred || it.pinned_time || it.is_pinned),
    project: typeof it.gizmo_id === "string" && it.gizmo_id.startsWith("g-p-"),
  });

  async function fetchList(archived, onProgress, expect) {
    const out = [];
    const limit = 100;
    let offset = 0;
    for (;;) {
      const j = await api(
        `/conversations?offset=${offset}&limit=${limit}&order=updated&is_archived=${archived}`,
        {},
        { expect }
      );
      const items = (j && j.items) || [];
      out.push(...items);
      const total = j && typeof j.total === "number" ? j.total : null;
      onProgress && onProgress(out.length, total);
      if (items.length < limit || (total != null && out.length >= total)) break;
      offset += items.length;
    }
    const seen = new Set();
    return out
      .filter((i) => i && i.id && !seen.has(i.id) && seen.add(i.id))
      .map(normalize)
      .sort((a, b) => b.t - a.t);
  }

  /* =========================================================
   * Helpers
   * ======================================================= */
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const startOfDay = (ms) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  function groupOf(t, now) {
    if (!t) return "Unbekannt";
    const d0 = startOfDay(now);
    if (t >= d0) return "Heute";
    if (t >= d0 - DAY) return "Gestern";
    if (t >= d0 - 7 * DAY) return "Letzte 7 Tage";
    if (t >= d0 - 30 * DAY) return "Letzte 30 Tage";
    return new Date(t).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  }

  function fmtTime(t, now) {
    if (!t) return "";
    const d = new Date(t);
    if (t >= startOfDay(now)) return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    if (d.getFullYear() === new Date(now).getFullYear())
      return d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }

  const plural = (n, one, many) => `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`;

  function fmtDuration(ms) {
    const s = Math.max(1, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    return `${Math.round(s / 60)} min`;
  }

  // Sammelauswahl wählt nie angeheftete Chats hinzu (manuell bleiben sie wählbar und abwählbar).
  const unpinned = (items) => items.filter((i) => !i.pinned);

  const nativeHidden = new Map(); // id -> [Element, vorheriges display]
  function hideInNativeSidebar(id) {
    document.querySelectorAll(`a[href$="/c/${CSS.escape(id)}"]`).forEach((a) => {
      const el = a.closest("li") || a;
      if (!nativeHidden.has(id)) nativeHidden.set(id, []);
      nativeHidden.get(id).push([el, el.style.display]);
      el.style.display = "none";
    });
  }
  // true, wenn der Eintrag von uns ausgeblendet war und wieder sichtbar ist
  function restoreInNativeSidebar(id) {
    const list = nativeHidden.get(id);
    if (!list) return false;
    list.forEach(([el, d]) => (el.style.display = d));
    nativeHidden.delete(id);
    return true;
  }

  const storage = {
    get(key, def) {
      return new Promise((res) => {
        try {
          chrome.storage.local.get(key, (v) => res(v && key in v ? v[key] : def));
        } catch {
          res(def);
        }
      });
    },
    set(key, val) {
      try {
        chrome.storage.local.set({ [key]: val });
      } catch {}
    },
  };

  /* =========================================================
   * Icons
   * ======================================================= */
  const svg = (d, size = 16) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    refresh: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
    archive: svg('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>'),
    trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/>'),
    restore: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    pin: svg('<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3v2H7v-2l3-3z"/>', 13),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 13),
    open: svg('<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 14),
    chevron: svg('<path d="m6 9 6 6 6-6"/>', 14),
    alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>', 14),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
    list: svg('<path d="M11 6h9M11 12h9M11 18h9"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>', 18),
  };

  /* =========================================================
   * Styles
   * ======================================================= */
  const CSS_TEXT = `
:host{all:initial}
:host([data-theme="dark"]){
  --bg:#212121;--surface:#2f2f2f;--menu:#353535;--seg:#454545;--border:rgba(255,255,255,.1);
  --text:#ececec;--text2:#b4b4b4;--text3:#8f8f8f;--hover:rgba(255,255,255,.06);--sel:rgba(255,255,255,.09);
  --inv:#ececec;--inv-text:#0d0d0d;--danger:#f87171;--danger-bg:#dc2626;--danger-hover:#ef4444;
  --danger-soft:rgba(248,113,113,.1);--shadow:0 12px 48px rgba(0,0,0,.55);--backdrop:rgba(0,0,0,.4)}
:host([data-theme="light"]){
  --bg:#ffffff;--surface:#f4f4f4;--menu:#ffffff;--seg:#ffffff;--border:rgba(0,0,0,.1);
  --text:#0d0d0d;--text2:#5d5d5d;--text3:#8f8f8f;--hover:rgba(0,0,0,.04);--sel:rgba(0,0,0,.06);
  --inv:#0d0d0d;--inv-text:#ffffff;--danger:#d92d20;--danger-bg:#e02e2a;--danger-hover:#c4231f;
  --danger-soft:rgba(224,46,42,.07);--shadow:0 12px 48px rgba(0,0,0,.16);--backdrop:rgba(0,0,0,.18)}
*{box-sizing:border-box}
.wrap{font-family:ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;line-height:1.4;color:var(--text);-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--text2);outline-offset:2px}
svg{display:block;flex:none}

/* Backdrop + Panel */
.backdrop{position:fixed;inset:0;background:var(--backdrop);opacity:0;pointer-events:none;transition:opacity .2s}
.open .backdrop{opacity:1;pointer-events:auto}
.panel{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);background:var(--bg);border-left:1px solid var(--border);
  box-shadow:var(--shadow);display:flex;flex-direction:column;pointer-events:auto;
  transform:translateX(100%);visibility:hidden;transition:transform .24s cubic-bezier(.2,.8,.2,1),visibility 0s linear .24s}
.open .panel{transform:none;visibility:visible;transition:transform .24s cubic-bezier(.2,.8,.2,1),visibility 0s}

/* Edge-Button */
.edge{position:fixed;right:0;top:50%;transform:translateY(-50%);width:28px;height:60px;border-radius:12px 0 0 12px;
  background:var(--surface);border:1px solid var(--border);border-right:0;color:var(--text2);display:grid;place-items:center;
  pointer-events:auto;opacity:.5;transition:opacity .15s,width .15s}
.edge:hover,.edge:focus-visible{opacity:1;width:34px}
.edge.busy{opacity:1}
.edge.busy::after{content:"";position:absolute;top:8px;left:7px;width:7px;height:7px;border-radius:50%;background:var(--danger-bg);animation:pulse 1.2s infinite}
.open .edge{opacity:0;pointer-events:none}
@keyframes pulse{50%{opacity:.25}}

/* Header */
header{padding:14px 16px 6px;display:flex;flex-direction:column;gap:12px}
.titlebar{display:flex;align-items:center;gap:8px}
.titlebar h2{margin:0;font-size:16px;font-weight:600;flex:1}
.icon{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:var(--text2)}
.icon:hover{background:var(--hover);color:var(--text)}
.icon:disabled{opacity:.35;cursor:default;background:none}
.tabs{display:flex;background:var(--surface);border-radius:12px;padding:3px}
.tab{flex:1;height:30px;border-radius:9px;font-size:13px;font-weight:500;color:var(--text2);display:flex;align-items:center;justify-content:center;gap:6px}
.tab[aria-selected="true"]{background:var(--seg);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.tab .cnt{font-variant-numeric:tabular-nums;color:var(--text3);font-weight:400}
.tab:disabled{cursor:default}
.search{position:relative;display:flex;align-items:center}
.search svg{position:absolute;left:11px;color:var(--text3);pointer-events:none}
.search input{width:100%;height:38px;border-radius:12px;border:1px solid transparent;background:var(--surface);color:var(--text);
  font:inherit;padding:0 36px 0 34px;outline:none}
.search input::placeholder{color:var(--text3)}
.search input:focus{border-color:var(--border);background:var(--bg)}
.search input::-webkit-search-cancel-button{display:none}
.search .clear{position:absolute;right:6px;width:26px;height:26px;border-radius:7px;display:none;place-items:center;color:var(--text3)}
.search .clear:hover{background:var(--hover);color:var(--text)}
.search.has-q .clear{display:grid}
.toolbar{display:flex;align-items:center;gap:4px;margin:0 -4px}
.master{display:flex;align-items:center;gap:10px;height:32px;padding:0 8px;border-radius:8px;font-size:13px;color:var(--text2)}
.master:hover{background:var(--hover);color:var(--text)}
.master:disabled{opacity:.4;cursor:default;background:none}
.spacer{flex:1}
.ghost{height:32px;padding:0 8px 0 10px;border-radius:8px;font-size:13px;color:var(--text2);display:flex;align-items:center;gap:4px}
.ghost:hover,.ghost[aria-expanded="true"]{background:var(--hover);color:var(--text)}
.ghost:disabled{opacity:.4;cursor:default;background:none}

/* Menü */
.menuwrap{position:relative}
.menu{position:absolute;right:0;top:calc(100% + 6px);z-index:5;min-width:264px;background:var(--menu);border:1px solid var(--border);
  border-radius:14px;box-shadow:var(--shadow);padding:6px}
.menu[hidden]{display:none}
.mi{width:100%;height:34px;border-radius:8px;padding:0 10px;display:flex;align-items:center;gap:8px;font-size:13px;text-align:left}
.mi:hover{background:var(--hover)}
.mi.keep{gap:6px}
.mi.keep input{width:48px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);
  font:inherit;font-size:13px;text-align:center;padding:0 2px}
.msep{height:1px;background:var(--border);margin:6px 4px}
.mnote{font-size:11.5px;color:var(--text3);padding:4px 10px 4px;line-height:1.35}

/* Liste */
.list{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:0 8px 8px;outline:none;scrollbar-width:thin;scrollbar-color:var(--border) transparent}
.ghead{position:sticky;top:0;z-index:2;background:var(--bg);display:flex;align-items:center;gap:10px;padding:14px 8px 6px;
  font-size:12px;font-weight:600;color:var(--text3);cursor:pointer;user-select:none}
.ghead .gl{flex:1}
.ghead .gc{font-weight:400;font-variant-numeric:tabular-nums}
.ghead:hover{color:var(--text2)}
.row{display:flex;align-items:center;gap:10px;height:36px;padding:0 6px 0 8px;border-radius:9px;cursor:pointer;user-select:none;outline:none}
.row:hover{background:var(--hover)}
.row.sel{background:var(--sel)}
.row:focus-visible{box-shadow:inset 0 0 0 2px var(--text3)}
.row .title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .badge{color:var(--text3);display:flex}
.row .meta{font-size:12px;color:var(--text3);font-variant-numeric:tabular-nums;white-space:nowrap}
.row .open{width:24px;height:24px;border-radius:6px;display:grid;place-items:center;color:var(--text3);opacity:0;margin-left:-4px}
.row:hover .open,.row .open:focus-visible{opacity:1}
.row .open:hover{background:var(--hover);color:var(--text)}
.row.err .title{color:var(--danger)}
.row.err .badge.e{color:var(--danger)}
.row.busy{opacity:.45}
mark{background:transparent;color:inherit;font-weight:600;text-decoration:underline;text-decoration-color:var(--text3);text-underline-offset:2px}

.cb{appearance:none;-webkit-appearance:none;margin:0;width:16px;height:16px;border:1.5px solid var(--text3);border-radius:4px;
  display:inline-grid;place-content:center;flex:none;background:transparent;pointer-events:none;transition:background .1s,border-color .1s}
.cb:checked,.cb:indeterminate{background:var(--inv);border-color:var(--inv)}
.cb:checked::after{content:"";width:8px;height:4px;border:2px solid var(--inv-text);border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg)}
.cb:indeterminate::after{content:"";width:8px;height:2px;border-radius:1px;background:var(--inv-text)}

/* Zustände */
.state{padding:48px 24px;text-align:center;color:var(--text3);display:flex;flex-direction:column;align-items:center;gap:12px}
.state strong{color:var(--text);font-weight:600;font-size:15px}
.state.err strong{color:var(--danger)}
.skel{height:36px;margin:2px 0;border-radius:9px;background:linear-gradient(90deg,var(--hover) 0%,var(--sel) 50%,var(--hover) 100%);
  background-size:200% 100%;animation:sh 1.2s linear infinite}
@keyframes sh{to{background-position:-200% 0}}
.loadmsg{font-size:12px;color:var(--text3);padding:12px 8px 4px}

/* Footer */
footer{border-top:1px solid var(--border);padding:12px 16px 14px;background:var(--bg);position:relative}
.hint{font-size:12.5px;color:var(--text3);line-height:1.5}
kbd{font-family:inherit;font-size:11px;border:1px solid var(--border);border-bottom-width:2px;border-radius:5px;padding:0 5px;color:var(--text2)}
.selbar{display:flex;align-items:center;gap:10px}
.selinfo{flex:1;min-width:0;font-size:13px;color:var(--text2);display:flex;flex-direction:column}
.selinfo strong{color:var(--text);font-weight:600;font-size:14px}
.selinfo .sub{font-size:11.5px;color:var(--text3)}
.link{font-size:12px;color:var(--text3);text-decoration:underline;text-underline-offset:2px;align-self:flex-start}
.link:hover{color:var(--text)}
.btn{height:36px;padding:0 14px;border-radius:999px;font-size:13.5px;font-weight:500;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn.secondary{border:1px solid var(--border)}
.btn.secondary:hover{background:var(--hover)}
.btn.danger{background:var(--danger-bg);color:#fff}
.btn.danger:hover{background:var(--danger-hover)}
.btn:disabled{opacity:.4;cursor:default}
.confirm{display:flex;flex-direction:column;gap:10px}
.confirm .ct{font-size:15px;font-weight:600}
.confirm ul{margin:0;list-style:none;padding:10px 12px;background:var(--surface);border-radius:10px;font-size:12.5px;color:var(--text2);max-height:140px;overflow:auto}
.confirm li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.confirm li::before{content:"–";color:var(--text3);margin-right:8px}
.confirm li.more::before{content:none}
.confirm li.more{color:var(--text3);margin-top:2px}
.warn{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--danger);background:var(--danger-soft);padding:8px 10px;border-radius:10px}
.warn svg{margin-top:1px}
.confirm .sub{font-size:12.5px;color:var(--text3)}
.actions{display:flex;justify-content:flex-end;gap:8px}
.progress{display:flex;flex-direction:column;gap:8px}
.ptop{display:flex;align-items:baseline;gap:8px}
.ptop .pt{flex:1;font-weight:600;font-size:14px}
.ptop .pn{font-size:12.5px;color:var(--text2);font-variant-numeric:tabular-nums}
.bar{height:6px;border-radius:3px;background:var(--surface);overflow:hidden}
.bar i{display:block;height:100%;background:var(--inv);border-radius:3px;transition:width .25s}
.bar.danger i{background:var(--danger-bg)}
.pbot{display:flex;align-items:center;gap:8px}
.pbot .ps{flex:1;font-size:12px;color:var(--text3)}

/* Toast */
.toast{position:absolute;z-index:10;left:12px;right:12px;bottom:calc(100% + 10px);background:var(--inv);color:var(--inv-text);border-radius:12px;
  padding:10px 8px 10px 14px;display:flex;align-items:center;gap:10px;font-size:13px;box-shadow:var(--shadow);
  animation:tin .2s cubic-bezier(.2,.8,.2,1)}
.toast[hidden]{display:none}
.toast .tm{flex:1}
.toast .ta{font-weight:600;padding:4px 8px;border-radius:6px}
.toast .ta:hover{background:rgba(127,127,127,.18)}
.toast .tx{width:24px;height:24px;display:grid;place-items:center;border-radius:6px;opacity:.7}
.toast .tx:hover{opacity:1;background:rgba(127,127,127,.18)}
@keyframes tin{from{opacity:0;transform:translateY(6px)}}

@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

  /* =========================================================
   * Markup
   * ======================================================= */
  const host = document.createElement("cgbm-root");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:block";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
<style>${CSS_TEXT}</style>
<div class="wrap">
  <div class="backdrop"></div>
  <aside class="panel" role="dialog" aria-modal="true" aria-label="Chats verwalten">
    <header>
      <div class="titlebar">
        <h2>Chats verwalten</h2>
        <a class="icon" href="${PRIVACY_URL}" target="_blank" rel="noopener" title="Datenschutz: Alles läuft lokal im Browser, Daten gehen nur an chatgpt.com">${I.info}</a>
        <button class="icon" data-act="reload" title="Neu laden">${I.refresh}</button>
        <button class="icon" data-act="close" title="Schließen (Esc)">${I.x}</button>
      </div>
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-tab="active">Chats <span class="cnt"></span></button>
        <button class="tab" role="tab" data-tab="archived">Archiv <span class="cnt"></span></button>
      </div>
      <div class="search">
        ${I.search}
        <input type="search" placeholder="Chats durchsuchen" aria-label="Chats durchsuchen" spellcheck="false" autocomplete="off">
        <button class="clear" data-act="clear-q" title="Suche leeren">${I.x}</button>
      </div>
      <div class="toolbar">
        <button class="master" data-act="master"><input type="checkbox" class="cb" tabindex="-1" aria-hidden="true"><span class="ml">Alle auswählen</span></button>
        <span class="spacer"></span>
        <div class="menuwrap">
          <button class="ghost" data-act="menu" aria-haspopup="menu" aria-expanded="false">Schnellauswahl ${I.chevron}</button>
          <div class="menu" role="menu" hidden>
            <button class="mi" role="menuitem" data-q="older" data-days="30">Älter als 30 Tage</button>
            <button class="mi" role="menuitem" data-q="older" data-days="90">Älter als 90 Tage</button>
            <button class="mi" role="menuitem" data-q="older" data-days="365">Älter als 1 Jahr</button>
            <div class="msep"></div>
            <button class="mi keep" role="menuitem" data-q="keep">Alle außer die ältesten <input type="number" min="0" max="9999" value="4" aria-label="Anzahl"></button>
            <div class="msep"></div>
            <button class="mi" role="menuitem" data-q="invert">Auswahl umkehren</button>
            <button class="mi" role="menuitem" data-q="none">Auswahl aufheben</button>
            <div class="mnote">Gilt für die sichtbaren Chats. Angeheftete Chats werden bei Sammelauswahl übersprungen.</div>
          </div>
        </div>
      </div>
    </header>
    <div class="list" tabindex="-1" role="listbox" aria-multiselectable="true" aria-label="Chats"></div>
    <footer>
      <div class="toast" role="status" hidden></div>
      <div class="fbody"></div>
    </footer>
  </aside>
  <button class="edge" data-act="toggle" title="Chats verwalten (Alt+Shift+B)" aria-label="Chats verwalten">${I.list}</button>
</div>`;
  document.documentElement.appendChild(host);

  const $ = (s) => root.querySelector(s);
  const wrap = $(".wrap");
  const listEl = $(".list");
  const fbody = $(".fbody");
  const toastEl = $(".toast");
  const searchWrap = $(".search");
  const searchIn = $(".search input");
  const menuEl = $(".menu");
  const menuBtn = $('[data-act="menu"]');
  const keepIn = $(".mi.keep input");
  const masterBtn = $(".master");
  const masterCb = $(".master .cb");
  const edgeBtn = $(".edge");

  /* =========================================================
   * State
   * ======================================================= */
  const S = {
    open: false,
    tab: "active",
    data: { active: null, archived: null },
    loading: { active: false, archived: false },
    loadMsg: "",
    error: { active: null, archived: null },
    q: "",
    sel: new Set(),
    anchorId: null,
    errors: new Map(), // id -> Fehlertext
    run: null,
    confirm: null,
    vis: [],
    ctx: null, // Identität, unter der die geladenen Listen und die Auswahl entstanden sind
  };

  storage.get("keepN", 4).then((v) => (keepIn.value = v));

  /* =========================================================
   * Theme
   * ======================================================= */
  function syncTheme() {
    const h = document.documentElement;
    const dark = h.classList.contains("dark")
      ? true
      : h.classList.contains("light")
      ? false
      : matchMedia("(prefers-color-scheme: dark)").matches;
    host.dataset.theme = dark ? "dark" : "light";
  }
  syncTheme();
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);

  /* =========================================================
   * Rendering
   * ======================================================= */
  function computeVisible() {
    const d = S.data[S.tab] || [];
    const terms = S.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    S.vis = terms.length ? d.filter((i) => terms.every((t) => i.title.toLowerCase().includes(t))) : d.slice();
    return S.vis;
  }

  function highlight(title) {
    const terms = S.q.trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return esc(title);
    const re = new RegExp("(" + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
    return title
      .split(re)
      .map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part)))
      .join("");
  }

  function renderTabs() {
    root.querySelectorAll(".tab").forEach((b) => {
      const t = b.dataset.tab;
      b.setAttribute("aria-selected", String(t === S.tab));
      b.disabled = !!S.run;
      const d = S.data[t];
      b.querySelector(".cnt").textContent = d ? d.length.toLocaleString("de-DE") : "";
    });
    $('[data-act="reload"]').disabled = !!S.run || S.loading[S.tab];
  }

  function renderList() {
    const tab = S.tab;
    if (S.loading[tab] && !S.data[tab]) {
      listEl.innerHTML =
        `<div class="loadmsg">${esc(S.loadMsg || "Lade Chats …")}</div>` + '<div class="skel"></div>'.repeat(10);
      return;
    }
    if (S.error[tab] && !S.data[tab]) {
      listEl.innerHTML = `<div class="state err"><strong>Laden fehlgeschlagen</strong><span>${esc(
        S.error[tab]
      )}</span><button class="btn secondary" data-act="reload">${I.refresh} Erneut versuchen</button></div>`;
      return;
    }
    const vis = computeVisible();
    if (!vis.length) {
      const all = S.data[tab] || [];
      listEl.innerHTML = all.length
        ? `<div class="state"><strong>Keine Treffer</strong><span>für „${esc(S.q.trim())}“</span></div>`
        : `<div class="state"><strong>${tab === "archived" ? "Archiv ist leer" : "Keine Chats"}</strong><span>${
            tab === "archived" ? "Archivierte Chats erscheinen hier." : "Hier gibt es nichts aufzuräumen."
          }</span></div>`;
      return;
    }
    const now = Date.now();
    const scroll = listEl.scrollTop;
    let html = "";
    let cur = null;
    vis.forEach((it, idx) => {
      const g = groupOf(it.t, now);
      if (g !== cur) {
        cur = g;
        html += `<div class="ghead" data-group="${esc(g)}"><input type="checkbox" class="cb" tabindex="-1" aria-hidden="true"><span class="gl">${esc(
          g
        )}</span><span class="gc"></span></div>`;
      }
      const err = S.errors.get(it.id);
      html += `<div class="row${err ? " err" : ""}" role="option" tabindex="-1" data-idx="${idx}" data-id="${esc(it.id)}" data-group="${esc(g)}">
<input type="checkbox" class="cb" tabindex="-1" aria-hidden="true">
<span class="title" title="${esc(it.title)}">${highlight(it.title)}</span>
${err ? `<span class="badge e" title="${esc(err)}">${I.alert}</span>` : ""}
${it.pinned ? `<span class="badge" title="Angeheftet">${I.pin}</span>` : ""}
${it.project ? `<span class="badge" title="In einem Projekt">${I.folder}</span>` : ""}
<span class="meta">${esc(fmtTime(it.t, now))}</span>
<a class="open" href="/c/${esc(it.id)}" target="_blank" rel="noopener" title="In neuem Tab öffnen" tabindex="-1">${I.open}</a>
</div>`;
    });
    listEl.innerHTML = html;
    listEl.scrollTop = scroll;
    syncSelection();
  }

  function setTri(cb, items) {
    const pool = unpinned(items);
    const n = items.filter((i) => S.sel.has(i.id)).length;
    const full = pool.length > 0 && pool.every((i) => S.sel.has(i.id));
    cb.checked = full;
    cb.indeterminate = n > 0 && !full;
  }

  function syncSelection() {
    const byGroup = new Map();
    listEl.querySelectorAll(".row").forEach((row) => {
      const on = S.sel.has(row.dataset.id);
      row.classList.toggle("sel", on);
      row.setAttribute("aria-selected", String(on));
      row.querySelector(".cb").checked = on;
      const it = S.vis[+row.dataset.idx];
      if (!byGroup.has(row.dataset.group)) byGroup.set(row.dataset.group, []);
      byGroup.get(row.dataset.group).push(it);
    });
    listEl.querySelectorAll(".ghead").forEach((h) => {
      const items = byGroup.get(h.dataset.group) || [];
      setTri(h.querySelector(".cb"), items);
      const n = items.filter((i) => S.sel.has(i.id)).length;
      h.querySelector(".gc").textContent = n ? `${n} / ${items.length}` : String(items.length);
    });
    setTri(masterCb, S.vis);
    masterBtn.disabled = !S.vis.length || !!S.run;
    $(".master .ml").textContent = !S.q.trim()
      ? "Alle auswählen"
      : S.vis.length === 1
      ? "Treffer auswählen"
      : `Alle ${S.vis.length.toLocaleString("de-DE")} Treffer`;
    menuBtn.disabled = !S.vis.length || !!S.run;
    renderFooter();
  }

  function renderFooter() {
    if (S.run) return renderProgress();
    if (S.confirm) return renderConfirm();
    const n = S.sel.size;
    if (!n) {
      fbody.innerHTML = `<div class="hint">Klick wählt aus · <kbd>Shift</kbd>+Klick: Bereich · <kbd>Strg</kbd>+<kbd>A</kbd>: alle sichtbaren</div>`;
      return;
    }
    const visIds = new Set(S.vis.map((i) => i.id));
    const hidden = [...S.sel].filter((id) => !visIds.has(id)).length;
    const arch = S.tab === "archived";
    fbody.innerHTML = `<div class="selbar">
  <div class="selinfo"><strong>${plural(n, "Chat", "Chats")} ausgewählt</strong>
    ${hidden ? `<span class="sub">davon ${hidden} durch die Suche ausgeblendet</span>` : ""}
    <button class="link" data-act="clear-sel">Auswahl aufheben</button></div>
  ${
    arch
      ? `<button class="btn secondary" data-act="unarchive">${I.restore} Wiederherstellen</button>`
      : `<button class="btn secondary" data-act="archive">${I.archive} Archivieren</button>`
  }
  <button class="btn danger" data-act="ask-delete">${I.trash} Löschen</button>
</div>`;
  }

  function renderConfirm() {
    const ids = S.confirm.ids;
    const all = new Map((S.data[S.tab] || []).map((i) => [i.id, i]));
    const items = ids.map((id) => all.get(id)).filter(Boolean).sort((x, y) => y.t - x.t);
    const visIds = new Set(S.vis.map((i) => i.id));
    const hidden = ids.filter((id) => !visIds.has(id)).length;
    const pinned = items.filter((i) => i.pinned).length;
    const shown = items.slice(0, 5);
    fbody.innerHTML = `<div class="confirm">
  <div class="ct">${plural(ids.length, "Chat", "Chats")} endgültig löschen?</div>
  <ul>${shown.map((i) => `<li>${esc(i.title)}</li>`).join("")}${
      items.length > shown.length ? `<li class="more">und ${(items.length - shown.length).toLocaleString("de-DE")} weitere</li>` : ""
    }</ul>
  ${hidden ? `<div class="warn">${I.alert}<span>${plural(hidden, "Chat ist", "Chats sind")} durch die aktuelle Suche ausgeblendet und werden mitgelöscht.</span></div>` : ""}
  ${pinned ? `<div class="warn">${I.alert}<span>Enthält ${plural(pinned, "angehefteten Chat", "angeheftete Chats")}.</span></div>` : ""}
  <div class="sub">Gelöschte Chats lassen sich nicht wiederherstellen.</div>
  <div class="actions">
    <button class="btn secondary" data-act="cancel-confirm">Abbrechen</button>
    <button class="btn danger" data-act="do-delete">${I.trash} Endgültig löschen</button>
  </div>
</div>`;
    fbody.querySelector('[data-act="cancel-confirm"]').focus();
  }

  const RUN_LABEL = {
    delete: ["Lösche", "gelöscht"],
    archive: ["Archiviere", "archiviert"],
    unarchive: ["Stelle wieder her", "wiederhergestellt"],
  };

  function renderProgress() {
    const r = S.run;
    const done = r.ok + r.fail;
    const pct = r.total ? (done / r.total) * 100 : 0;
    let sub = r.cancel ? "Wird nach dem aktuellen Chat angehalten …" : "";
    if (!sub && done >= 2) {
      const per = (Date.now() - r.start) / done;
      sub = `noch ca. ${fmtDuration(per * (r.total - done))}`;
    }
    if (r.fail) sub += `${sub ? " · " : ""}${r.fail} fehlgeschlagen`;
    let el = fbody.querySelector(".progress");
    if (!el) {
      fbody.innerHTML = `<div class="progress">
  <div class="ptop"><span class="pt"></span><span class="pn"></span></div>
  <div class="bar${r.kind === "delete" ? " danger" : ""}"><i></i></div>
  <div class="pbot"><span class="ps"></span><button class="btn secondary" data-act="cancel-run">Anhalten</button></div>
</div>`;
      el = fbody.querySelector(".progress");
    }
    el.querySelector(".pt").textContent = r.verifying ? "Prüfe Sitzung …" : `${RUN_LABEL[r.kind][0]} …`;
    el.querySelector(".pn").textContent = `${done.toLocaleString("de-DE")} / ${r.total.toLocaleString("de-DE")}`;
    el.querySelector(".bar i").style.width = pct + "%";
    el.querySelector(".ps").textContent = sub || "Bitte Tab geöffnet lassen.";
    el.querySelector('[data-act="cancel-run"]').disabled = r.cancel;
  }

  function render() {
    renderTabs();
    renderList();
    if (!S.data[S.tab]) renderFooter();
    edgeBtn.classList.toggle("busy", !!S.run);
  }

  let listTimer = null;
  function renderListSoon() {
    if (listTimer) return;
    listTimer = setTimeout(() => {
      listTimer = null;
      renderTabs();
      renderList();
    }, 250);
  }

  /* =========================================================
   * Toast
   * ======================================================= */
  let toastTimer = null;
  function toast(msg, action, ms = 8000) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = `<span class="tm">${esc(msg)}</span>${
      action ? `<button class="ta">${esc(action.label)}</button>` : ""
    }<button class="tx" title="Schließen">${I.x}</button>`;
    toastEl.hidden = false;
    if (action) toastEl.querySelector(".ta").onclick = (e) => {
      if (!e.isTrusted) return;
      hideToast();
      action.fn();
    };
    toastEl.querySelector(".tx").onclick = (e) => e.isTrusted && hideToast();
    toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.hidden = true;
  }

  /* =========================================================
   * Daten laden
   * ======================================================= */
  function resetData() {
    S.data = { active: null, archived: null };
    S.sel.clear();
    S.errors.clear();
    S.confirm = null;
    S.anchorId = null;
  }

  // Frische Sitzung holen; bei anderer Identität alles Geladene verwerfen. true = gewechselt.
  async function ensureContext() {
    const s = await fetchSession();
    if (S.ctx && !sameIdentity(s.identity, S.ctx)) {
      resetData();
      S.ctx = s.identity;
      return true;
    }
    S.ctx = s.identity;
    return false;
  }

  function handleSessionChange(msg) {
    resetData();
    S.ctx = session ? session.identity : null;
    render();
    toast(msg, null, 10000);
    load(S.tab);
  }

  async function load(tab = S.tab) {
    if (S.loading[tab]) return;
    S.loading[tab] = true;
    S.error[tab] = null;
    S.loadMsg = "";
    if (tab === S.tab) render();
    let changedMidLoad = false;
    try {
      if (await ensureContext()) {
        toast("Anderes Konto erkannt. Auswahl verworfen, Liste neu geladen.", null, 8000);
        if (tab === S.tab) render();
      }
      const loadCtx = S.ctx;
      const list = await fetchList(tab === "archived", (n, total) => {
        S.loadMsg = total ? `${n.toLocaleString("de-DE")} von ${total.toLocaleString("de-DE")} geladen …` : `${n} geladen …`;
        if (tab === S.tab && !S.data[tab]) renderList();
      }, loadCtx);
      if (!sameIdentity(loadCtx, S.ctx)) throw new SessionChanged();
      S.data[tab] = list;
    } catch (e) {
      if (e.sessionChanged) changedMidLoad = true;
      else {
        S.error[tab] = e.message || String(e);
        if (S.data[tab]) toast("Aktualisieren fehlgeschlagen: " + S.error[tab]);
      }
    } finally {
      S.loading[tab] = false;
      if (tab === S.tab) render();
      else renderTabs();
    }
    if (changedMidLoad) handleSessionChange("Sitzung hat sich beim Laden geändert. Liste neu geladen.");
  }

  function reload() {
    if (S.run) return;
    S.sel.clear();
    S.errors.clear();
    S.confirm = null;
    S.data[S.tab] = null;
    load(S.tab);
  }

  /* =========================================================
   * Auswahl
   * ======================================================= */
  function setSel(items, on) {
    items.forEach((i) => (on ? S.sel.add(i.id) : S.sel.delete(i.id)));
  }

  function toggleAll(items) {
    const pool = unpinned(items);
    const anySel = items.some((i) => S.sel.has(i.id));
    const poolFull = pool.length > 0 && pool.every((i) => S.sel.has(i.id));
    if (poolFull || (!pool.length && anySel)) setSel(items, false);
    else if (!pool.length) toast("Nur angeheftete Chats. Diese bitte einzeln auswählen.", null, 3500);
    else setSel(pool, true);
    S.confirm = null;
    syncSelection();
  }

  function clickRow(idx, shift) {
    const it = S.vis[idx];
    if (!it) return;
    const on = !S.sel.has(it.id);
    const a = S.anchorId ? S.vis.findIndex((i) => i.id === S.anchorId) : -1;
    if (shift && a >= 0) {
      const [lo, hi] = a < idx ? [a, idx] : [idx, a];
      setSel(S.vis.slice(lo, hi + 1), on);
    } else {
      setSel([it], on);
    }
    S.anchorId = it.id;
    S.confirm = null;
    syncSelection();
  }

  function quickSelect(kind, opt) {
    const vis = S.vis;
    let pick = [];
    if (kind === "older") {
      const cut = Date.now() - opt * DAY;
      pick = vis.filter((i) => i.t && i.t < cut && !i.pinned);
    } else if (kind === "keep") {
      const n = Math.max(0, parseInt(opt, 10) || 0);
      pick = vis.slice(0, Math.max(0, vis.length - n)).filter((i) => !i.pinned);
    } else if (kind === "invert") {
      vis.forEach((i) => {
        if (i.pinned && !S.sel.has(i.id)) return;
        S.sel.has(i.id) ? S.sel.delete(i.id) : S.sel.add(i.id);
      });
    } else if (kind === "none") {
      S.sel.clear();
    }
    if (kind === "older" || kind === "keep") {
      S.sel = new Set(pick.map((i) => i.id));
      if (!pick.length) toast("Keine passenden Chats gefunden.", null, 3000);
    }
    S.confirm = null;
    closeMenu();
    syncSelection();
  }

  /* =========================================================
   * Bulk-Aktionen
   * ======================================================= */
  const BODY = {
    delete: { is_visible: false },
    archive: { is_archived: true },
    unarchive: { is_archived: false },
  };

  const VERIFY_EVERY = 20; // Sitzung während langer Läufe regelmäßig frisch prüfen
  const VERIFY_MS = 60000;

  async function runBatch(kind, ids, { fromTab = S.tab, undoOf = null } = {}) {
    if (S.run || !ids.length) return;
    hideToast();
    S.confirm = null;
    // Laufstatus SOFORT setzen (synchron), damit ein zweiter Klick keinen parallelen Lauf startet.
    const run = (S.run = {
      kind, total: ids.length, ok: 0, fail: 0, okIds: [], failIds: [],
      cancel: false, aborted: false, verifying: true, start: Date.now(),
    });
    renderTabs();
    syncSelection();
    edgeBtn.classList.add("busy");
    const endEarly = () => {
      S.run = null;
      edgeBtn.classList.remove("busy");
      renderTabs();
      syncSelection();
    };
    // Vor jedem Schreiblauf: Sitzung frisch holen und mit dem Kontext der geladenen Liste vergleichen.
    const expect = S.ctx;
    try {
      const s = await fetchSession();
      if (!sameIdentity(s.identity, expect)) {
        endEarly();
        return handleSessionChange("Konto oder Sitzung hat sich geändert. Nichts wurde ausgeführt, Liste neu geladen.");
      }
    } catch (e) {
      endEarly();
      return toast("Sitzung nicht prüfbar: " + (e.message || e) + " Nichts wurde ausgeführt.");
    }
    run.verifying = false;
    run.start = Date.now();
    renderProgress();
    const list = S.data[fromTab];
    let lastVerify = Date.now();

    for (const [n, id] of ids.entries()) {
      if (run.cancel) break;
      if (n > 0 && (n % VERIFY_EVERY === 0 || Date.now() - lastVerify > VERIFY_MS)) {
        try {
          const s = await fetchSession();
          lastVerify = Date.now();
          if (!sameIdentity(s.identity, expect)) {
            run.aborted = true;
            break;
          }
        } catch {
          run.aborted = true;
          break;
        }
      }
      const row = listEl.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
      row && row.classList.add("busy");
      try {
        await patchConversation(id, BODY[kind], expect);
        run.ok++;
        run.okIds.push(id);
        S.sel.delete(id);
        S.errors.delete(id);
        if (list && !undoOf) {
          const ix = list.findIndex((i) => i.id === id);
          if (ix >= 0) list.splice(ix, 1);
        }
        if (kind === "unarchive") {
          if (!restoreInNativeSidebar(id)) run.needsReload = true;
        } else hideInNativeSidebar(id);
        renderListSoon();
      } catch (e) {
        if (e.sessionChanged) {
          row && row.classList.remove("busy");
          run.aborted = true;
          break;
        }
        run.fail++;
        run.failIds.push(id);
        S.errors.set(id, e.status ? `Fehler ${e.status}` : e.message || "Fehler");
        row && row.classList.remove("busy");
      }
      renderProgress();
      await sleep(pacer.delay);
    }

    const canceled = run.cancel;
    S.run = null;
    edgeBtn.classList.remove("busy");
    if (run.aborted) {
      clearTimeout(listTimer);
      listTimer = null;
      return handleSessionChange(
        `Konto oder Sitzung hat sich geändert. Lauf abgebrochen nach ${plural(run.ok, "Chat", "Chats")}, Liste neu geladen.`
      );
    }
    // Die jeweils andere Liste ist jetzt veraltet und wird beim nächsten Öffnen neu geladen.
    const other = fromTab === "active" ? "archived" : "active";
    if (kind !== "delete") S.data[other] = null;
    if (undoOf) S.data[fromTab] = null;

    clearTimeout(listTimer);
    listTimer = null;
    if (undoOf) await load(fromTab);
    else render();

    const [, past] = RUN_LABEL[kind];
    let msg = `${plural(run.ok, "Chat", "Chats")} ${past}`;
    if (run.fail) msg += ` · ${run.fail} fehlgeschlagen (markiert, weiter ausgewählt)`;
    if (canceled) msg = `Angehalten · ${msg}`;

    const openId = (location.pathname.match(/\/c\/([^/?#]+)/) || [])[1];
    if (kind === "archive" && run.ok && !undoOf) {
      toast(msg, { label: "Rückgängig", fn: () => runBatch("unarchive", run.okIds, { fromTab, undoOf: "archive" }) }, 12000);
    } else if (kind === "delete" && openId && run.okIds.includes(openId)) {
      toast(msg + ". Der geöffnete Chat wurde gelöscht.", { label: "Neuer Chat", fn: () => (location.href = "/") });
    } else if (kind === "unarchive" && run.ok && run.needsReload) {
      toast(msg + ". In der Seitenleiste nach Neuladen sichtbar.", { label: "Neu laden", fn: () => location.reload() });
    } else {
      toast(msg);
    }
  }

  window.addEventListener("beforeunload", (e) => {
    if (S.run) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  /* =========================================================
   * Öffnen / Schließen / Menü
   * ======================================================= */
  function openPanel() {
    S.open = true;
    wrap.classList.add("open");
    if (!S.data[S.tab] && !S.loading[S.tab]) load(S.tab);
    else {
      render();
      // Bereits geladene Daten nur weiterverwenden, wenn die Sitzung noch dieselbe ist.
      if (!S.run && !S.loading[S.tab])
        ensureContext()
          .then((changed) => changed && (render(), toast("Anderes Konto erkannt. Liste neu geladen.", null, 8000), load(S.tab)))
          .catch(() => {});
    }
    setTimeout(() => searchIn.focus(), 60);
  }
  function closePanel() {
    S.open = false;
    closeMenu();
    wrap.classList.remove("open");
  }
  const togglePanel = () => (S.open ? closePanel() : openPanel());

  function openMenu() {
    menuEl.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
  }
  function closeMenu() {
    menuEl.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  }

  function switchTab(tab) {
    if (S.run || tab === S.tab) return;
    S.tab = tab;
    S.sel.clear();
    S.errors.clear();
    S.anchorId = null;
    S.confirm = null;
    listEl.scrollTop = 0;
    if (!S.data[tab] && !S.loading[tab]) load(tab);
    else render();
  }

  /* =========================================================
   * Events
   * ======================================================= */
  // Sicherheit: Seitenskripte teilen sich den DOM mit dem Panel und könnten Bedienelemente per
  // element.click() auslösen. Zustandsänderungen und Schreibaufrufe nur bei echten Nutzerereignissen.
  root.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    const t = e.target;
    if (!t.closest(".menuwrap")) closeMenu();

    const tabBtn = t.closest(".tab");
    if (tabBtn) return switchTab(tabBtn.dataset.tab);

    const qi = t.closest(".mi");
    if (qi) {
      if (t.tagName === "INPUT") return;
      if (qi.dataset.q === "keep") {
        storage.set("keepN", parseInt(keepIn.value, 10) || 0);
        return quickSelect("keep", keepIn.value);
      }
      return quickSelect(qi.dataset.q, +qi.dataset.days);
    }

    const act = t.closest("[data-act]")?.dataset.act;
    switch (act) {
      case "toggle":
        return togglePanel();
      case "close":
        return closePanel();
      case "reload":
        return reload();
      case "clear-q":
        searchIn.value = "";
        S.q = "";
        searchWrap.classList.remove("has-q");
        searchIn.focus();
        return renderList();
      case "menu":
        return menuEl.hidden ? openMenu() : closeMenu();
      case "master":
        return toggleAll(S.vis);
      case "clear-sel":
        S.sel.clear();
        return syncSelection();
      case "archive":
        return runBatch("archive", [...S.sel]);
      case "unarchive":
        return runBatch("unarchive", [...S.sel]);
      case "ask-delete":
        hideToast();
        S.confirm = { ids: [...S.sel] };
        return renderFooter();
      case "cancel-confirm":
        S.confirm = null;
        return renderFooter();
      case "do-delete":
        return S.confirm && runBatch("delete", S.confirm.ids);
      case "cancel-run":
        if (S.run) S.run.cancel = true;
        return renderProgress();
    }
  });

  $(".backdrop").addEventListener("click", (e) => e.isTrusted && closePanel());

  listEl.addEventListener("mousedown", (e) => {
    if (e.shiftKey) e.preventDefault(); // keine Textmarkierung bei Shift+Klick
  });

  listEl.addEventListener("click", (e) => {
    if (!e.isTrusted || S.run || e.target.closest("a.open") || e.target.closest("[data-act]")) return;
    const g = e.target.closest(".ghead");
    if (g) {
      const now = Date.now();
      return toggleAll(S.vis.filter((i) => groupOf(i.t, now) === g.dataset.group));
    }
    const row = e.target.closest(".row");
    if (row) {
      row.focus({ preventScroll: true });
      clickRow(+row.dataset.idx, e.shiftKey);
    }
  });

  listEl.addEventListener("keydown", (e) => {
    if (!e.isTrusted) return;
    const row = e.target.closest && e.target.closest(".row");
    const rows = [...listEl.querySelectorAll(".row")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = row ? rows.indexOf(row) : -1;
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        next.focus();
        next.scrollIntoView({ block: "nearest" });
      }
    } else if ((e.key === " " || e.key === "Enter") && row && !S.run) {
      e.preventDefault();
      clickRow(+row.dataset.idx, e.shiftKey);
    }
  });

  let qTimer = null;
  searchIn.addEventListener("input", () => {
    searchWrap.classList.toggle("has-q", !!searchIn.value);
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      S.q = searchIn.value;
      S.anchorId = null;
      if (S.confirm) S.confirm = null;
      listEl.scrollTop = 0;
      renderList();
    }, 80);
  });
  searchIn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const first = listEl.querySelector(".row");
      first && first.focus();
    }
  });

  keepIn.addEventListener("keydown", (e) => {
    if (e.isTrusted && e.key === "Enter") {
      e.preventDefault();
      storage.set("keepN", parseInt(keepIn.value, 10) || 0);
      quickSelect("keep", keepIn.value);
    }
  });

  root.addEventListener("keydown", (e) => {
    if (!S.open || !e.isTrusted) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      if (!menuEl.hidden) return closeMenu();
      if (S.confirm) {
        S.confirm = null;
        return renderFooter();
      }
      if (S.q && root.activeElement === searchIn) {
        searchIn.value = "";
        searchIn.dispatchEvent(new Event("input"));
        return;
      }
      return closePanel();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && root.activeElement?.tagName !== "INPUT") {
      e.preventDefault();
      if (!S.run) toggleAll(S.vis);
    }
  });

  // ChatGPT soll Tastatureingaben im Panel nicht abfangen.
  ["keydown", "keyup", "keypress"].forEach((ev) =>
    host.addEventListener(ev, (e) => {
      if (S.open) e.stopPropagation();
    })
  );

  // Esc außerhalb des Panels-Fokus
  document.addEventListener(
    "keydown",
    (e) => {
      if (S.open && e.key === "Escape" && !host.contains(e.target)) closePanel();
    },
    true
  );

  try {
    chrome.runtime.onMessage.addListener((m) => {
      if (m && m.type === "cgbm-toggle") togglePanel();
    });
  } catch {}

  window.__cgbmToggle = togglePanel;
})();
