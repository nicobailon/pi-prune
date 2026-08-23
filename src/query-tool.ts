import { Type } from "typebox";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { PruneIndexer } from "./indexer.ts";

const MAX_QUERY_IDS = 20;

export function registerContextPruneQueryTool(pi: ExtensionAPI, indexer: PruneIndexer): void {
  pi.registerTool({
    name: "context_prune_query",
    label: "Query Pruned Tool Outputs",
    description: "Retrieve exact original tool outputs that pi-prune manually compacted out of future context.",
    promptSnippet: "Retrieve exact original outputs for manually pruned toolCallIds",
    promptGuidelines: [
      "Use context_prune_query when a pi-prune summary is not detailed enough and you need exact original tool output.",
    ],
    parameters: Type.Object({
      toolCallIds: Type.Array(Type.String({ description: "Tool call IDs listed in a pi-prune summary" }), {
        description: "One or more pruned toolCallIds to retrieve",
        minItems: 1,
        maxItems: MAX_QUERY_IDS,
      }),
    }),

    async execute(_toolCallId, params) {
      const details: Record<string, unknown> = {};
      const blocks: string[] = [];

      for (const id of params.toolCallIds) {
        const record = indexer.get(id);
        if (!record) {
          details[id] = { found: false };
          blocks.push(`## toolCallId: ${id}\n(not found in pi-prune index — it may not have been pruned in this branch)`);
          continue;
        }

        const truncated = truncateHead(record.resultText, {
          maxBytes: DEFAULT_MAX_BYTES,
          maxLines: DEFAULT_MAX_LINES,
        });

        const resultDetails: Record<string, unknown> = {
          found: true,
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          args: record.args,
          isError: record.isError,
          order: record.order,
          outputTruncated: truncated.truncated,
        };
        if (record.timestamp !== undefined) resultDetails.timestamp = record.timestamp;
        details[id] = resultDetails;

        let body = truncated.content;
        if (truncated.truncated) {
          body += `\n[Output truncated: ${truncated.outputLines}/${truncated.totalLines} lines shown]`;
        }

        blocks.push([
          `## toolCallId: ${id}`,
          `Tool: ${record.toolName}`,
          `Args: ${JSON.stringify(record.args, null, 2)}`,
          `Status: ${record.isError ? "ERROR" : "OK"}`,
          `Order: ${record.order}`,
          `Timestamp: ${record.timestamp !== undefined ? new Date(record.timestamp).toISOString() : "unknown"}`,
          "",
          body,
        ].join("\n"));
      }

      const joined = blocks.join("\n\n---\n\n");
      const truncatedResponse = truncateHead(joined, {
        maxBytes: DEFAULT_MAX_BYTES,
        maxLines: DEFAULT_MAX_LINES,
      });
      let text = truncatedResponse.content;
      if (truncatedResponse.truncated) {
        text += `\n[Combined output truncated: ${truncatedResponse.outputLines}/${truncatedResponse.totalLines} lines shown]`;
      }

      return {
        content: [{ type: "text", text }],
        details: { results: details, outputTruncated: truncatedResponse.truncated },
      };
    },
  });
}
