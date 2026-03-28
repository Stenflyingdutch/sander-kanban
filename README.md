# 🍳 Cookidoo Rezept-Finder

Chrome Extension die 10 zufällige Cookidoo-Rezepte findet und die Zutaten zur Einkaufsliste hinzufügt.

## Features

- **Intelligente Suche**: Durchsucht Cookidoo nach Rezepten in 3 Kategorien
  - 🥩 Fleisch (~4 Rezepte)
  - 🐟 Fisch (~3 Rezepte)
  - 🥬 Vegetarisch (~3 Rezepte)
- **Filter**: Nur Rezepte ≤45 Minuten Gesamtzeit mit Bewertung ≥4 Sterne
- **Auswahl-UI**: Rezepte durchstöbern, einzeln auswählen oder abwählen
- **Einkaufsliste**: Ausgewählte Rezepte direkt zur Cookidoo-Einkaufsliste hinzufügen
- **Fallback**: Falls automatisch nicht möglich, werden Links zum manuellen Hinzufügen angezeigt

## Installation

1. Lade diesen Ordner herunter (oder entpacke die ZIP)
2. Öffne Chrome und gehe zu `chrome://extensions/`
3. Aktiviere den **Entwicklermodus** (Schalter oben rechts)
4. Klicke **"Entpackte Erweiterung laden"**
5. Wähle den `cookidoo-recipe-finder` Ordner aus
6. Die Extension erscheint in der Chrome-Toolbar

## Benutzung

1. Öffne [cookidoo.de](https://cookidoo.de) und **logge dich ein**
2. Klicke auf das Extension-Icon in der Toolbar (🍳)
3. Klicke **"Rezepte finden"** — die Extension sucht nun nach passenden Rezepten
4. Wähle die gewünschten Rezepte aus (Checkbox oder Karte klicken)
5. Klicke **"Zur Einkaufsliste hinzufügen"**
6. Fertig! Öffne die Einkaufsliste um die Zutaten zu sehen

## Voraussetzungen

- Google Chrome (oder Chromium-basierter Browser)
- Aktives Cookidoo-Abo (für Zugriff auf Rezepte und Einkaufsliste)
- Eingeloggt auf cookidoo.de

## Hinweise

- Die Extension nutzt deine bestehende Cookidoo-Session (Cookies)
- Es werden keine Daten an Dritte übertragen
- Die Suche kann 10-20 Sekunden dauern (abhängig von Netzwerk)
- Falls Cookidoo sein Layout ändert, müssen ggf. die CSS-Selektoren im Content Script angepasst werden

## Troubleshooting

| Problem | Lösung |
|---------|--------|
| "Bitte öffne cookidoo.de" | Navigiere zuerst zu cookidoo.de |
| Keine Rezepte gefunden | Prüfe ob du eingeloggt bist und ein aktives Abo hast |
| Einkaufsliste funktioniert nicht | Nutze die Fallback-Links zum manuellen Hinzufügen |
| Extension reagiert nicht | Seite neu laden, dann Extension erneut öffnen |

## Technische Details

- **Manifest V3** Chrome Extension
- Content Script auf cookidoo.de injiziert
- Nutzt `fetch()` mit `credentials: 'include'` für authentifizierte Requests
- DOM-Parsing der Suchergebnisse via `DOMParser`
- Einkaufsliste via Cookidoo-interne API oder Fallback auf manuelle Links

## Lokale Kanban Web-App

Zusätzlich gibt es jetzt eine kleine Web-App, die dein Markdown-Todo-Board direkt liest und zurückschreibt.

1. Starte lokal: `node server.js`
2. Öffne dann [http://localhost:4173](http://localhost:4173)
3. Standard-Datei ist `/Users/henk/.openclaw/workspace/StenVault/01_denken/Todos.md`

Optional kannst du einen anderen Pfad setzen:

```bash
TODOS_MD_PATH="/pfad/zu/Todos.md" node server.js
```

Features der Web-App:

- Spalten aus den Markdown-Abschnitten in `Todos.md`
- Karten per Drag-and-Drop verschieben, auch auf Touch-Geräten
- Neue Todos anlegen, bearbeiten, löschen
- Per Button auf `Erledigt` setzen oder wieder reaktivieren
- Jede Änderung schreibt die Tabellen zurück in die Markdown-Datei
