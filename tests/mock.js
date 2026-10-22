// Nachgebauter chatgpt.com-Server für Tests und Store-Screenshots (über Playwright-Routing).
// Enthält ausschließlich Fantasiedaten.
const DAY = 864e5;

const STORE_TITLES = [
  "Rezeptideen für ein schnelles Abendessen", "Excel-Formel für Monatsübersicht",
  "Bewerbungsschreiben überarbeiten", "Reiseplanung Gardasee im Mai", "Python-Skript für CSV-Import",
  "Unterschied zwischen Leasing und Finanzierung", "Geburtstagsgedicht für Oma", "Gartenplanung Hochbeet",
  "SQL-Abfrage optimieren", "E-Mail an Vermieter wegen Heizung", "Zusammenfassung Projektmeeting",
  "Fahrradkette wechseln", "Englisch-Vokabeln Lernplan", "Laptop-Kaufberatung bis 1000 €",
  "Quiz-Fragen für Teamevent", "Marathon-Trainingsplan 16 Wochen", "Kurzgeschichte über einen Leuchtturm",
  "Regex für Postleitzahlen", "Präsentation Quartalszahlen gliedern", "Wochenplan Meal Prep",
  "Bash-Skript Backup", "Bachelorarbeit Gliederung", "Kündigungsschreiben Fitnessstudio",
  "Packliste Wanderurlaub", "React-Komponente refaktorieren", "Sauerteig füttern Tipps",
  "Vortrag über Photovoltaik", "Spanisch Grammatik Subjuntivo", "Budgetplanung Hochzeit",
  "Docker Compose für Nextcloud", "Brettspiel-Empfehlungen zu viert", "LinkedIn-Profil verbessern",
  "Datenbankschema für Vereinsverwaltung", "Pflanzen für schattigen Balkon", "Mietvertrag verstehen",
  "Kindergeburtstag Spiele", "JavaScript Promises erklärt", "Interview-Fragen Produktmanagement",
  "Weinbegleitung zu Raclette", "Wärmepumpe vs. Gasheizung", "Lebenslauf auf Englisch",
  "Stoffwindeln Erfahrungen", "Git Rebase vs. Merge", "Hundetraining Rückruf",
  "Rezept für Zimtschnecken", "Urlaubsantrag formulieren", "Kaffeemaschine entkalken", "Namensideen für einen Podcast",
  "TypeScript Generics verstehen", "Trainingsplan Klimmzüge", "Nebenkostenabrechnung prüfen", "Gedicht zum Ruhestand",
  "Ölwechsel selbst machen", "Kalkulation Flohmarktstand", "Französisch für die Reise", "Dashboard-Konzept skizzieren",
  "Rezept Linsencurry", "Fotografie: Blende und ISO", "Elternbrief Klassenfahrt", "Python Pandas groupby",
  "Ideen für den Hochzeitstag", "Teichpumpe auswählen", "Rede zum 50. Geburtstag", "Kubernetes Grundlagen",
  "Smart-Home Szenen planen", "Schreibblockade überwinden", "Wohnung streichen Farbwahl", "API-Dokumentation gliedern",
  "Fahrradtour Bodensee", "Zeitmanagement Tipps", "Rezept vegane Lasagne", "Gehaltsverhandlung vorbereiten",
  "Aquarium einrichten", "CSS Grid Layout", "Buchempfehlungen Science-Fiction", "Kompost anlegen",
  "Meeting-Agenda Kickoff", "Schach-Eröffnungen lernen", "Winterreifen Vergleich", "Unit-Tests schreiben",
  "Weihnachtsmarkt Ausflugsziele", "Steckdosen-Schaltplan erklären", "Pressemitteilung Vereinsfest", "Brot ohne Hefe",
  "Bewässerung Gewächshaus", "Markdown Tabellen", "Terminplanung Umzug", "Yoga für Anfänger",
];

function build(dataset) {
  const now = Date.now();
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const words = ["Analyse", "Konzept", "Refactoring", "Datenschutz", "Freiburg", "Rezept", "Python", "Netlify", "Plex NUC", "Spamfilter", "Vertrag", "Reise", "Audi e-tron", "Küchenmodul", "Echoortung", "Font-Generator", "Kiwix", "Schulung", "Proxy", "Fotobuch"];
  const title = (i) =>
    dataset === "store"
      ? STORE_TITLES[i % STORE_TITLES.length] + (i >= STORE_TITLES.length ? ` (${Math.floor(i / STORE_TITLES.length) + 1})` : "")
      : `${words[i % words.length]} ${["prüfen", "bauen", "vergleichen", "erklären", "optimieren"][i % 5]} ${i}`;
  const mk = (i, t, extra = {}) => ({
    id: "c" + String(i).padStart(4, "0") + "-aaaa-bbbb", title: title(i),
    create_time: new Date(t - 3600e3).toISOString(), update_time: new Date(t).toISOString(), ...extra,
  });
  const active = [], archived = [];
  let t = now - 20 * 60e3;
  const n = dataset === "store" ? STORE_TITLES.length : 230;
  for (let i = 0; i < n; i++) { active.push(mk(i, t)); t -= rnd() * (i < 20 ? 0.6 : 4.5) * DAY; }
  if (dataset === "store") {
    active[10].is_starred = true; active[18].gizmo_id = "g-p-1"; active[4].gizmo_id = "g-p-1";
  } else {
    active[3].is_starred = true; active[12].is_starred = true;
    active[3].title = "Merkliste Steuer 3"; active[12].title = "Merkliste Urlaub 12"; // nur angeheftete Treffer
    active[5].gizmo_id = "g-p-123"; active[40].gizmo_id = "g-p-123";
    active[2].title = "Sehr langer Titel über das Mail-Adress-Konzept, Weiterleitungen und CNAMEs im Konzern mit <Sonderzeichen> & Co.";
    active[7].title = "";
  }
  for (let i = 0; i < 12; i++) archived.push(mk(500 + i, now - (i * 9 + 2) * DAY, { is_archived: true }));
  return {
    active, archived, deleted: new Set(),
    // Sitzungssimulation: aktuelle Sitzung, gültige Tokens, Protokoll aller API-Aufrufe
    session: { token: "tok", user: "user-A", account: "acc-1" },
    validTokens: new Set(["tok"]),
    log: [],
    switchAfterPatches: null, // { n: nach n weiteren PATCHs wechseln, to: {token,user,account}, revokeOld }
  };
}

