# RapaceGo (玄清围弈)

> A Windows desktop Go (weiqi) tool: **play against KataGo, read objective numbers,
> and hear a local language model explain the moves in plain Chinese.**
> Everything runs on your own machine — no cloud, no uploading your games.

[简体中文](README.md) · English

![Main window](docs/screenshots/main-with-coach.png)

---

## What it is

The goal isn't "another Go GUI" — it's a narrow one: **after a game, know where you went wrong and why.**

So it pairs two things and keeps their roles strictly separate:

| Component | Role |
|---|---|
| **KataGo** (engine) | The numbers — winrate, score lead, candidate moves, territory, points lost per move. Objective, never flatters you. |
| **LoGos** (local 7B model) | The words — explains *why* a move was good or bad, and what the engine preferred at that moment. |

**Verdicts come from KataGo's numbers; explanations come from LoGos.**
This split is deliberate: tested against obviously bad moves, the language model happily
invents a justification for them. So it never gets to judge — only to explain.

---

## Features

**Play** — human-style opponents rated by amateur rank (20k–9d, plus "pre-AI era" and
"pro style by year"); handicap done the standard way; free-placement / two-player mode;
scratch-play ("what if") board; 9/13/19 lines; Chinese / Japanese / Korean / Ming-Qing rules;
5 time-control presets with byo-yomi beeps and **loss on time**.

