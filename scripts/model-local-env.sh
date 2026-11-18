# Points this shell's services at the one local model backend (scripts/model-local), answered by
# `claude -p` on your Claude Code login. bash/zsh:  source scripts/model-local-env.sh
# Only in the shell that runs the services: Claude Code itself reads ANTHROPIC_BASE_URL too.
# For the Bedrock wire instead: eval "$(scripts/model-local env --bedrock)".
# Not named *.env: the repo never commits *.env files (CLAUDE.md, Never commit).
eval "$("$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)/model-local" env --sh)"
