import { getInvoiceStatusSnapshot } from "./history/invoiceStatus.js";

type CounterName =
  | "invoices_created_total"
  | "ap_send_attempts_total"
  | "ap_send_success_total"
  | "ap_send_fail_total"
  | "ap_webhook_ok_total"
  | "ap_webhook_fail_total";

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

const invoicesCreatedCounter = defineCounter("invoices_created_total", "Total number of invoices generated");
const apSendAttemptsCounter = defineCounter("ap_send_attempts_total", "Total number of Access Point send attempts");
const apSendSuccessCounter = defineCounter("ap_send_success_total", "Total number of successful Access Point sends");
const apSendFailCounter = defineCounter("ap_send_fail_total", "Total number of failed Access Point sends");
const apWebhookOkCounter = defineCounter("ap_webhook_ok_total", "Total number of successful AP status webhooks processed");
const apWebhookFailCounter = defineCounter("ap_webhook_fail_total", "Total number of failed AP status webhooks processed");

type Gauge = {
  name: string;
  help: string;
  collect: () => number;
};

const gauges: Gauge[] = [
  {
    name: "ap_queue_current",
    help: "Current number of invoices awaiting Access Point delivery",
    collect: () => {
      const pendingStatuses = new Set(["queued", "sent"]);
      return getInvoiceStatusSnapshot().filter((record) => pendingStatuses.has(record.status)).length;
    }
  }
];

export function incrementInvoicesCreated(amount = 1): void {
  invoicesCreatedCounter.value += amount;
}

export function incrementApSendAttempts(amount = 1): void {
  apSendAttemptsCounter.value += amount;
}

export function incrementApSendSuccess(amount = 1): void {
  apSendSuccessCounter.value += amount;
}

export function incrementApSendFail(amount = 1): void {
  apSendFailCounter.value += amount;
}

export function incrementApWebhookOk(amount = 1): void {
  apWebhookOkCounter.value += amount;
}

export function incrementApWebhookFail(amount = 1): void {
  apWebhookFailCounter.value += amount;
}

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const counter of counters.values()) {
    lines.push(`# HELP ${counter.name} ${counter.help}`);
    lines.push(`# TYPE ${counter.name} counter`);
    lines.push(`${counter.name} ${counter.value}`);
  }
  for (const gauge of gauges) {
    lines.push(`# HELP ${gauge.name} ${gauge.help}`);
    lines.push(`# TYPE ${gauge.name} gauge`);
    lines.push(`${gauge.name} ${gauge.collect()}`);
  }
  return lines.join("\n") + "\n";
}

export function resetMetrics(): void {
  for (const counter of counters.values()) {
    counter.value = 0;
  }
}
