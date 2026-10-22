const CHATGPT = /^https:\/\/chatgpt\.com\//;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id || !CHATGPT.test(tab.url || "")) {
    chrome.tabs.create({ url: "https://chatgpt.com/" });
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "cgbm-toggle" });
  } catch {
    // Tab war schon offen, bevor die Erweiterung installiert wurde: Skript nachladen.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "cgbm-toggle" });
  }
});
