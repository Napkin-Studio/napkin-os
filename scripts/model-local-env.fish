# Points this shell's services at the one local model backend (scripts/model-local), answered by
# `claude -p` on your Claude Code login. fish:  source scripts/model-local-env.fish
# Only in the shell that runs the services: Claude Code itself reads ANTHROPIC_BASE_URL too.
# For the Bedrock wire instead: scripts/model-local env --fish --bedrock | source
# Not named *.env: the repo never commits *.env files (CLAUDE.md, Never commit).
set -l model_local (path resolve (dirname (status filename)))/model-local
$model_local env --fish | source
