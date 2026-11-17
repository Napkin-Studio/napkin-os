# Outside repos: what runs

Each repo was cloned into a scratch folder outside this repo by a read-only subagent
(Sonnet 5.5), with every provider key unset. Nothing was pushed. No paid call was made.
Access is listed in docs/sources/repos.md. Eleven repos could not be opened and are not here.

## larryob78/napkin-art-director (Art Director Tool 1.0)

**Verdict: partly runs. It is a standalone prototype, not built.**

- **What it is.** Vanilla browser JavaScript plus one Node server (server.mjs, port 8766). No package.json, no framework, no build step. 59 files. Five commits, all on 18 Oct 2026.
- **Its own status.** There is no README. START HERE.md says "Standalone working prototype for Napkin OS... not a production-ready app" and marks itself AMBER. Unverified by its own account: mask fidelity, large uploads, browser PNG and ZIP export, voice, print export. "Napkin OS integration remain pending."
- **What the code does.** An image canvas editor with lasso masks, a Runway generate, edit and upscale path, a Digital Ads Formatter (13 presets, ZIP export) and a drawing board. It does not hold the scamp to photograph to formats flow as one pipeline.
- **Tests.** `node --test *.test.mjs *.test.cjs`: 80 tests, 77 pass, 0 fail, 3 skipped (no canvas renderer). Provider tests use mocks. Nothing is tested in a browser.
- **Smoke start.** `node server.mjs` printed ready and `GET /` returned 200.
- **Providers.** Black Forest Labs, Runway, OpenAI and NVIDIA. Keys are read server side from the environment. No key was found in client files; a full trace of every response path was not done.
- **Fonts and colours.** Georgia and dark greens. The prompt says it uses Hanken Grotesk and a fixed Napkin blue. That is wrong for this repo: neither appears.
- **State.** Browser IndexedDB, plus job receipts written to a folder outside the repo. No per-asset provenance record (model, seed, prompt, inputs).
- **Obstacles to wrapping it.** Global-scope scripts in three large files with no module system. It needs its own single-tenant server for every provider call. Hard-coded port and paths. No provenance.

## larryob78/Resize

**Verdict: runs, as its own local app. It is not a platform formats tool.**

- **What it is.** Node 20 with no npm dependencies: one HTTP server (src/server.js, 127.0.0.1:4173) and a vanilla JavaScript page. It wraps FFmpeg, ffprobe, optional Tesseract and Whisper, and a macOS-only Swift binary for people detection. 54 files, 44 commits, last on the default branch 18 Sep 2026. Two newer branches (24 Oct) hold research notes and a circular navigation.
- **What it does.** One video or still master becomes versions in four generic aspect ratios: 16:9, 9:16, 4:5 and 1:1. Video durations from 6 to 60 seconds. Review, approval bound to a revision, and export. config/presets.json says "Generic production sizes, not verified platform delivery specifications."
- **What it does not do.** No platform presets (Meta, TikTok, YouTube, LinkedIn, display), no platform frames, no animated formats other than video, no model-based reframing.
- **Checks it has.** Safe margins per aspect ratio, OCR flags for text lost in a crop, a title-fit measure.
- **Tests.** `node --test`: 86 tests, 86 pass, in 15 seconds, keys unset. No type-check or build exists.
- **Providers.** One optional call: ElevenLabs speech to text, key read server side, behind a consent switch. Its README says the saved key returned 401 on 12 Sep. Not run.
- **Obstacles to wrapping it.** It refuses foreign origins and says not to proxy it. It keeps its own accounts and JSON store. It needs FFmpeg and other binaries on the host, one of them macOS only. Its four ratios are a small part of the 12 formats v1 asks for.

## larryob78/Socials-ads-maker-

**Empty: confirmed.** No commits, no branches, no files.

## larryob78/napkin-radio

**Verdict: partly runs. Everything that needs no key runs. Script writing, voices and MP3 were not run, since each is a paid call.**

