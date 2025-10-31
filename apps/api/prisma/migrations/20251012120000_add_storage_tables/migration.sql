-- Create storage tables for history, status, and DLQ backends
CREATE TABLE "InvoiceHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "ts" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "InvoiceHistory_tenant_ts_idx" ON "InvoiceHistory"("tenant", "ts");

CREATE TABLE "InvoiceStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "InvoiceStatus_tenant_invoiceId_key" ON "InvoiceStatus"("tenant", "invoiceId");

CREATE TABLE "Dlq" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "payload" TEXT,
    "ts" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
