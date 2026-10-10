# Vier Gewinnt mit Coolify – Klick für Klick

Dauer: ca. 30 Minuten. Kein Terminal nötig.

**Prinzip:** Dein Code liegt auf GitHub → Coolify holt ihn ab → baut daraus einen Docker-Container → stellt ihn unter deiner Domain mit HTTPS ins Netz.

> Hinweis: Coolify ändert Menübezeichnungen gelegentlich zwischen Versionen. Wenn ein Begriff bei dir anders heißt, such nach dem sinngemäß gleichen Feld – oder schick mir einen Screenshot.

---

## 0. Gesundheitscheck: Funktioniert Coolify?

Da beim Experimentieren schon etwas schiefging, prüfen wir zuerst die Basis:

1. Coolify im Browser öffnen (meist `http://DEINE-SERVER-IP:8000`) und einloggen.
2. Links **Servers** → `localhost` anklicken.
   - Status soll **„Reachable“ / grün** sein.
   - Unter **Proxy** soll **Traefik** als **„Running“** angezeigt werden. Falls nicht: Button **„Start Proxy“**.
3. Links **Projects**: Gibt es alte Experimente, die dieselbe Domain nutzen, die du gleich verwenden willst? Dann dort die Domain entfernen oder die Ressource löschen – sonst kommen sich beide in die Quere.

✅ Wenn Server grün und Proxy läuft: weiter. ❌ Sonst: Screenshot an mich.

## 1. GitHub-Account und Repository (einmalig)

GitHub ist ein kostenloser Online-Speicher für Code – mit Versionsgeschichte. Coolify holt den Code von dort.

1. Auf **github.com** einen kostenlosen Account anlegen.
2. Oben rechts **„+“ → „New repository“**.
   - Name: `vier-gewinnt`
   - Sichtbarkeit: **Public** (einfachster Weg; der Code enthält keine Geheimnisse)
   - Häkchen bei „Add a README“ **setzen** → **Create repository**.
3. Im neuen Repository: **„Add file“ → „Upload files“**.
4. Die **Inhalte** des entpackten Ordners `vier-gewinnt-coolify` per Drag & Drop hineinziehen:
   `Dockerfile`, `package.json`, `server.js` und den Ordner `public`.
   (Diese Anleitung kannst du mit hochladen, muss aber nicht.)
5. Unten **„Commit changes“**.

Prüfen: Im Repository muss `public` als Ordner mit 4 Dateien darin sichtbar sein.

## 2. Domain auf den Server zeigen lassen

Beim Domain-Anbieter im DNS-Bereich:

| Typ | Name | Wert |
|---|---|---|
| A | `vier` | DEINE-SERVER-IP |

→ ergibt `vier.deine-domain.de`. Wirksam nach 5–60 Minuten.

## 3. Spiel in Coolify anlegen

1. **Projects** → ein Projekt öffnen (oder **„+ Add“** für ein neues, z. B. „Spiele“) → Umgebung **production**.
2. **„+ New“ / „+ Add Resource“** → **„Public Repository“**.
3. URL einfügen: `https://github.com/DEIN-NAME/vier-gewinnt` → **Check repository**.
4. **Build Pack: „Dockerfile“** auswählen (nicht Nixpacks!).
5. **Continue / Save**.

## 4. Einstellungen der Ressource

Im Tab **Configuration → General**:

| Feld | Wert |
|---|---|
| **Domains** | `https://vier.deine-domain.de` (mit `https://`!) |
| **Ports Exposes** | `3000` |

→ **Save**.

Im Tab **Persistent Storage** (oder „Storages“):

- **„+ Add“ → Volume Mount**
- Name: `spieldaten`
- **Destination Path:** `/app/data`
- → **Save**

Ohne diesen Schritt ist die Spielhistorie nach jedem Update weg.

## 5. Deploy

- Oben **„Deploy“** klicken.
- Tab **Logs / Deployments** zeigt den Bauvorgang (1–3 Min.).
- Fertig, wenn im **Logs**-Tab der Zeile steht: `Vier Gewinnt läuft auf Port 3000`.

Dann **https://vier.deine-domain.de** öffnen. 🎉

Beim allerersten Aufruf kann eine Zertifikatswarnung kommen, solange Traefik das Zertifikat noch holt – 1–2 Minuten warten und neu laden.

---

## Später: Code ändern

1. Auf GitHub die geänderte Datei öffnen → Stift-Symbol (Bearbeiten) oder erneut **Upload files** (gleicher Name überschreibt).
2. **Commit changes**.
3. In Coolify **„Redeploy“**.

## Wenn etwas nicht klappt

| Symptom im Browser | Wahrscheinliche Ursache |
|---|---|
| Seite lädt gar nicht / Zeitüberschreitung | DNS noch nicht aktiv, oder Port 80/443 beim Anbieter gesperrt |
| „404 page not found“ (schlichte Textseite) | Traefik findet keine App zur Domain → Domain-Feld prüfen (mit `https://`), danach Redeploy |
| „Bad Gateway“ | Ports Exposes ist nicht `3000`, oder Container abgestürzt → Logs prüfen |
| Zertifikatswarnung bleibt | DNS zeigte beim Deploy noch nicht auf den Server → Redeploy |
| Spiel lädt, aber „Verbindung unterbrochen“ | WebSocket wird blockiert → Logs + Screenshot an mich |

Im Zweifel: Screenshot vom **Logs**-Tab an mich.
