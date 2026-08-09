# Welcome to Boucle Contradictoire

## How We Use Claude

Based on Claude's usage over the last 30 days:

Work Type Breakdown:
  Build Feature  ████████████████████  100%

_Note: this reflects a single session in the window, so the breakdown is thin. It'll fill out as more sessions accumulate._

Top Skills & Commands:
  /autocompact  ████████████████████  1x/month

Top MCP Servers:
  GitHub  ████████████████████  19 calls
  Render  ███████░░░░░░░░░░░░░  7 calls

## Your Setup Checklist

### Codebases
- [ ] boucle-contradictoire-version-claude — https://github.com/newbizai2023-ops/boucle-contradictoire-version-claude

### MCP Servers to Activate
- [ ] GitHub — pull requests, reviews, CI status, browsing code across the repo. Most-used server by a wide margin. Ask an org admin to authorize the GitHub App for `newbizai2023-ops`, then connect the GitHub MCP server.
- [ ] Render — the app's hosting: service config, deploy history, triggering deploys, logs. Ask to be added to the `new's workspace` Render team, then connect the Render MCP server.

### Skills to Know About
- [ ] `/autocompact` — controls when a long conversation gets summarized to free up context. Worth knowing because sessions on this repo run long: a full methodology change touches `server.js`, several `lib/` modules, tests, and docs in one pass.

## Team Tips

- **Every pull request bumps the version.** Increment `package.json` and add a CHANGELOG entry in the same PR, even for a docs-only change. We learned this the hard way: three different states of the service all shipped as "1.8.0", and a bug observed in production could no longer be tied to a state of the code. Patch for a fix or copy, minor for a backwards-compatible feature, major for a broken contract.

- **Verify a merge actually landed on `main`.** A merge reported as successful isn't proof. One PR here was merged against a stale branch head, so a fix that mattered stayed out of `main` for eleven hours while everyone believed it had shipped. After merging, run `git fetch origin main` and check that your commit is really an ancestor — `git merge-base --is-ancestor <sha> origin/main`.

- **Render deploys need to be triggered explicitly.** The service reports `autoDeploy: yes`, but no deploy in its history was ever triggered by a commit. Merging to `main` does not put your code online. Trigger the deploy yourself and confirm the live deploy points at the commit you expect.

## Get Started

Targeted research on disagreements — the next step laid out in [`docs/ANALYSE_METHODOLOGIE.md`](docs/ANALYSE_METHODOLOGIE.md) §6, action 2.

The second-opinion step already produces disagreements, their cause, and the question that would settle each one. Those questions feed the correction and the arbitration, but nothing guarantees any of them gets an answer. The task is to add a step that actually researches them, gives each disagreement a status (`OPEN`, `RESOLVED_A`, `RESOLVED_B`, `UNRESOLVED`), and blocks approval while a decisive disagreement stays open.

It's a good first task: self-contained, the analysis doc already frames the problem, and the surrounding patterns are worth reading — `lib/diverge.js` for how disagreements are produced, `lib/falsify.js` for how a conditional step is triggered and bounded, `lib/evidence.js` for how a claim is checked against real sources.

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
