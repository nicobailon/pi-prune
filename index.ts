import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectUnprunedToolResults } from "./src/branch-scan.ts";
import { PruneIndexer } from "./src/indexer.ts";
import { registerContextPruneQueryTool } from "./src/query-tool.ts";
import { summarizeToolResults } from "./src/summarize.ts";
import { CUSTOM_TYPE_SUMMARY, STATUS_WIDGET_ID, type SummaryDetails } from "./src/types.ts";

const PRUNED_TOOL_RESULT_PLACEHOLDER = "Output pruned by pi-prune. See the pi-prune summary and use context_prune_query with this toolCallId to retrieve the exact original output.";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LOADER_WIDGET_ID = "pi-prune-loader";

export default function piPrune(pi: ExtensionAPI) {
  const indexer = new PruneIndexer();

  pi.on("session_start", async (_event, ctx) => {
    indexer.reconstructFromSession(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    indexer.reconstructFromSession(ctx);
  });

  pi.on("context", async (event) => {
    if (indexer.size() === 0) return undefined;

    let replaced = false;
    const messages = event.messages.map((message) => {
      if (message.role !== "toolResult" || typeof message.toolCallId !== "string" || !indexer.has(message.toolCallId)) {
        return message;
      }

      replaced = true;
      const replacement = {
        role: "toolResult",
        toolCallId: message.toolCallId,
        toolName: typeof message.toolName === "string" ? message.toolName : indexer.get(message.toolCallId)?.toolName ?? "unknown",
        content: [{ type: "text", text: PRUNED_TOOL_RESULT_PLACEHOLDER }],
        isError: false,
        timestamp: message.timestamp,
      } satisfies ToolResultMessage;
      return replacement;
    });

    return replaced ? { messages } : undefined;
  });

  registerContextPruneQueryTool(pi, indexer);

  pi.registerCommand("prune", {
    description: "Manually summarize old tool results and prune them from future context",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      const records = collectUnprunedToolResults(ctx.sessionManager.getBranch(), indexer.ids());
      if (records.length === 0) {
        ctx.ui.notify("Nothing to prune.", "info");
        return;
      }

      const rawCharsBeforeSummary = records.reduce((sum, record) => sum + record.resultText.length, 0);
      const abortController = new AbortController();
      const unsubscribeEscape = ctx.ui.onTerminalInput((data) => {
        if (data !== "\x1b") return undefined;
        abortController.abort();
        return { consume: true };
      });

      let spinnerIndex = 0;
      const updatePruneStatus = () => {
        const spinner = SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length];
        spinnerIndex++;
        const statusText = `${spinner} Compacting context... (escape to cancel)`;
        ctx.ui.setStatus(STATUS_WIDGET_ID, statusText);
        ctx.ui.setWidget(LOADER_WIDGET_ID, [statusText], { placement: "aboveEditor" });
      };
      updatePruneStatus();
      const statusTimer = setInterval(updatePruneStatus, 80);
      ctx.ui.setWorkingMessage("Compacting context... (escape to cancel)");
      ctx.ui.notify(`pi-prune started: summarizing ${records.length} tool result${records.length === 1 ? "" : "s"}. Press Escape to cancel.`, "info");

      try {
        const summary = await summarizeToolResults(records, ctx, abortController.signal);
        if (abortController.signal.aborted) {
          throw new Error("Prune cancelled");
        }
        const toolCallIds = records.map((record) => record.toolCallId);
        const toolNames = records.map((record) => record.toolName);
        const rawChars = rawCharsBeforeSummary;

        indexer.add(records, pi);

        const recoveryVerified = records.every((record) => {
          const indexed = indexer.get(record.toolCallId);
          return indexed?.resultText === record.resultText;
        });

        const details = {
          toolCallIds,
          toolNames,
          count: records.length,
          rawChars,
          summaryChars: summary.length,
          recoveryVerified,
          timestamp: Date.now(),
        } satisfies SummaryDetails;

        try {
          pi.sendMessage({
            customType: CUSTOM_TYPE_SUMMARY,
            content: summary,
            display: true,
            details,
          });
        } catch (error) {
          indexer.remove(toolCallIds);
          throw error;
        }
        const uniqueToolNames = [...new Set(toolNames)].slice(0, 6).join(", ");
        ctx.ui.notify(
          `pi-prune trimmed ${records.length} tool result${records.length === 1 ? "" : "s"}: ${rawChars.toLocaleString()} raw chars → ${summary.length.toLocaleString()} summary chars. Recovery index ${recoveryVerified ? "verified" : "not verified"}. Summary queued for the transcript. Context % will update after the next model turn.${uniqueToolNames ? ` Tools: ${uniqueToolNames}${new Set(toolNames).size > 6 ? ", …" : ""}.` : ""}`,
          recoveryVerified ? "info" : "warning",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cancelled = abortController.signal.aborted || message === "Prune cancelled" || (error instanceof Error && error.name === "AbortError");
        ctx.ui.notify(cancelled ? "Prune cancelled." : `Prune failed: ${message}`, cancelled ? "info" : "error");
      } finally {
        unsubscribeEscape();
        clearInterval(statusTimer);
        ctx.ui.setStatus(STATUS_WIDGET_ID, undefined);
        ctx.ui.setWidget(LOADER_WIDGET_ID, undefined);
        ctx.ui.setWorkingMessage();
      }
    },
  });
}
