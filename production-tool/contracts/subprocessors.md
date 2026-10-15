# Who receives an agency's material

Generated from `subprocessors.json` (updated 2026-10-15) by `subprocessors.py`; do not edit by hand.
The Production Tool's Data sharing sheet shows the same entries with the agency's own allowlist.

| Company | What it does | What it receives | Through | Where | Turned on |
|---|---|---|---|---|---|
| Amazon Web Services | Hosts the tool: the relay, the job ledger, saved projects, the library and every uploaded or generated file. | Everything the tool keeps for the agency. |  | Ireland (eu-west-1); source: infra/envs/hackathon, the region of every resource | Always: every agency |
| Runway | Generates pictures and video. Every model the tool runs is reached through Runway's API. | The words, reference pictures, frames and clips a job sends. |  | Not yet confirmed | On while the agency allows this maker (on by default) |
| Google | Makes the Gemini picture models and the Veo video models. | What a job sends to a Gemini or Veo model. | Runway | Not yet confirmed | On while the agency allows this maker (on by default) |
| Ideogram | Makes the Ideogram picture-editing model. | What a job sends to an Ideogram model. | Runway | Not yet confirmed | On while the agency allows this maker (on by default) |
| Magnific | Makes the Magnific upscalers. | The picture or clip a job upscales. | Runway | Not yet confirmed | On while the agency allows this maker (on by default) |
| Kuaishou (Kling) | Makes the Kling video models. | What a job sends to a Kling model: words, frames, reference pictures and clips to edit. | Runway | Not yet confirmed | On while the agency allows this maker (on by default) |
| MiniMax (Hailuo) | Makes the Hailuo video model. | What a job sends to a Hailuo model: words, frames and reference pictures. | Runway | Not yet confirmed | On while the agency allows this maker (on by default) |
| Alibaba (WAN) | Makes the WAN video model. | What a job sends to a WAN model: words, frames and reference pictures. | Runway | Not yet confirmed | On while the agency allows this maker (on by default) |
| ByteDance (Seedance) | Makes the Seedance video models. | What a job sends to a Seedance model: words, frames, reference pictures and clips to edit. | Runway | Not yet confirmed | On while the agency allows this maker (on by default) |
| Anthropic (Claude on Amazon Bedrock) | Directs each job and reads reference pictures for the director. | The words, the script and the reference pictures of a job. | Amazon Web Services | Amazon Bedrock EU cross-region inference; source: production-tool/relay/director/claude.py, whose model ids start eu. | On unless the agency turns Claude off (on by default) |
