import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeToolResults } from "../src/summarize.ts";
import type { ToolCallRecord } from "../src/types.ts";

// A model from an extension-registered provider: its API is only known to Pi's
// model registry, not to any built-in API implementation.
const model = {
  id: "fake-model",
  name: "Fake Model",
  api: "fake-extension-api",
  provider: "fake-extension-provider",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 4096,
};

const record: ToolCallRecord = {
  toolCallId: "call-1",
  toolName: "bash",
  args: { command: "echo hi" },
  resultText: "hi",
  isError: false,
  order: 1,
};

function fakeContext() {
  const calls: Array<{ model: unknown; context: any; options: any }> = [];
  const ctx = {
    model,
    modelRegistry: {
      async getApiKeyAndHeaders() {
        return { ok: true, apiKey: "test-key", headers: {} };
      },
      async complete(callModel: unknown, context: unknown, options: unknown) {
        calls.push({ model: callModel, context, options });
        return {
          role: "assistant",
          content: [{ type: "text", text: "Registry summary text." }],
          stopReason: "stop",
        };
      },
    },
  };
  return { ctx: ctx as any, calls };
}

test("summarizes through the model registry with a fresh one-shot session", async () => {
  const signal = new AbortController().signal;
  const first = fakeContext();
  const summary = await summarizeToolResults([record], first.ctx, signal);

  assert.equal(first.calls.length, 1);
  assert.ok(summary.startsWith("Registry summary text."));
  assert.match(summary, /Pruned 1 tool result\./);

  const [call] = first.calls;
  assert.equal(call.model, model);
  assert.match(call.context.messages[0].content[0].text, /toolCallId: call-1/);
  assert.equal(call.options.cacheRetention, "none");
  assert.equal(call.options.maxTokens, 768);
  assert.equal(call.options.signal, signal);
  assert.match(call.options.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

  const second = fakeContext();
  await summarizeToolResults([record], second.ctx);
  assert.notEqual(second.calls[0].options.sessionId, call.options.sessionId);
});

test("reports registry errors as summarization failures", async () => {
  const { ctx } = fakeContext();
  ctx.modelRegistry.complete = async () => ({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "Provider is not configured: fake-extension-provider",
  });

  await assert.rejects(
    summarizeToolResults([record], ctx),
    /Prune summarization stopped with error: Provider is not configured: fake-extension-provider/,
  );
});
