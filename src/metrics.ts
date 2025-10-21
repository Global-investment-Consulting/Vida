type CounterName = "invoices_created_total" | "ap_send_success_total" | "ap_send_fail_total";

type Counter = {
  name: CounterName;
  help: string;
  value: number;
};

const counters = new Map<CounterName, Counter>();

function defineCounter(name: CounterName, help: string): Counter {
  const existing = counters.get(name);
  if (existing) {
    return existing;
  }
  const counter: Counter = { name, help, value: 0 };
  counters.set(name, counter);
  return counter;
}

const invoicesCreatedCounter = defineCounter(
  "invoices_created_total",
  "Total number of invoices generated"
);
const apSendSuccessCounter = defineCounter(
  "ap_send_success_total",
  "Total number of successful Access Point sends"
);
const apSendFailCounter = defineCounter(
  "ap_send_fail_total",
  "Total number of failed Access Point sends"
);

export function incrementInvoicesCreated(amount = 1): void {
  invoicesCreatedCounter.value += amount;
}

export function incrementApSendSuccess(amount = 1): void {
  apSendSuccessCounter.value += amount;
}

export function incrementApSendFail(amount = 1): void {
  apSendFailCounter.value += amount;
}

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const counter of counters.values()) {
    lines.push(`# HELP ${counter.name} ${counter.help}`);
    lines.push(`# TYPE ${counter.name} counter`);
    lines.push(`${counter.name} ${counter.value}`);
  }
  return lines.join("\n") + "\n";
}

export function resetMetrics(): void {
  for (const counter of counters.values()) {
    counter.value = 0;
  }
}

