import { billitAdapter } from "./billit.js";
import { banqupAdapter } from "./banqup.js";
import { mockAdapter } from "./mock.js";
import { scradaAdapter } from "./scrada.js";
import { type ApAdapter } from "./types.js";
import { resolveApAdapterName } from "../config.js";

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
  ["banqup", () => banqupAdapter],
  ["billit", () => billitAdapter],
  ["scrada", () => scradaAdapter]
]);

export function getAdapter(name?: string): ApAdapter {
  const requestedName = name?.trim().toLowerCase() || resolveApAdapterName();
  const factory = registry.get(requestedName) ?? registry.get("mock");
  if (!factory) {
    return mockAdapter;
  }
  const adapter = factory();
  return adapter;
}
