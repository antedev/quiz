# 🌍 Livslinjen & GeoGuesser – Historisk Världsatlas

An interactive historical & contemporary geography quiz and biographical explorer built with **React 19**, **TypeScript**, **Vite**, and **Leaflet**, powered by curated **Wikidata** and **Wikipedia** data (7,829 figures from 1500 BC to today).

Live domain target: **[https://quiz.ante.pub](https://quiz.ante.pub)**

---

## ✨ Main Features & Views

The application has three main modes accessible from the top navigation bar:

1. **🧭 GeoGuesser (Default View)** — [`src/components/GeoGuesserView.tsx`](src/components/GeoGuesserView.tsx)
   - **Map-based biographical detective game**: You see where and when a mystery person was born and died (with a geodesic life-journey curve across the map).
   - **Game Modes (`LifeStatusFilter`)**:
     - **🏛️ Historiska (Default)**: 5,725 deceased historical figures with complete lifespans and birth-to-death trajectories.
     - **🌟 Nu levande (Living)**: 2,104 living figures. Because living people lack a death year and death place on the map, the **Profile clue** (Category, Gender & Country) is automatically unlocked for free at the start of the round.
     - **🎲 Båda (Both)**: All 7,829 figures mixed.
   - **5-Step Clue Ladder**:
     1. **Profil** (Category, Gender & Citizenship) — `-75 p` *(Free for living people)*
     2. **Yrke & Roll** (Occupations + year-scrubbed Wikidata description) — `-150 p`
     3. **Kända verk & Bedrifter** (Notable works) — `-200 p`
     4. **Wikipedia-sammanfattning** (Name-redacted Wikipedia intro) — `-300 p`
     5. **Porträtt** (Wikimedia Commons portrait) — `-350 p`
   - **Smart Wrong-Guess Feedback ("Ghost Pins")**: Wrong guesses appear on the map and generate comparison cards showing shared categories, gender, citizenship, occupations, timeline overlap, and distance in km. Shared traits automatically surface as green hint badges on unopened clue cards.
   - **🏆 5-Round Match Mode**: Play a 5-round challenge with customizable filters (Historical/Living, Century, Difficulty Tier, Swedish-only) and get a ranked summary up to 7,500 points.

2. **⏳ Tidslinje (Timeline Explorer)** — [`src/components/TimelineView.tsx`](src/components/TimelineView.tsx)
   - Interactive horizontal timeline scrubbing from antiquity to the present day. See who was alive in any given year.

3. **🗂️ Uppslagsverk (Card Explorer)** — [`src/App.tsx`](src/App.tsx), [`src/components/PersonCard.tsx`](src/components/PersonCard.tsx), [`src/components/PersonModal.tsx`](src/components/PersonModal.tsx)
   - Browse, search, and filter all 7,829 figures by era, difficulty tier, Swedish connection, living status, or solved status. Click any person to inspect their full biography, contemporaries, and launch them directly in GeoGuesser.

4. **👤 Spelarprofil & Statistik** — [`src/components/ProfileModal.tsx`](src/components/ProfileModal.tsx), [`src/engine/profileStore.ts`](src/engine/profileStore.ts)
   - Local multi-profile support with solved person tracking, match history, and JSON export/import backup.

---

## 🏗️ Project Structure

```text
├── public/
│   └── data/
│       ├── people.json            # Compiled dataset of 7,829 people (Wikidata CC0)
│       └── wiki_summaries.json    # Pre-fetched & name-redacted Wikipedia intros (sv & en)
├── pipeline/                      # Offline data pipeline (Node/tsx scripts)
│   ├── config.ts                  # Pool sizes, century quotas, QLever/Wikidata endpoints
│   ├── 01-candidates.ts           # Fetches top global & Swedish candidates via SPARQL
│   ├── 02-entities.ts             # Enriches birth/death dates, coordinates, occupations, works
│   ├── 03-media.ts                # Resolves Wikimedia Commons thumbnails & licenses
│   ├── 04-build.ts                # Applies overrides, categorizes, assigns tiers -> people.json
│   └── 05-wikipedia.ts            # Fetches & redacts sv/en Wikipedia summaries -> wiki_summaries.json
├── data/
│   ├── overrides.json             # Manual curation overrides for specific Wikidata Q-IDs
│   ├── selection.json             # Candidate selection output from step 01
│   └── report.json                # Pipeline build statistics
├── src/
│   ├── App.tsx                    # Top-level view router, encyclopedia grid & profile integration
│   ├── components/
│   │   ├── GeoGuesserView.tsx     # Main map game, HUD, filters, clue ladder & 5-round match mode
│   │   ├── geoguesser/ClueCard.tsx# Collapsible clue card component with hint & free badges
│   │   ├── TimelineView.tsx       # Interactive year-scrubber timeline view
│   │   ├── PersonCard.tsx         # Card item in encyclopedia view
│   │   ├── PersonModal.tsx        # Detailed person modal with Wikipedia link & contemporaries
│   │   └── ProfileModal.tsx       # Player stats, history, profile switcher & JSON backup
│   ├── engine/
│   │   ├── classification.ts      # Maps occupations to 11 quiz categories & calculates tiers
│   │   ├── clues.ts               # Toponymic place-name masking (getSafePlaceName) & contemporaries
│   │   ├── fuzzySearch.ts         # Forgiving diacritic/typo-tolerant autocomplete search
│   │   ├── guessFeedback.ts       # Haversine distance & attribute comparison on wrong guesses
│   │   ├── profileStore.ts        # LocalStorage player profiles, solved IDs & match records
│   │   ├── sessionPersistence.ts  # Saves active round & match state across tab reloads
│   │   └── wikipedia.ts           # Loads local wiki_summaries.json with live REST API fallback + redaction
│   └── types/
│       └── person.ts              # Shared TypeScript interfaces for Person, Place, HistDate, etc.
├── Dockerfile                     # Multi-stage Node 22 build -> Nginx Alpine static server
├── docker-compose.yml             # Container definition for RPi5 / production hosting
├── nginx.conf                     # Gzip compression & cache headers for static JSON & assets
└── DEPLOY_RPI5.md                 # Agent/operator instructions for RPi5 + cloudflared deployment
```

---

## 🚀 Development & Commands

```bash
# Install dependencies
npm install

# Start local development server (http://localhost:5173)
npm run dev

# Type-check with TypeScript
npm run typecheck

# Run unit test suite (Vitest)
npm test

# Build production bundle into dist/
npm run build
```

### Re-running the Data Pipeline (Optional / Offline)
The built datasets (`public/data/people.json` and `public/data/wiki_summaries.json`) are committed directly to the repository so production deployments do not need to run the pipeline. To refresh data from Wikidata/Wikipedia:
```bash
npm run data
```

---

## 🍓 Deploying on Raspberry Pi 5 (`quiz.ante.pub`)

See **[DEPLOY_RPI5.md](DEPLOY_RPI5.md)** for full instructions on running the Docker container and wiring up the Cloudflare Tunnel (`cloudflared`) for `quiz.ante.pub`.
