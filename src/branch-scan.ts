import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ToolCallRecord } from "./types.ts";

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  if (content.some((block) => block === null || typeof block !== "object" || Array.isArray(block) || (block as Record<string, unknown>).type !== "text")) return undefined;
  return content
    .map((block) => {
      const text = (block as Record<string, unknown>).text;
      return typeof text === "string" ? text : "";
    })
    .join("\n");
}

function toTimestamp(value: unknown, fallback?: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (typeof fallback === "number") return Number.isFinite(fallback) ? fallback : undefined;
  if (typeof fallback === "string") {
    const parsed = Date.parse(fallback);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/** Scans the current branch at command time and captures tool results not already pruned. */
export function collectUnprunedToolResults(branch: SessionEntry[], alreadyPruned: Set<string>): ToolCallRecord[] {
  const toolCalls = new Map<string, { toolName: string; args: Record<string, unknown> }>();

  for (const entry of branch) {
    const message = entry.type === "message" ? entry.message : undefined;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      const rawBlock = block as unknown as Record<string, unknown>;
      const rawArgs = rawBlock.arguments ?? rawBlock.input ?? rawBlock.args ?? {};
      toolCalls.set(block.id, {
        toolName: typeof block.name === "string" ? block.name : "unknown",
        args: rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs as Record<string, unknown> : {},
      });
    }
  }

  const records: ToolCallRecord[] = [];
  for (const entry of branch) {
    const message = entry.type === "message" ? entry.message : undefined;
    if (message?.role !== "toolResult" || typeof message.toolCallId !== "string") continue;
    if (alreadyPruned.has(message.toolCallId)) continue;

    const resultText = textFromContent(message.content);
    if (resultText === undefined) continue;

    const toolCall = toolCalls.get(message.toolCallId);
    const record: ToolCallRecord = {
      toolCallId: message.toolCallId,
      toolName: typeof message.toolName === "string" ? message.toolName : toolCall?.toolName ?? "unknown",
      args: toolCall?.args ?? {},
      resultText,
      isError: Boolean(message.isError),
      order: records.length + 1,
    };
    const timestamp = toTimestamp(message.timestamp, entry.timestamp);
    if (timestamp !== undefined) record.timestamp = timestamp;
    records.push(record);
  }

  return records;
}