- **What it is.** Next.js 15, React 19, Tailwind, TypeScript. It is a small suite (Brief, Deck, Radio, Poster), not a radio-only app. 70 files, about 8,100 lines. Last commit on main 7 Sep 2026. Three newer branches (24 Oct) hold the latest radio work, one of them 8,800 lines ahead of main. They were not read.
- **Parser** (`lib/radio/parse.ts`). Reads FVO, MVO, VO, SFX and MUSIC, plus aliases. A one-line smoke test gave the right roles.
- **Quality gate** (`lib/radio/quality.ts`). Runs after generation, with no model. It checks word count against target, repeated lines, banned phrases, stage directions leaking into speech, and cast against voices used. It passes at 0.7 with no issues, and retries twice.
- **House style** (`lib/ai/house-style.ts`). Bans em and en dashes and about 40 overused words, then cleans the output.
- **Timing.** 2.6 words a second. The code offers 15, 30, 45, 60 and 90 seconds. The prompt says 10, 20, 30 and 40. Those lengths are not in the code.
- **Tests.** `npm install` succeeded. `npm run test:access`: 4 of 4. `npx tsc --noEmit`: clean. `npm run build`: succeeded. Only the password check has tests. The parser, the gate and the house style have none.
- **Providers.** Gemini writes scripts, with Groq as fallback. ElevenLabs does voices, speech and sound effects. Not Claude, and not through any router.
- **Keys.** Read from the server environment only. A search of the built browser bundle for key names found none.
- **Password.** HTTP Basic auth with one shared password, checked in constant time. It fails closed.
- **State.** None on the server. Scripts and audio live in the page and are lost on reload.
- **Reusable as plain logic.** `lib/radio/parse.ts`, `quality.ts`, `types.ts`, `audio.ts` (MP3 stitching with no FFmpeg) and `lib/ai/house-style.ts`.
- **Obstacles to moving it.** Every provider call is a Next route handler. The writing stack is Gemini and Groq. Nothing is saved.

## larryob78/napkin-audio

**Verdict: runs. It is not a duplicate of napkin-radio.**

- **What it is.** A separate Vite and React app, "Napkin Audio AI Studio", with a small provider proxy. 32 files, 8 commits, last on 26 Jun 2026. Almost no file is shared with napkin-radio.
- **What it has that radio lacks.** A script parser that also reads legal lines and calls to action, a runtime and legal-speed estimate, Irish radio station specs, cue sheet and quality-check exports, project import and export, and provider stand-ins for ElevenLabs and NVIDIA Riva.
- **What it lacks.** AI scripting, MP3 export and any password.
- **Tests.** `npm test`: 34 of 34. `npm run build`: succeeded.
- **So "fold it in" is the wrong instruction.** The two overlap in purpose, not in code. Radio should take the station specs, the legal-speed estimate and the cue sheet from it.

No committed key was found in either repo. A full pattern scan of napkin-audio did not run, so that is not verified.

## larryob78/idea-to-ooh-studio

**Verdict: it is not an outdoor tool. Nothing in it can be reused for Outdoor in situ.**

- **What it is.** A film director's 3D previsualisation app (`director-previz-studio/`): React 19, Vite, Three.js. 35 files. Three commits, last on 26 Mar 2026. The README's one line describes billboard prompts on an Akool API. The word Akool appears nowhere in the code.
- **What it lacks.** Every part of the Outdoor spec: no 48 sheet, 6 sheet, bus shelter, station panel or digital screen; no site photographs; no perspective mapping; no safe-area or legibility check.
- **Checks.** `npm install` succeeded. `npm run build` fails on two type errors in `CameraRig.tsx`. `npx vite build` alone succeeds. There are no tests.
- **Keys.** It calls Meshy, Trellis, World Labs and NVIDIA straight from the browser with `VITE_` keys. Any key set would ship in the browser bundle. That breaks the keys rule.
- **So Outdoor in situ is a new build**, not a wrap.

## larryob78/awards-board-maker

**Verdict: partly runs. Its retrieval is built on a Cannes image corpus, which the 10 Nov rule forbids.**

- **What it is.** Vanilla JavaScript with a Python server and Pillow. 111 files, 15 commits, last on 20 Sep 2026. It also carries an unrelated video editor (`promptcut/`, 54 files).
- **What it does.** One board size: A2 landscape at about 300 dpi. Three layouts, a type studio and a writing assistant. Campaign image, logo and font upload. PNG and raster PDF export, with a draft watermark until approved.
- **What it lacks.** Any per-show spec. Show rules exist only as prose in a skills file. No multi-board project was found.
- **Tests.** `python -m unittest discover -s tests`: 75 run, 1 error (a socket timeout, not diagnosed). `node tests/image_craft_test.js`: 18 of 18.
- **Providers.** Gemini for layout and writing, Runway for image craft. Keys are read server side.
- **The Cannes problem.** Its "RAG ON" switch reads a private corpus of 6,905 Cannes board images, and `learn_principles.py` sends sampled Cannes boards to Gemini. No such image is committed. The switch does nothing unless a corpus path is set. Neither was run.
- **So before any reuse:** remove the corpus retrieval and the learning script, and rewrite the Cannes wording in its prompts. The layout and export code is the reusable part.
