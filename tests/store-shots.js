// Erzeugt Store-Screenshots (1280x800), kleine Promo-Kachel (440x280) und Marquee (1400x560)
// mit Fantasiedaten: node tests/store-shots.js
const fs = require("fs");
const path = require("path");
const { install, launch } = require("./mock");

const OUT = path.resolve(__dirname, "../store");
const ICON = "data:image/png;base64," + fs.readFileSync(path.join(OUT, "icon-128.png")).toString("base64");
const W = 1280, H = 800, PANEL_X = W - 440;

const SCENES = [
  { file: "01-uebersicht", theme: "dark", title: "Alle Chats auf einen Blick",
    sub: "Gruppiert nach Datum wie in ChatGPT. Ein Klick auf eine Gruppe wählt sie komplett aus.",
    run: async (R) => {
      await R('.ghead[data-group="Gestern"]').click(); await R(".row").nth(9).click();
      await R(".list").evaluate((el) => (el.scrollTop = 0));
    } },
  { file: "02-suche", theme: "light", title: "Finden statt scrollen",
    sub: "Live-Suche mit Hervorhebung. „Alle auswählen“ gilt dann nur für die Treffer.",
    run: async (R, p) => { await R(".search input").fill("plan"); await p.waitForTimeout(200); await R(".master").click(); } },
  { file: "03-schnellauswahl", theme: "dark", title: "Aufräumen in Sekunden",
    sub: "Älter als 30, 90 oder 365 Tage, oder alles außer den ältesten N. Angeheftete Chats bleiben geschützt.",
    run: async (R) => { await R('[data-act="menu"]').click(); } },
  { file: "04-loeschen", theme: "light", title: "Erst prüfen, dann löschen",
    sub: "Vorschau vor dem endgültigen Löschen und eine Warnung, wenn ausgewählte Chats gerade ausgeblendet sind.",
    run: async (R, p) => {
      await R('[data-act="menu"]').click(); await R('.mi[data-days="90"]').click();
      await R(".search input").fill("Rezept"); await p.waitForTimeout(200);
      await R(".row").first().click(); await R('[data-act="ask-delete"]').click();
    } },
  { file: "05-archiv", theme: "dark", title: "Archivieren mit Rückgängig",
    sub: "Reversibel aufräumen. Im Archiv-Tab wiederherstellen oder endgültig löschen.",
    run: async (R, p) => {
      await R(".row").nth(2).click(); await R(".row").nth(5).click({ modifiers: ["Shift"] });
      await R('[data-act="archive"]').click(); await R(".toast .ta").waitFor({ timeout: 20000 }); await p.waitForTimeout(400);
    } },
];

const CHIPS = ["Läuft lokal im Browser", "Keine Server, kein Tracking", "Open Source"];

function slide({ theme, title, sub, panel }) {
  const dark = theme === "dark";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:${W}px;height:${H}px;overflow:hidden;font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased;
  background:${dark ? "radial-gradient(1200px 800px at 0% 0%,#2a2a2a,#0d0d0d 70%)" : "radial-gradient(1200px 800px at 0% 0%,#ffffff,#ececee 75%)"};
  color:${dark ? "#f4f4f4" : "#0d0d0d"};display:flex}