function page(theme, state) {
  const dark = theme === "dark";
  const links = state.active.slice(0, 28).map((c) => `<li><a href="/c/${c.id}">${c.title || "Ohne Titel"}</a></li>`).join("");
  return `<!doctype html><html class="${theme}" lang="de"><head><meta charset="utf-8"><title>Chat</title>
<style>body{margin:0;font-family:Inter,system-ui;display:flex;height:100vh;background:${dark ? "#212121" : "#fff"};color:${dark ? "#ececec" : "#0d0d0d"}}
nav{width:260px;background:${dark ? "#181818" : "#f9f9f9"};overflow:hidden;padding:8px;font-size:14px}nav ul{list-style:none;padding:0;margin:0}
nav a{display:block;padding:7px 10px;color:inherit;text-decoration:none;border-radius:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
main{flex:1}</style></head><body><nav><ul>${links}</ul></nav><main></main></body></html>`;
}

async function install(ctx, theme = "dark", opts = {}) {
  const state = build(opts.dataset);
  // Sitzung wechseln (z. B. anderes Konto oder Token-Rotation); revokeOld macht alte Tokens ungültig.
  state.switchSession = (to, { revokeOld = false } = {}) => {
    if (revokeOld) state.validTokens.clear();
    state.session = { ...state.session, ...to };
    state.validTokens.add(state.session.token);
  };
  const fail429 = new Set();
  let patchCount = 0;
  const list = (arch, offset, limit) => {
    const src = (arch ? state.archived : state.active).filter((c) => !state.deleted.has(c.id));
    src.sort((a, b) => Date.parse(b.update_time) - Date.parse(a.update_time));
    return { items: src.slice(offset, offset + limit), total: src.length, limit, offset };
  };
  await ctx.route(/https:\/\/chatgpt\.com\/.*/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    // Künstliche Latenz (z. B. LATENCY_MS=600), um langsame CI-Läufe lokal nachzustellen.
    if (opts.latency && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/backend-api/")))
      await new Promise((r) => setTimeout(r, opts.latency));
    if (url.pathname === "/api/auth/session")
      return route.fulfill({ json: { accessToken: state.session.token, user: { id: state.session.user }, account: { id: state.session.account } } });
    const auth = (req.headers()["authorization"] || "").replace(/^Bearer /, "");
    if (url.pathname === "/backend-api/conversations") {
      state.log.push({ kind: "list", auth });
      if (!state.validTokens.has(auth)) return route.fulfill({ status: 401, body: "" });
      return route.fulfill({ json: list(url.searchParams.get("is_archived") === "true", +url.searchParams.get("offset"), +url.searchParams.get("limit")) });
    }
    const m = url.pathname.match(/^\/backend-api\/conversation\/(.+)$/);
    if (m && req.method() === "PATCH") {
      const id = m[1];
      state.log.push({ kind: "patch", id, auth });
      if (!state.validTokens.has(auth)) return route.fulfill({ status: 401, body: "" });
      const body = JSON.parse(req.postData() || "{}");
      patchCount++;
      const sw = state.switchAfterPatches;
      if (sw && --sw.n <= 0) { state.switchAfterPatches = null; state.switchSession(sw.to, { revokeOld: sw.revokeOld }); }
      if (opts.failIds && opts.failIds.includes(id)) return route.fulfill({ status: 404, json: { detail: "not found" } });
      if (opts.rate && patchCount % opts.rate === 0 && !fail429.has(id)) {
        fail429.add(id);
        return route.fulfill({ status: 429, headers: { "retry-after": "1" }, body: "" });
      }
      if (opts.patchDelay) await new Promise((r) => setTimeout(r, opts.patchDelay));
      const inA = state.active.find((c) => c.id === id), inR = state.archived.find((c) => c.id === id);
      if (body.is_visible === false) state.deleted.add(id);
      if (body.is_archived === true && inA) { state.active.splice(state.active.indexOf(inA), 1); state.archived.push(inA); }
      if (body.is_archived === false && inR) { state.archived.splice(state.archived.indexOf(inR), 1); state.active.push(inR); }
      return route.fulfill({ json: { success: true } });
    }
    if (url.pathname === "/" || url.pathname.startsWith("/c/")) return route.fulfill({ contentType: "text/html", body: page(theme, state) });
    return route.fulfill({ status: 404, body: "" });
  });
  return state;
}

async function launch(viewport = { width: 1400, height: 860 }) {
  const { chromium } = require("playwright");
  const path = require("path");
  const os = require("os");
  const ext = path.resolve(__dirname, "../extension");
  return chromium.launchPersistentContext(path.join(os.tmpdir(), "bm-profile-" + process.pid + "-" + Date.now()), {
    // Erweiterungen laufen nur im vollen Chromium (nicht in der Headless-Shell).
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chromium" }),
    headless: true,
    args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    viewport,
    deviceScaleFactor: 1,
    locale: "de-DE",
  });
}

module.exports = { install, launch };
