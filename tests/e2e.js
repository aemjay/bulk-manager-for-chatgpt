// End-to-End-Test gegen den Mock-Server: node tests/e2e.js [dark|light]
const { install, launch } = require("./mock");

let failed = 0;
const check = (cond, msg) => { console.log((cond ? "ok   " : "FAIL ") + msg); if (!cond) failed++; };

(async () => {
  const theme = process.argv[2] || "dark";
  const ctx = await launch();
  const state = await install(ctx, theme, { rate: 9, failIds: ["c0022-aaaa-bbbb"], patchDelay: 30 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { console.log("pageerror:", e.message); failed++; });
  await p.goto("https://chatgpt.com/");
  await p.waitForTimeout(800);
  const R = (sel) => p.locator("cgbm-root").locator(sel);
  const count = (sel) => R(sel).count();

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
  await R('[data-act="archive"]').click();
  await R(".toast .ta").waitFor({ timeout: 20000 });
  await p.waitForTimeout(400);
  check((await count(".row")) === before - 3, "3 archiviert und aus Liste entfernt");
  await R(".toast .ta").click();
  await p.waitForFunction(() => {
    const r = document.querySelector("cgbm-root").shadowRoot;
    return !r.querySelector(".progress") && r.querySelectorAll(".row").length > 0;
  }, null, { timeout: 20000 });
  await p.waitForTimeout(500);
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

  await ctx.close();
  console.log(failed ? `\n${failed} Fehler` : "\nAlle Tests bestanden");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
