# Chrome Web Store: Eintragstexte und Dashboard-Antworten

Alles hier ist zum direkten Einfügen gedacht. Die Felder im Tab „Datenschutz“ sind auf Englisch, weil das Review-Team sie so am zuverlässigsten liest.

## Paket

- Upload: `dist/bulk-manager-for-chatgpt-<version>.zip` (erzeugt mit `scripts/build-zip.sh` oder als Release-Asset)

## Store-Eintrag

| Feld | Wert |
|---|---|
| Name | *(aus dem Manifest)* Bulk Manager für ChatGPT |
| Zusammenfassung | *(aus dem Manifest)* Chats in ChatGPT durchsuchen, auswählen und gesammelt archivieren, wiederherstellen oder löschen. |
| Kategorie | Produktivität → Tools |
| Sprache | Deutsch |
| Store-Icon | `store/icon-128.png` |
| Screenshots | `store/screenshots/01-uebersicht.png` … `05-archiv.png` (1280×800) |
| Kleine Promo-Kachel | `store/promo-small-440x280.png` |
| Marquee (optional) | `store/promo-marquee-1400x560.png` |
| Offizielle URL | – (keine verifizierte Domain nötig) |
| Startseite | https://aemjay.github.io/bulk-manager-for-chatgpt/ |
| Support | https://github.com/aemjay/bulk-manager-for-chatgpt/issues |
| Altersfreigabe / Inhalte | keine nicht jugendfreien Inhalte |

### Beschreibung

```
Räumen Sie Ihre ChatGPT-Chats in Sekunden auf, statt jeden Chat einzeln über „…“ → „Löschen“ → „Bestätigen“ zu entfernen.

Ein Klick auf das Erweiterungssymbol (oder Alt+Shift+B) öffnet auf chatgpt.com ein Seitenpanel mit all Ihren Chats, gruppiert nach Datum wie in ChatGPT.

AUSWÄHLEN
• Klick wählt einen Chat, Shift+Klick einen ganzen Bereich
• Klick auf eine Gruppenüberschrift (Heute, Gestern, Monat …) wählt die ganze Gruppe
• Live-Suche mit Hervorhebung; „Alle auswählen“ gilt dann nur für die Treffer
• Schnellauswahl: älter als 30, 90 oder 365 Tage oder „alle außer die ältesten N“
• Angeheftete Chats werden bei Sammelauswahl automatisch übersprungen

AUFRÄUMEN
• Archivieren mit „Rückgängig“
• Eigener Archiv-Tab: wiederherstellen oder endgültig löschen
• Löschen mit Vorschau und Warnung, falls ausgewählte Chats gerade durch die Suche ausgeblendet sind
• Fortschrittsanzeige mit Restzeit, jederzeit anhaltbar
• Automatische Drosselung bei Ratenlimits; fehlgeschlagene Chats bleiben markiert und ausgewählt

DATENSCHUTZ
• Läuft vollständig lokal im Browser
• Keine Konten, keine Server, kein Tracking, keine Werbung
• Daten gehen ausschließlich an chatgpt.com und nur für die Aktionen, die Sie auslösen
• Chat-Inhalte werden nicht gelesen, nur Titel und Zeitstempel für die Liste
• Quelloffen: https://github.com/aemjay/bulk-manager-for-chatgpt

Kostenlos und ohne Limits.

Hinweis: Gelöschte Chats lassen sich nicht wiederherstellen. Die Erweiterung nutzt die Web-Schnittstellen von chatgpt.com und kann bei Änderungen durch OpenAI vorübergehend ausfallen.

Kein Produkt von OpenAI. ChatGPT ist eine Marke von OpenAI.
```

## Tab „Datenschutz“

### Single purpose

```
Bulk management of the user's own ChatGPT conversations: on chatgpt.com, list, search and select conversations and archive, restore or delete them in bulk.
```

### Permission justification

**storage**
```
Stores a single user preference locally (the number N used by the quick selection "all except the oldest N"). No other data is stored.
```

**scripting**
```
Used only when the user clicks the toolbar icon on a chatgpt.com tab that was already open before the extension was installed. In that case the extension's own packaged content script (content.js) is injected into that tab so the panel opens without a page reload. No remote or dynamically generated code is executed.
```

**Host permission (https://chatgpt.com/*)**
```
The extension's single purpose operates on chatgpt.com only. It displays the management panel on the page, reads the user's own conversation list (IDs, titles, timestamps) from chatgpt.com's web endpoints using the user's existing session, and sends archive, restore or delete requests to chatgpt.com only when the user explicitly clicks the corresponding button. No other sites are accessed.
```

### Remote code

`No, I am not using remote code.`

### Data usage

Anzukreuzen (konservativ, weil die Store-Richtlinie auch rein lokale Verarbeitung als „handling“ zählt):

- [x] **Authentication information** – the chatgpt.com session token, used in memory only to authorize first-party requests to chatgpt.com
- [x] **Website content** – conversation titles and timestamps, used in memory only to display the list

Alle anderen Kategorien bleiben leer.

Zertifizierungen, alle drei anhaken:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

```
https://aemjay.github.io/bulk-manager-for-chatgpt/privacy.html
```

## Tab „Vertrieb“

- Bezahlung: kostenlos
- Sichtbarkeit: **Nicht gelistet**
- Regionen: alle

## Test instructions (falls abgefragt)

```
Requires a ChatGPT account (the free tier is sufficient). Sign in at https://chatgpt.com, then click the extension's toolbar icon (or the small tab on the right edge of the page, or press Alt+Shift+B). The panel lists the account's conversations. Archiving is reversible via the "Rückgängig" (undo) button in the toast; deleting asks for confirmation first.
```
