# Thai Flashcards

A self-hosted web app for learning Thai: flashcard decks fed by Google Sheets,
Azure neural text-to-speech, a consonant trainer, a number-listening game, and
AI-generated speaking practice.

## Modes

- **Vocab / Script** — flashcards loaded from your Google Sheets tabs, with
  audio, two directions (Thai-front / English-front), and per-deck progress.
- **Letters** — the 44 Thai consonants with class (high/mid/low) drills.
- **Numbers** — hear a Thai number, type what you heard; 7 escalating levels.
- **Speaking** — Gemini generates Thai sentences using only words you've studied.
- **MP3 export** — any vocab deck can be downloaded as a listen-and-repeat MP3
  (Thai → pause → English → pause → Thai), generated in the background.

## Quick start

```zsh
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

Then open http://localhost:5001. Fill in `.env` with your keys (see below).

Startup fetches every configured sheet tab in parallel and takes ~10 seconds;
the server starts listening once all decks are loaded.

## API keys (.env)

The app **works without any keys** — decks load from public Google Sheets.
Keys enable the paid features:

| Variable | Service | Enables |
|---|---|---|
| `AZURE_KEY` / `AZURE_REGION` | Azure Speech | word/sentence audio, numbers game, MP3 export |
| `GEMINI_KEY` | Google Gemini | Speaking mode sentence generation |

On Render, set these as environment variables in the dashboard instead.

## Managing decks

`config.json` is the single source of truth: each category maps a Google Sheet
ID to a list of tab names. To add a deck, add the tab in the spreadsheet, add
its name to `config.json`, and restart — or `POST /refresh` to reload without
restarting. Sheet columns: `Thai`, `Pronunciation`, `English`, and optional
`Override` (alternate text to use for audio).

## Endpoints

| Route | Notes |
|---|---|
| `GET /decks`, `GET /vocab/<deck_id>` | deck list / words |
| `POST /refresh` | reload decks from Sheets (2/min) |
| `POST /speak` `{text, speed}` | TTS, ≤300 chars (60/min per IP) |
| `POST /speak_number` `{number, speed}` | Thai number TTS (30/min) |
| `POST /generate_sentences` | Gemini sentences (5/min) |
| `POST /download_deck/<id>/start` | start background MP3 job (3/min, 20/hr) |
| `GET /download_status/<job_id>` | poll job progress |
| `GET /download_result/<job_id>` | fetch finished MP3 (one-shot) |
| `GET /progress`, `POST /complete/<deck>/<mode>`, `POST /reset/<deck>` | per-deck progress |

Rate limits are per-IP (flask-limiter). Endpoints that call paid APIs return
`503` on synthesis failure and `400` on bad input.

## Deployment notes (Render)

- `Procfile` runs gunicorn with **one worker process** + 8 threads. Keep it at
  one worker: the audio cache, rate limits, and MP3 job registry live in
  process memory.
- `nixpacks.toml` installs `ffmpeg`, required for MP3 export.
- `progress.json` sits on ephemeral disk — it is wiped on redeploy.
- Decks reload on every deploy; after editing the spreadsheet you can
  `POST /refresh` instead of redeploying.
