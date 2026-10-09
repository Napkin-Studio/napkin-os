# Production Tool intro site

A static page introducing Napkin Studio Production to people trying it at the
event: what it is, the three stages, the crew, models, tips and an FAQ. It has
no build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000 --directory site/production-tool
```

All links are relative, so it works from any sub-path (for example
`https://<org>.github.io/<repo>/`).

## Files

| File | What it is |
|---|---|
| `index.html` | The page. The agent figures are inline SVG, rendered from `production-tool/web/src/ui/agents/AgentFigure.tsx`. |
| `styles.css` | Layout and the studio tokens (from `app/src/index.css`), light and dark through `prefers-color-scheme`. |
| `agents.css` | The figures' colours and motion, copied from `production-tool/web/src/ui/agents/AgentFigure.css`. |
| `site.js` | Sets the Try it link (see below) and stops the demo loops under `prefers-reduced-motion`. |
| `assets/` | Screenshots from a mock-relay test run (WebP, light and `-dark`), the coming Home page mockup, and the end card (versions 8 `roll-up` and 9 `roll-up-ink`) as short MP4 loops that open on the finished card, with WebP posters. |
| `pages.yml.example` | An unused GitHub Pages workflow. |

## Before publishing

1. **Try it link.** Set `TRY_IT_URL` at the top of `site.js`. While it's empty,
   every Try it button scrolls to "Get started", which asks people to get the
   link from the organisers.
2. **Check the "Rolling out" and "Coming soon" notes** still match what's live:
   - Models: Runway runs every step unless a participant adds a fal or HeyGen
     key; a job that fails on their key is made again on Runway. The automatic
     fallback is `features/runway-fallback.clan` (status `building` when this
     page was written), so the page marks it "Rolling out".
   - Home and projects: `features/project-home.clan`.

## Publishing with GitHub Pages

1. Copy `pages.yml.example` to `.github/workflows/pages.yml`. It uploads
   `site/production-tool` with `actions/upload-pages-artifact` and publishes
   it with `actions/deploy-pages`, on pushes to `main` that touch the folder,
   or by hand.
2. In the repo's Settings → Pages, set Source to **GitHub Actions**.
3. Merge through `develop` and a release to `main`, as usual.

Note: `Napkin-Studio/napkin-os` is private. GitHub Pages on a private repo
needs a paid plan (Team or Enterprise), and the published site is **public**
unless the organisation uses Enterprise Cloud's private Pages. Everything on
this page is meant to be public: no keys, client material or internal URLs.
