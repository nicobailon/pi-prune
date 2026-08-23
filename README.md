# pi-prune

`pi-prune` is a small manual context-pruning extension for Pi. Run `/prune` when a session has accumulated noisy tool output and you want to compact it on purpose.

The command waits for Pi to be idle, summarizes every unpruned text-only `toolResult` in the current branch with the active model, stores the exact raw text outputs in session state, and replaces those raw tool results in future model context with tiny non-error placeholders. The underlying session history is not rewritten.

## Install

This copy is installed as a global user extension at:

```text
~/.pi/agent/extensions/pi-prune/index.ts
```

Pi auto-discovers directory extensions in `~/.pi/agent/extensions/*/index.ts`. If Pi was already running when the files changed, run `/reload` once so the current session loads the latest extension code. New Pi sessions load it automatically.

For a project-local copy, place the same directory at:

```text
.pi/extensions/pi-prune/index.ts
```

## Quick start

Create some tool output in a Pi session, then run:

```text
/prune
```

If there are no new text tool results to compact, Pi shows `Nothing to prune`.

When pruning starts, Pi shows an animated above-editor status like `⠹ Compacting context... (escape to cancel)` and a notification. Press Escape to cancel the summarizer request. `/prune` is a blocking extension command, so text input resumes when compaction finishes or is cancelled.

When pruning succeeds, Pi adds a very compact visible `pi-prune` summary to the transcript and shows a completion notice with:

- how many tool results were trimmed
- raw text size versus summary size
- the tools involved
- whether the recovery index was verified
- a reminder that Pi's built-in context percentage updates after the next model turn

## What gets pruned

`pi-prune` only compacts text-only `toolResult` messages that have not already been pruned in the current branch. Tool results containing images or other non-text blocks are left alone so recoverability is not downgraded.

Future model context keeps the assistant tool-call messages and replaces each pruned tool result with a short placeholder. That preserves the `toolCallId` pairing providers expect while removing the bulky output.

## Recovery

The visible summary does not dump every recoverable `toolCallId`. If exact output is needed later, the model can call `context_prune_query` with an ID from a pruned placeholder or the corresponding assistant tool-call metadata:

```json
{
  "toolCallIds": ["tool-call-id"]
}
```

The query accepts 1 to 20 IDs at a time. Each recovered output is truncated with Pi's standard tool-output limits, and the combined response is truncated again so recovery does not explode the active context. Tool result `details` include metadata only, not the full raw `resultText`.

You do not need to call `context_prune_query` just to validate `/prune`. The `/prune` command verifies that the raw outputs were stored in the recovery index before it reports success.

## Commands and tools

| Name | Type | Purpose |
|---|---|---|
| `/prune` | command | Manually summarize unpruned text tool results and replace them in future context with placeholders. |
| `context_prune_query` | tool | Retrieve exact original outputs for IDs listed in a `pi-prune` summary. |

## How it stores state

`pi-prune` uses branch-aware session entries:

- `pi-prune-index` custom entries store exact raw text outputs outside LLM context.
- `pi-prune-summary` visible custom messages store the generated summary and the recoverable IDs.

On session start or tree navigation, the runtime index is rebuilt from the current branch. An indexed record only becomes active when a matching visible summary is also present on that branch.

## Validation

Useful non-interactive checks:

```bash
cd ~/.pi/agent/extensions/pi-prune
npm pack --dry-run --json
pi -e ~/.pi/agent/extensions/pi-prune/index.ts --list-models
```

The full behavior requires a live Pi session because `/prune` calls the active model:

```text
/reload        # only needed if Pi was already running before edits
# create some text tool results
/prune
```

Confirm that the animated compaction-style status appears, Escape cancels an in-progress prune, a short `pi-prune` summary appears in the transcript after successful pruning, the completion notice reports trim stats and `Recovery index verified`, and input resumes after the command finishes. The built-in context percentage is expected to update after the next model turn, when Pi rebuilds and measures provider context.

## Limitations

There is no config file, no automatic trigger, no alternate model setting, no settings UI, no stats view, no tree browser, and no agentic pruning tool. `/prune` is the only pruning trigger.

Pi's built-in `/compact` can queue typed steering messages while compaction runs because it owns Pi core's `session.isCompacting` state. `pi-prune` runs as an extension command, so it can show the compaction-style loader and support Escape cancellation, but it cannot currently opt into the built-in `Steering:` queue display without a Pi core API for extension-owned compaction state.

Summarization uses the active model. If that model is unavailable, lacks credentials, or returns an error, `/prune` reports the error and does not activate pruning for that batch.

`pi-prune` is intentionally conservative with non-text results. It skips them rather than storing partial representations.

## Troubleshooting

If `/prune` is not available, run `/reload` or start a new Pi session. Also confirm the extension lives at `~/.pi/agent/extensions/pi-prune/index.ts`.

If `/prune` says `Nothing to prune`, the current branch either has no new text-only tool results or all eligible results were already pruned.

If recovery says an ID is not found, make sure the ID came from a `pi-prune` summary on the current branch. Tree navigation can move to a branch with different prune state.

If the context percentage does not change immediately after `/prune`, that is expected. `pi-prune` affects the next provider context build; Pi updates the built-in percentage after the next model turn.

If pruning fails during summarization, the original tool results remain unpruned. Fix the active model or credentials and run `/prune` again.
