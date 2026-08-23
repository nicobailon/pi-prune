export const CUSTOM_TYPE_INDEX = "pi-prune-index";
export const CUSTOM_TYPE_SUMMARY = "pi-prune-summary";
export const STATUS_WIDGET_ID = "pi-prune";

export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  resultText: string;
  isError: boolean;
  order: number;
  timestamp?: number;
}

export interface IndexEntryData {
  toolCalls: ToolCallRecord[];
}

export interface SummaryDetails {
  toolCallIds: string[];
  toolNames: string[];
  count: number;
  rawChars: number;
  summaryChars: number;
  recoveryVerified: boolean;
  timestamp: number;
}
