// End-to-End-Test gegen den Mock-Server: node tests/e2e.js [dark|light]
const { install, launch } = require("./mock");

let failed = 0;
// In GitHub Actions zusätzlich als Annotation ausgeben: Annotationen sind ohne Anmeldung lesbar.
const GHA = !!process.env.GITHUB_ACTIONS;
const annotate = (level, msg) => GHA && console.log(`::${level}::${String(msg).replace(/\r?\n/g, " ").slice(0, 900)}`);
const check = (cond, msg) => {
  console.log((cond ? "ok   " : "FAIL ") + msg);
  if (!cond) { failed++; annotate("error", `[${process.argv[2] || "dark"}] FAIL ${msg}`); }
};

(async () => {
  const theme = process.argv[2] || "dark";
  const ctx = await launch();
  annotate("notice", `[${theme}] Browser ${ctx.browser() ? ctx.browser().version() : "?"}`);
  const state = await install(ctx, theme, { rate: 9, failIds: ["c0022-aaaa-bbbb"], patchDelay: 30, latency: +process.env.LATENCY_MS || 0 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { console.log("pageerror:", e.message); failed++; });
  await p.goto("https://chatgpt.com/");
  await p.waitForTimeout(800);
  const R = (sel) => p.locator("cgbm-root").locator(sel);
  const count = (sel) => R(sel).count();
  // Wartet, bis der sichtbare Toast zum regulären Ausdruck passt (robust gegen langsame Umgebungen).
  const waitToast = (re, timeout = 30000) =>
    p.waitForFunction(
      (src) => {
        const t = document.querySelector("cgbm-root").shadowRoot.querySelector(".toast");
        return t && !t.hidden && new RegExp(src).test(t.querySelector(".tm")?.textContent || "");
      },
      re.source,
      { timeout }
    );

  // Öffnen über die Toolbar-Action (Service Worker -> Content Script)
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    chrome.tabs.sendMessage(tab.id, { type: "cgbm-toggle" });
  });
  await R(".row").first().waitFor();
  check((await count(".row")) === 230, "230 Chats geladen");
  check((await R('.tab[data-tab="active"] .cnt').textContent()) === "230", "Tab-Zähler 230");

  await R(".row").nth(1).click();
  await R(".row").nth(6).click({ modifiers: ["Shift"] });
  check((await count(".row.sel")) === 6, "Shift-Klick wählt Bereich (6)");

  await R(".search input").fill("python");
  await p.waitForTimeout(200);
  const hits = await count(".row");
  check(hits > 0 && hits < 230, `Suche filtert (${hits} Treffer)`);
  await R('[data-act="clear-q"]').click();
  await R('[data-act="clear-sel"]').click();

  await R('[data-act="menu"]').click();
  await R(".mi.keep").click();
  check((await count(".row.sel")) === 230 - 4 - 2, "Alle außer die ältesten 4, ohne 2 angeheftete");
  const oldestSel = await p.evaluate(() =>
    [...document.querySelector("cgbm-root").shadowRoot.querySelectorAll(".row")].slice(-4).some((r) => r.classList.contains("sel")));
  check(!oldestSel, "Älteste 4 bleiben unausgewählt");

  await R('[data-act="ask-delete"]').click();
  check((await count(".confirm")) === 1, "Löschen fragt nach");
  await p.keyboard.press("Escape");
  check((await count(".confirm")) === 0, "Esc bricht Bestätigung ab");

  await R('[data-act="clear-sel"]').click();
  await R(".search input").fill("Refactoring");
  await p.waitForTimeout(200);
  await R(".master").click();
  const delCount = await count(".row.sel");
  await R('[data-act="ask-delete"]').click();
  await R('[data-act="do-delete"]').click();
  await R(".toast:not([hidden])").waitFor({ timeout: 60000 });
  check(state.deleted.size === delCount - 1, `Löschlauf inkl. 429-Wiederholung (${state.deleted.size}/${delCount})`);
  check((await count(".row.err")) === 1, "Fehlgeschlagener Chat markiert");
  check((await count(".row.sel")) === 1, "Fehlgeschlagener Chat bleibt ausgewählt");

  await R('[data-act="clear-q"]').click();
  await R('[data-act="clear-sel"]').click();
  await R(".row").nth(0).click();
  await R(".row").nth(2).click({ modifiers: ["Shift"] });
  const before = await count(".row");
  const archIds = await p.evaluate(() =>
    [...document.querySelector("cgbm-root").shadowRoot.querySelectorAll(".row.sel")].map((r) => r.dataset.id));
  const patchesFor = (ids) => state.log.filter((l) => l.kind === "patch" && ids.includes(l.id)).length;
  await R('[data-act="archive"]').dblclick(); // Doppelklick darf keinen zweiten Lauf starten
  await waitToast(/3 Chats archiviert/);
  await p.waitForTimeout(300);
  check((await count(".row")) === before - 3, "3 archiviert und aus Liste entfernt");
  check(patchesFor(archIds) < 6, `Doppelklick startet keinen zweiten Lauf (${patchesFor(archIds)} Aufrufe für 3 Chats)`);
  await R(".toast .ta").click();
  await waitToast(/wiederhergestellt/);
  await R(".row").first().waitFor();
  await p.waitForTimeout(300);
  check((await count(".row")) === before, "Rückgängig stellt 3 wieder her");
  const stillHidden = await p.evaluate(() => [...document.querySelectorAll("nav li")].filter((li) => li.style.display === "none").length);
  check(stillHidden === 0, "Seitenleisten-Einträge nach Rückgängig wieder sichtbar");

  await R(".row").nth(2).click();
  await R(".row").nth(10).click();
  await R(".search input").fill("Kiwix");
  await p.waitForTimeout(200);
  await R(".row").first().click();
  await R('[data-act="ask-delete"]').click();
  check((await count(".confirm .warn")) >= 1, "Warnung bei durch Suche ausgeblendeter Auswahl");
  await R('[data-act="cancel-confirm"]').click();
  await R('[data-act="clear-q"]').click();
  await R('[data-act="clear-sel"]').click();

  await R('.tab[data-tab="archived"]').click();
  await R(".list .row").first().waitFor();
  await R(".row").nth(0).click();
  check((await count('[data-act="unarchive"]')) === 1, "Archiv-Tab bietet Wiederherstellen");

  // ---------- Sicherheits-Regressionstests (Review vom 22.10.2026) ----------
  const sel = () => count(".row.sel");
  const patches = () => state.log.filter((l) => l.kind === "patch");
  await R('.tab[data-tab="active"]').click();
  await R(".list .row").first().waitFor();

  // R02: Sammelauswahl darf nie angeheftete Chats hinzufügen
  const rowsAll = await count(".row");
  await R(".master").click();
  check((await sel()) === rowsAll - 2, "R02: gemischte Liste – Master überspringt 2 angeheftete");
  await R('[data-act="clear-sel"]').click();
  await R(".search input").fill("Merkliste");
  await p.waitForTimeout(200);
  check((await count(".row")) === 2, "R02: Suche liefert nur angeheftete Treffer");
  await R(".master").click();
  check((await sel()) === 0, "R02: Master wählt keine angehefteten");
  await R(".ghead").first().click();
  check((await sel()) === 0, "R02: Gruppenauswahl wählt keine angehefteten");
  await R(".row").first().focus();
  await p.keyboard.press("Control+a");
  check((await sel()) === 0, "R02: Strg+A wählt keine angehefteten");
  await R(".row").first().click();
  check((await sel()) === 1, "R02: angehefteter Chat manuell wählbar");
  await R(".master").click();
  check((await sel()) === 0, "R02: Master wählt manuell gewählte angeheftete wieder ab");
  await R('[data-act="clear-q"]').click();
  await p.waitForTimeout(150);

  // H01: synthetische Ereignisse aus der Seite dürfen nichts auslösen
  const shadow = (fn) => p.evaluate(fn); // läuft in der Hauptwelt der Seite, nicht im Content Script
  await shadow(() => document.querySelector("cgbm-root").shadowRoot.querySelector(".row").click());
  await p.waitForTimeout(150);
  check((await sel()) === 0, "H01: synthetischer Klick wählt nichts aus");
  await R(".row").first().click();
  const pBefore = patches().length;
  await shadow(() => {
    const r = document.querySelector("cgbm-root").shadowRoot;
    r.querySelector('[data-act="archive"]').click();
    r.querySelector('[data-act="ask-delete"]').click();
    r.querySelector(".list").dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, composed: true }));
  });
  await p.waitForTimeout(800);
  check(patches().length === pBefore, "H01: synthetische Klicks lösen keinen Schreibaufruf aus");
  check((await count(".confirm")) === 0, "H01: synthetischer Klick öffnet keine Löschbestätigung");
  check((await sel()) === 1, "H01: synthetische Tastatur ändert Auswahl nicht");
  await R('[data-act="clear-sel"]').click();

  // R01a: Kontowechsel ohne Neuladen, altes Token bleibt gültig (Worst Case) -> kein Schreibaufruf
  await R(".row").nth(0).click();
  await R(".row").nth(1).click();
  const pA = patches().length;
  state.switchSession({ token: "tok-B", user: "user-B" });
  await R('[data-act="archive"]').click();
  let hinted = true;
  await waitToast(/Nichts wurde ausgeführt/).catch(() => (hinted = false));
  await p.waitForTimeout(300);
  check(patches().length === pA, "R01: nach Kontowechsel kein Schreibaufruf");
  check(hinted, "R01: Hinweis auf Kontowechsel");
  check((await sel()) === 0, "R01: Auswahl nach Kontowechsel verworfen");
  await R(".row").first().waitFor();
  check(state.log.filter((l) => l.kind === "list").pop().auth === "tok-B", "R01: Liste danach mit neuer Sitzung geladen");

  // R01b: Neu laden holt eine frische Sitzung (Token-Rotation, gleiches Konto)
  state.switchSession({ token: "tok-B2" });
  await R('.titlebar [data-act="reload"]').click();
  await p.waitForFunction(() => {
    const r = document.querySelector("cgbm-root").shadowRoot;
    return !r.querySelector(".skel") && r.querySelectorAll(".row").length > 0;
  }, null, { timeout: 30000 });
  await p.waitForTimeout(300);
  check(state.log.filter((l) => l.kind === "list").pop().auth === "tok-B2", "R01: Neu laden nutzt frisches Token");

  // R01c: Token läuft mitten im Lauf ab, gleiches Konto -> Wiederholung mit neuem Token erlaubt
  await R(".row").nth(0).click();
  await R(".row").nth(1).click();
  state.switchAfterPatches = { n: 1, to: { token: "tok-B3" }, revokeOld: true };
  await R('[data-act="archive"]').click();
  let rotated = true;
  await waitToast(/2 Chats archiviert/).catch(() => (rotated = false));
  check(rotated, "R01: Token-Rotation im Lauf, beide archiviert");
  check(patches().pop().auth === "tok-B3", "R01: Wiederholung mit rotiertem Token derselben Identität");
  await R(".toast .tx").click();

  // R01d: Kontowechsel mitten im Lauf (altes Token widerrufen) -> Abbruch, nichts unter neuem Konto
  await R(".row").nth(0).click();
  await R(".row").nth(2).click({ modifiers: ["Shift"] });
  state.switchAfterPatches = { n: 1, to: { token: "tok-C", user: "user-C" }, revokeOld: true };
  await R('[data-act="archive"]').click();
  await waitToast(/abgebrochen/);
  check(!patches().some((l) => l.auth === "tok-C"), "R01: kein Schreibaufruf mit dem Token des neuen Kontos");
  await R(".row").first().waitFor();
  check((await sel()) === 0, "R01: Auswahl nach Abbruch verworfen");

  await ctx.close();
  console.log(failed ? `\n${failed} Fehler` : "\nAlle Tests bestanden");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  annotate("error", `[${process.argv[2] || "dark"}] Abbruch: ${e && e.message}`);
  process.exit(1);
});
