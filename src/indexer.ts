import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CUSTOM_TYPE_INDEX, CUSTOM_TYPE_SUMMARY, type IndexEntryData, type ToolCallRecord } from "./types.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizePersistedRecord(value: unknown): ToolCallRecord | undefined {
  if (!isPlainObject(value)) return undefined;

  const args = value.args;
  if (
    typeof value.toolCallId !== "string" ||
    typeof value.toolName !== "string" ||
    typeof value.resultText !== "string" ||
    !isPlainObject(args) ||
    typeof value.isError !== "boolean" ||
    typeof value.order !== "number" ||
    !Number.isFinite(value.order)
  ) {
    return undefined;
  }

  const record: ToolCallRecord = {
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    args,
    resultText: value.resultText,
    isError: value.isError,
    order: value.order,
  };

  if ("timestamp" in value) {
    if (typeof value.timestamp !== "number" || !Number.isFinite(value.timestamp)) return undefined;
    record.timestamp = value.timestamp;
  }

  return record;
}

export class PruneIndexer {
  private readonly records = new Map<string, ToolCallRecord>();

  reconstructFromSession(ctx: ExtensionContext): void {
    this.records.clear();

    const indexedRecords: ToolCallRecord[] = [];
    const summarizedIds = new Set<string>();

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === CUSTOM_TYPE_INDEX) {
        const data = entry.data;
        if (isPlainObject(data) && Array.isArray(data.toolCalls)) {
          for (const record of data.toolCalls) {
            const normalized = normalizePersistedRecord(record);
            if (normalized) indexedRecords.push(normalized);
          }
        }
        continue;
      }

      if (entry.type !== "custom_message" || entry.customType !== CUSTOM_TYPE_SUMMARY) continue;
      const details = entry.details;
      if (!isPlainObject(details) || !Array.isArray(details.toolCallIds)) continue;
      for (const id of details.toolCallIds) {
        if (typeof id === "string") summarizedIds.add(id);
      }
    }

    for (const record of indexedRecords) {
      if (summarizedIds.has(record.toolCallId)) {
        this.records.set(record.toolCallId, record);
      }
    }
  }

  has(toolCallId: string): boolean {
    return this.records.has(toolCallId);
  }

  get(toolCallId: string): ToolCallRecord | undefined {
    return this.records.get(toolCallId);
  }

  ids(): Set<string> {
    return new Set(this.records.keys());
  }

  size(): number {
    return this.records.size;
  }

  add(records: ToolCallRecord[], pi: ExtensionAPI): void {
    pi.appendEntry(CUSTOM_TYPE_INDEX, { toolCalls: records } satisfies IndexEntryData);
    for (const record of records) {
      this.records.set(record.toolCallId, record);
    }
  }

  remove(toolCallIds: Iterable<string>): void {
    for (const toolCallId of toolCallIds) {
      this.records.delete(toolCallId);
    }
  }
}
