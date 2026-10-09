# my-claude-mods

Claude Code mods (function-hook plugins) for working across many repos and many sessions at once — plus a pet.

| Mod | What it does |
| --- | --- |
| **where-am-i** | A band above the prompt: `📁 repo  🌿 branch ↑2  ± 3 changed  🎯 task`. `/task <text>` names what this session is doing. |
| **done-ping** | A macOS notification (repo, duration, your prompt) with a sound per kind: 🔔 Glass when a turn over 30 s is done, Basso when it failed, Submarine when Claude is waiting on you. Change them in `SOUNDS`. |
| **repo-guard** | Blocks `push --force`, pushes to main/master, `reset --hard`, `clean -f`, `checkout .`, `branch -D`, `stash clear`, `rm -rf ~`. Asks before Claude first edits a repo other than the session's own. |
| **claude-pet** | A pet that earns xp from your work, grows through five stages and unlocks achievements. Pick a species (`/pet species`: chick, cat, dog, dragon, dino, ocean, bug, plant, robot, moon) or your own emojis (`/pet emoji 🦊`, `/pet emoji 🥚 🐣 🦊 🐺 🐉`). Lives in the status line (`🦮 xixi (・_・)📖  Lv7 ▰▱▱▱▱▱`) with 18 moods that follow Claude: 💭 thinking, 📖 reading, ✍️ writing, ⚡ running, 🧪 testing, 🌐 browsing, 📣 delegating, ✋ waiting for you, 🔥 on a 25-call streak, 🌙 past 1am, 🎉 tests pass, 📦 commit/push, (×_×) error, (╬ಠ益ಠ) three in a row, bored after 5 idle minutes, asleep after 15. `/pet` for stats, `/pet name <name>`. |
| **claude-mood** | Claude's mood in the status line: 🤔 reading, ✍️ writing, 🧪 testing, 😤 after a few errors, 😌 when done — with 📖 ✏️ ⚡ 💥 counters. |
| **control-tower** | A row under where-am-i's, shown only while another session waits for you (a permission or a question): `✋ backend-ng 在等你 2m  [tower]`. `/tower` (or the button) opens a pane listing every Claude session on this machine, named `repo · branch` for worktrees. |
| **tldr** | After every long answer, a dim `💡 TL;DR` line (Haiku) in the transcript, so a session you switch back to reads at a glance. |
| **sdk-sync** | Release audit for the SpatialReal SDKs. Never acts while you work: when a new `v*` tag appears it reminds you once; `/release-check <repo> [tag]` gathers the facts (public API files changed, CHANGELOG entry, commits in each sibling SDK / docs / examples since the release, version pins) and asks Claude for a read-only audit table. `/release-check status` lists unchecked releases; `--facts` skips the audit. Graph: `plugins/sdk-sync/hooks/sdk-map.ts`. |
| **fortune** | Programmer jokes after the working spinner (`Sauteing…  🎲 Gradle 同步完，咖啡也凉了。`), written fresh each day by Haiku for the repo you are in (its stack, from the top-level files), shared by every session in that repo; built-in jokes until they arrive. The day's first prompt shows 今日运势 (`/fortune`). Fridays never deploy. |

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
