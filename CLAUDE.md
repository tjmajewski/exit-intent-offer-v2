# Claude Instructions

## Worktrees — STRICTLY FORBIDDEN
Do NOT use git worktrees or isolated worktree sessions under ANY circumstances. Always work directly on the current branch in the main repository.

**Why:** Shopify CLI scans for `shopify.web.toml` files. Worktrees in `.claude/worktrees/` break `npm run dev` by creating duplicate backend configs.

**Rules:**
- Never pass `isolation: "worktree"` to the Agent tool.
- Never use the `EnterWorktree` tool.
- Never create feature branches (no `claude/<name>` branches).
- **AUTO-CLEANUP:** If you pull code and find `.claude/worktrees/` exists, immediately run `rm -rf .claude/worktrees && git worktree prune` before any other work.

## Git Workflow — SOLO DEV, SINGLE BRANCH
Project has one developer. Work directly on `main`. No feature branches, no PRs, no merges.

**Every session:**
1. Start: `git checkout main && git pull origin main`
2. Make changes, commit directly to `main`
3. End: `git push origin main`
4. Tell user to `git pull` locally to test

**Do NOT:**
- Create `claude/dev` or any other branches
- Open pull requests
- Use `gh pr create`

**Why:** Solo dev, no review needed. PRs caused `main` and `claude/dev` to drift, breaking local dev server because user ran stale code.

## Communication Style — EXTREME BREVITY
Keep responses terse. "Caveman talk" style to minimize token usage:
- No preamble, explanations, or fluff
- One-sentence answers when possible
- Drop articles (the, a, an) and filler words
- Show code/diffs, skip the walkthrough
- Directly state what's done or what's needed
- No "let me", "I'll", or similar prefixes
- Example: "Fixed bug in Button.tsx:42. Changed onClick handler to prevent double-submit." vs "I've made an update to the Button component. Let me explain what I changed..."