.l{width:${PANEL_X}px;padding:84px 72px 64px 80px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:14px;font-size:17px;font-weight:600;opacity:.85}
.brand img{width:44px;height:44px}
h1{font-family:"Inter Display",Inter,sans-serif;font-size:56px;line-height:1.05;letter-spacing:-.02em;font-weight:700;margin-top:auto;max-width:640px}
p{font-size:22px;line-height:1.45;margin-top:22px;max-width:600px;color:${dark ? "#b4b4b4" : "#4b4b4b"}}
.chips{display:flex;gap:10px;margin-top:auto;flex-wrap:wrap}
.chip{font-size:14px;font-weight:500;padding:8px 14px;border-radius:999px;border:1px solid ${dark ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.12)"};color:${dark ? "#d0d0d0" : "#3a3a3a"}}
.r{width:440px;height:${H}px;box-shadow:${dark ? "-24px 0 60px rgba(0,0,0,.6)" : "-24px 0 60px rgba(0,0,0,.12)"}}
.r img{display:block;width:440px;height:${H}px}
</style></head><body><div class="l"><div class="brand"><img src="${ICON}">Bulk Manager für ChatGPT</div>
<h1>${title}</h1><p>${sub}</p><div class="chips">${CHIPS.map((c) => `<span class="chip">${c}</span>`).join("")}</div></div>
<div class="r"><img src="${panel}"></div></body></html>`;
}

function promo(w, h, panel) {
  const big = w > 800;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:${w}px;height:${h}px;overflow:hidden;font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased;
  background:radial-gradient(${w}px ${h * 1.6}px at 0% 0%,#2c2c2c,#0d0d0d 70%);color:#f4f4f4;display:flex;align-items:center}
.l{flex:1;padding:0 ${big ? 90 : 34}px;display:flex;flex-direction:column;gap:${big ? 18 : 12}px}
img.i{width:${big ? 88 : 64}px;height:${big ? 88 : 64}px;margin-left:-${big ? 10 : 7}px}
h1{font-family:"Inter Display",Inter,sans-serif;font-size:${big ? 58 : 30}px;line-height:1.05;letter-spacing:-.02em;font-weight:700}
p{font-size:${big ? 24 : 15}px;color:#b4b4b4;line-height:1.35}
.r{height:${h}px;overflow:hidden;margin-right:${big ? 90 : 0}px;box-shadow:-20px 0 50px rgba(0,0,0,.6)}
.r img{display:block;height:${Math.round(H * 0.82)}px;margin-top:${big ? 30 : 0}px}
</style></head><body><div class="l"><img class="i" src="${ICON}"><h1>Bulk Manager<br>für ChatGPT</h1>
<p>Chats gesammelt archivieren,<br>wiederherstellen und löschen.</p></div>${big ? `<div class="r"><img src="${panel}"></div>` : ""}</body></html>`;
}

(async () => {
  fs.mkdirSync(path.join(OUT, "screenshots"), { recursive: true });
  const panels = {};
  for (const s of SCENES) {
    const ctx = await launch({ width: W, height: H });
    await install(ctx, s.theme, { dataset: "store", patchDelay: 20 });
    const p = await ctx.newPage();
    await p.goto("https://chatgpt.com/");
    await p.waitForTimeout(700);
    const R = (sel) => p.locator("cgbm-root").locator(sel);
    await R(".edge").click();
    await R(".row").first().waitFor();
    await p.mouse.move(10, 10);
    await s.run(R, p);
    await p.mouse.move(PANEL_X - 20, 400);
    await p.waitForTimeout(450);
    const buf = await p.screenshot({ clip: { x: PANEL_X, y: 0, width: 440, height: H } });
    panels[s.file] = "data:image/png;base64," + buf.toString("base64");
    await ctx.close();
  }
  const ctx = await launch({ width: W, height: H });
  const p = await ctx.newPage();
  for (const s of SCENES) {
    await p.setViewportSize({ width: W, height: H });
    await p.setContent(slide({ ...s, panel: panels[s.file] }));
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(OUT, "screenshots", s.file + ".png") });
    console.log("screenshot", s.file);
  }
  await p.setViewportSize({ width: 440, height: 280 });
  await p.setContent(promo(440, 280));
  await p.screenshot({ path: path.join(OUT, "promo-small-440x280.png") });
  await p.setViewportSize({ width: 1400, height: 560 });
  await p.setContent(promo(1400, 560, panels["01-uebersicht"]));
  await p.screenshot({ path: path.join(OUT, "promo-marquee-1400x560.png") });
  console.log("promo tiles");
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