**Numbers** — winrate bar & score, recommended moves, move previews, ownership map
(fog or blocks), winrate/score graph, per-move loss list, and a **review report**
(black/white split: average loss, blunder counts, agreement with AI's top choice).

**Explanation** — three panels, all powered by the local LoGos model:
- **Explain this move** — verdict from KataGo, reasoning from LoGos. Stored per move.
- **Explain candidates** — several recommended points, each explained.
- **Explain whole game** — narrates every move of an SGF once; **the result is saved
  next to the SGF**, so reopening it shows the commentary instantly.

![Whole-game commentary](docs/screenshots/batch-progress.png)

**Game library** — import / export / rename / delete / search SGFs, with badges for
"reviewed" and "has commentary".

**Manual engine loading** — the app starts with **no engine loaded** (zero VRAM).
Click the indicator in the top bar when you want AI:

![Engine indicators](docs/screenshots/engine-menu.png)

---

## Hardware requirements

**VRAM is the real constraint** — both KataGo and the commentary model live in it.

| | Minimum | Recommended |
|---|---|---|
| OS | Windows 10 / 11 (64-bit) | same |
| RAM | 8 GB | 16 GB |
| GPU | 4 GB VRAM (or integrated graphics — KataGo alone is fine) | **8 GB VRAM** (RTX 3060 / 4060 or better) |
| Disk | ~2 GB | ~8 GB (if you want the commentary model) |

Measured VRAM usage (RTX 4070 Laptop / 8 GB, read with `nvidia-smi`):

| Component | Usage |
|---|---|
| KataGo analysis engine (winrate, candidates, territory, review) | ≈ **350 MB** |
| KataGo play engine (AI moves) | ≈ **170 MB** |
| LoGos commentary model (Q4_K_M, 7B) | ≈ **4.9 GB** |
| **All three at once** | ≈ **5.5 GB** |

- **6 GB VRAM works**, but don't load all three at once (unload one first)
- **4 GB / integrated graphics**: KataGo features only — commentary will keep saying
  "commentary model not loaded"
- **To run all three at once you want 8 GB**

> This is exactly why the app **loads no engine at all by default** — if you're not using
> AI, nothing occupies VRAM. Click the indicator in the top bar when you need it, and
> unload when you're done.

**No discrete GPU?** KataGo runs CPU-only (changeable in Settings) — slow, but playable.
The commentary model also runs on CPU but drops to a few characters per second, which is
effectively unusable.

---

## ⚠️ Neither the repo nor the download bundles the engines or the model

Only the application code is here (about 600 KB). To actually run it you must provide
your own copies — they are third-party projects with their own licenses:

| What | Where from | Put it at |
|---|---|---|
| **KataGo** binary | [lightvector/KataGo](https://github.com/lightvector/KataGo/releases) (Windows) | `<app>\KataGo\engine\katago.exe` |
| **KataGo weights** (two) | [katagotraining.org](https://katagotraining.org/) — one strong, one `human` | `<app>\KataGo\weights\*.bin.gz` |
| **llama.cpp** runtime | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp/releases), CUDA build (**the official zip does NOT bundle the CUDA runtime — grab the matching `cudart` zip too**) | `<app>\LoGos\llama-server.exe` |
| **LoGos-7B** weights | [YichuanMa/LoGos-7B](https://huggingface.co/YichuanMa/LoGos-7B), converted to GGUF (Q4_K_M ≈ 4.4 GB) | `<app>\LoGos\LoGos-7B-Q4_K_M.gguf` |

Lay them out like this and it just works (the app looks **next to itself**):

```
RapaceGo/
├─ RapaceGo.exe
├─ KataGo/
│  ├─ engine/katago.exe
│  └─ weights/b11c768nbt.bin.gz, b18c384nbt-humanv0.bin.gz
└─ LoGos/                        ← optional: skip it entirely if you don't want commentary
   ├─ llama-server.exe
   └─ LoGos-7B-Q4_K_M.gguf
```

**Just want to play, no commentary?** Prepare only the KataGo files — the commentary
features simply stay unused. Anywhere else works too: set it in the app's Settings, or
via the `RAPACEGO_KATAGO` / `RAPACEGO_LOGOS` environment variables.

### Option 1: download the portable build (recommended)

Grab it from the **[Releases page](https://github.com/Rapace7/RapaceGo/releases)**:

| File | Size | Notes |
|---|---|---|
| `RapaceGo.zip` | ~147 MB | **unzip and run — fastest startup** ⭐ |
| `RapaceGo.exe` | ~96 MB | single file, double-click (unpacks to temp on each launch) |

Drop the two engine folders next to it and you're done.

### Option 2: run from source (to change the code)

```
git clone https://github.com/Rapace7/RapaceGo.git
cd RapaceGo
npm install
start.bat            (double-click)
```

In source mode the engines go **one level above** the project folder, or you point at
them in Settings. `.npmrc` already carries Chinese mirrors so `npm install` is fast
domestically.

### Configure the paths

Open **Settings** (top-left) and point it at your files. Every field has a `?`
you can hover for what it is and where to find it:

![Settings](docs/screenshots/settings-help.png)

> **The classic mistake**: the *opponent* weight must be the one with `human` in its
> filename. Using a normal weight there makes the engine exit immediately.

---

## Notes on the commentary

- **Speed**: about 2–4 s for a 150–200 character explanation on an RTX 4070 Laptop.
  A full 200-move game takes roughly 8–12 minutes, can be stopped, and **resumes**
  where it left off.
- **⚠️ The commentary is always in Chinese.** LoGos (a 7B model fine-tuned on
  Chinese-annotated Go data) only outputs Chinese — even when both the system prompt
  and the user prompt are in English, it still answers in Chinese. This isn't a setting
  we can flip.
  **The practical workaround**: the commentary is plain prose, so just **select it and
  paste it into any translation tool or LLM** (Google Translate, DeepL, ChatGPT, etc.).
  It translates cleanly, and Go terminology comes through fine.
- **It makes mistakes**: LoGos is a 7B model. It sometimes uses the wrong technical
  term (calling a star point a komoku, etc.). **Positions are usually right, names may be wrong.**
  Trust KataGo's numbers over its wording.
- "Explain whole game" ≠ "AI review": the review produces a *data report*,
  the commentary produces *per-move prose*.

---

## How this was built (human + AI agent)

**Nearly all of the code was written by an AI agent.** This project is an experiment
in long-running human–AI collaboration:

- **The human** sets direction, decides features, judges usability, accepts results.
- **The AI agent** (running on [WorkBuddy](https://www.workbuddy.cn/docs/workbuddy/Overview))
  writes the code, researches APIs, runs the tests, writes docs, fixes bugs.

The development conversations were powered by **DeepSeek V4.1 Flash**.

The whole process is recorded in **[开发记录.md](开发记录.md)** (Chinese) — not a changelog,
but a *decision log*: why each feature is the way it is, which approaches were rejected,
what broke, and the measured numbers behind each choice.

The `_*.mjs` / `_rtest.py` files in the repo root are the self-check suite:
static checks (DOM references, IPC contract, `[hidden]` collisions), end-to-end smoke tests,
and cross-game race regression. They run in seconds after every change.

---

## FAQ

**"Engine not found"?** Open Settings and fix the paths (see the table above).

**"Commentary model not loaded"?** Click the `LoGos` indicator in the top bar → Load.
Not loading it by default is intentional (saves VRAM).

**llama-server is extremely slow (seconds per character)?**
It's probably running on CPU — the official Windows CUDA build ships **without** the
CUDA runtime. Run `llama-server.exe --list-devices`; if it prints `none`, download the
matching `cudart-*.zip` from the same llama.cpp release and drop the DLLs next to the exe.

**Where are my games?** In `records\` next to the app.

**Can I redistribute it bundled with the model?** Please don't — LoGos is licensed for
research / non-commercial use only, and 4.4 GB doesn't travel well anyway.

---

## License & credits

This project's code: **MIT** (see [LICENSE](LICENSE)).

It depends on excellent open-source work, each under its own license:

- [KataGo](https://github.com/lightvector/KataGo) — the engine (MIT).
- [LoGos / InternThinker-Go](https://huggingface.co/YichuanMa/LoGos-7B) (Shanghai AI Lab) —
  the explaining model. ⚠️ Its model card says Apache-2.0, but the project README states
  the data is **CC BY-NC 4.0, research use only** — **treat it as non-commercial.**
- [llama.cpp](https://github.com/ggml-org/llama.cpp) — inference runtime (MIT).
- [Electron](https://www.electronjs.org/) — desktop shell (MIT).

The UI, rules engine, SGF I/O and the commentary pipeline are original code in this repo.
