# my-claude-mods

Claude Code mods (function-hook plugins) for working across many repos and many sessions at once — plus a pet.

| Mod | What it does |
| --- | --- |
| **where-am-i** | A band above the prompt: `📁 repo  🌿 branch ↑2  ± 3 changed  🎯 task`. `/task <text>` names what this session is doing. |
| **done-ping** | A macOS notification (repo, duration, your prompt) with a sound per kind: 🔔 Glass when a turn over 30 s is done, Basso when it failed, Submarine when Claude is waiting on you. Change them in `SOUNDS`. |
| **repo-guard** | Blocks `push --force`, pushes to main/master, `reset --hard`, `clean -f`, `checkout .`, `branch -D`, `stash clear`, `rm -rf ~`. Asks before Claude first edits a repo other than the session's own. |
| **claude-pet** | A pet that earns xp from your work, grows 🥚 → 🦅 and unlocks achievements. It stays out of the status line except for news (level up, achievement, streak, dizzy) — `/pet` anytime, `/pet name <name>`. |
| **claude-mood** | Claude's mood beside the working spinner — `Creating notes.md… 🤔 在读代码 📖8 ✏️2` — gone when the turn ends. |
| **control-tower** | `/tower` opens a pane listing every Claude session on this machine: ✋ waiting for you, ⏳ working, ✅ done, with its task and last answer. The status line tells you when *another* session needs you. |
| **tldr** | A one-line `💡 TL;DR` under every long answer (Haiku), so a session you switch back to reads at a glance. |
| **sdk-sync** | Release audit for the SpatialReal SDKs. Never acts while you work: when a new `v*` tag appears it reminds you once; `/release-check <repo> [tag]` gathers the facts (public API files changed, CHANGELOG entry, commits in each sibling SDK / docs / examples since the release, version pins) and asks Claude for a read-only audit table. `/release-check status` lists unchecked releases; `--facts` skips the audit. Graph: `plugins/sdk-sync/hooks/sdk-map.ts`. |
| **fortune** | Programmer jokes in place of the spinner's random verb while Claude works (the desktop's step names are kept); the day's first prompt shows 今日运势 (`/fortune`). Fridays never deploy. |

## Install

At a Claude Code terminal prompt:

```
/plugin marketplace add YuehengHan/my-claude-mods
/plugin install where-am-i@my-claude-mods
/plugin install done-ping@my-claude-mods
/plugin install repo-guard@my-claude-mods
/plugin install claude-pet@my-claude-mods
/plugin install claude-mood@my-claude-mods
```

Pick the user scope so they load in every session. Install only the ones you want.

## Developing

Add a local clone as the marketplace instead, and Claude Code reads the plugins straight from the folder:

```
claude plugin marketplace add ~/Desktop/my-claude-mods
claude plugin install where-am-i@my-claude-mods --scope user
```

Claude Code runs an installed copy, so after editing a mod bump its `version` in `plugin.json`, then:

```
claude plugin marketplace update my-claude-mods
claude plugin update <mod>@my-claude-mods
```

and run `/reload-plugins` (or restart) in each open session.

Check and test a mod:

```
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```
