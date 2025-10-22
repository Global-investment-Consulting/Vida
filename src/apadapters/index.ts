import process from "node:process";
import { billitAdapter } from "./billit.js";
import { mockAdapter } from "./mock.js";
import { type ApAdapter } from "./types.js";

type AdapterFactory = () => ApAdapter;

const mockErrorAdapter: ApAdapter = {
  name: "mock_error",
  async send() {
    throw new Error("Mock adapter forced failure");
  },
  async getStatus() {
    return "error";
  }
};

const registry = new Map<string, AdapterFactory>([
  ["mock", () => mockAdapter],
  ["mock_error", () => mockErrorAdapter],
  ["billit", () => billitAdapter]
]);

export function getAdapter(name?: string): ApAdapter {
  const requested = name?.trim().toLowerCase() || process.env.VIDA_AP_ADAPTER?.toLowerCase() || "mock";
  const factory = registry.get(requested) ?? registry.get("mock");
  if (!factory) {
    return mockAdapter;
  }
  const adapter = factory();
  return adapter;
}
