# Claude Instructions

## Worktrees — STRICTLY FORBIDDEN
Do NOT use git worktrees or isolated worktree sessions under ANY circumstances. Always work directly on the current branch in the main repository.

**Why:** This is a Shopify CLI app. Shopify CLI scans the entire project tree for `shopify.web.toml` files. Worktrees create full repo copies inside `.claude/worktrees/`, each containing their own `shopify.web.toml`. This causes Shopify CLI to detect duplicate backend configurations and **completely breaks `npm run dev`**, blocking all local development until the worktree directories are manually deleted.

**Rules:**
- Never pass `isolation: "worktree"` to the Agent tool.
- Never use the `EnterWorktree` tool.
- Never create branches like `claude/<worktree-name>` — only use `claude/dev`.
- If you see `.claude/worktrees/` exists with subdirectories, delete them immediately with `rm -rf` and run `git worktree prune`.

## Git Workflow
- All work goes to the single `claude/dev` branch. Do not create new branches per session.
- Never push directly to `main`.
