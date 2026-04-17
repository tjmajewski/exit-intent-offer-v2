# Claude Instructions

## Worktrees — STRICTLY FORBIDDEN
Do NOT use git worktrees or isolated worktree sessions under ANY circumstances. Always work directly on the current branch in the main repository.

**Why:** Shopify CLI scans for `shopify.web.toml` files. Worktrees in `.claude/worktrees/` break `npm run dev` by creating duplicate backend configs.

**Rules:**
- Never pass `isolation: "worktree"` to the Agent tool.
- Never use the `EnterWorktree` tool.
- Only use `claude/dev` branch — never create `claude/<worktree-name>` branches.
- **AUTO-CLEANUP:** If you pull code and find `.claude/worktrees/` exists, immediately run `rm -rf .claude/worktrees && git worktree prune` before any other work.

## Git Workflow
- All work goes to the single `claude/dev` branch. Do not create new branches per session.
- Never push directly to `main`.

## Communication Style — EXTREME BREVITY
Keep responses terse. "Caveman talk" style to minimize token usage:
- No preamble, explanations, or fluff
- One-sentence answers when possible
- Drop articles (the, a, an) and filler words
- Show code/diffs, skip the walkthrough
- Directly state what's done or what's needed
- No "let me", "I'll", or similar prefixes
- Example: "Fixed bug in Button.tsx:42. Changed onClick handler to prevent double-submit." vs "I've made an update to the Button component. Let me explain what I changed..."
