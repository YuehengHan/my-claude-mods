# my-claude-mods

Claude Code mods (function-hook plugins) for working across many repos and many sessions at once — plus a pet.

| Mod | What it does |
| --- | --- |
| **where-am-i** | A band above the prompt: `📁 repo  🌿 branch ↑2  ± 3 changed  🎯 task`. `/task <text>` names what this session is doing. |
| **done-ping** | When a turn over 30 s finishes: a macOS notification (repo, duration, your prompt) and a spoken "backend-ng done". Also speaks up when Claude is waiting on a permission prompt. |
| **repo-guard** | Blocks `push --force`, pushes to main/master, `reset --hard`, `clean -f`, `checkout .`, `branch -D`, `stash clear`, `rm -rf ~`. Asks before Claude first edits a repo other than the session's own. |
| **claude-pet** | A status-line pet that earns xp from your work, grows 🥚 → 🦅, gets dizzy on errors, sleeps when you're away, and unlocks achievements. `/pet`, `/pet name <name>`. |
| **claude-mood** | Claude's mood in the status line: 🤔 reading, ✍️ writing, 🧪 testing, 😤 after a few errors, 😌 when done — with 📖 ✏️ ⚡ 💥 counters. |

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

Edit a mod, then run `/reload-plugins` in a session.

Check and test a mod:

```
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```
