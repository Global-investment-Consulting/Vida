/*
  Warnings:

  - The primary key for the `ApiKey` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `ApiKey` table. All the data in the column will be lost.
  - You are about to drop the column `liveMode` on the `ApiKey` table. All the data in the column will be lost.
  - You are about to drop the column `endpointId` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `endpointScheme` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `postalCode` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `region` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the `IdempotencyKey` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `NumberSequence` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Transmission` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[tenantId,number]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.
  - Changed the type of `data` on the `Event` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "public"."ApiKey" DROP CONSTRAINT "ApiKey_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Customer" DROP CONSTRAINT "Customer_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Event" DROP CONSTRAINT "Event_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."IdempotencyKey" DROP CONSTRAINT "IdempotencyKey_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Invoice" DROP CONSTRAINT "Invoice_buyerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Invoice" DROP CONSTRAINT "Invoice_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."InvoiceLine" DROP CONSTRAINT "InvoiceLine_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "public"."NumberSequence" DROP CONSTRAINT "NumberSequence_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Transmission" DROP CONSTRAINT "Transmission_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "public"."WebhookEndpoint" DROP CONSTRAINT "WebhookEndpoint_tenantId_fkey";

-- DropIndex
DROP INDEX "public"."ApiKey_key_key";

-- AlterTable
ALTER TABLE "public"."ApiKey" DROP CONSTRAINT "ApiKey_pkey",
DROP COLUMN "id",
DROP COLUMN "liveMode",
ADD CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("key");

-- AlterTable
ALTER TABLE "public"."Customer" DROP COLUMN "endpointId",
DROP COLUMN "endpointScheme",
DROP COLUMN "postalCode",
DROP COLUMN "region",
ALTER COLUMN "country" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."Event" DROP COLUMN "data",
ADD COLUMN     "data" JSONB NOT NULL;

-- AlterTable
ALTER TABLE "public"."InvoiceLine" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- DropTable
DROP TABLE "public"."IdempotencyKey";

-- DropTable
DROP TABLE "public"."NumberSequence";

-- DropTable
DROP TABLE "public"."Transmission";

-- CreateTable
CREATE TABLE "public"."Delivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lastResponseCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DeadLetter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Delivery_nextRun_idx" ON "public"."Delivery"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "Delivery_tenantId_idx" ON "public"."Delivery"("tenantId");

-- CreateIndex
CREATE INDEX "Delivery_eventId_idx" ON "public"."Delivery"("eventId");

-- CreateIndex
CREATE INDEX "Delivery_endpointId_idx" ON "public"."Delivery"("endpointId");

-- CreateIndex
CREATE INDEX "DeadLetter_tenantId_idx" ON "public"."DeadLetter"("tenantId");

-- CreateIndex
CREATE INDEX "DeadLetter_eventId_idx" ON "public"."DeadLetter"("eventId");

-- CreateIndex
CREATE INDEX "DeadLetter_endpointId_idx" ON "public"."DeadLetter"("endpointId");

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_idx" ON "public"."ApiKey"("tenantId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_idx" ON "public"."Customer"("tenantId");

-- CreateIndex
CREATE INDEX "Customer_vatId_idx" ON "public"."Customer"("vatId");

-- CreateIndex
CREATE INDEX "Customer_country_idx" ON "public"."Customer"("country");

-- CreateIndex
CREATE INDEX "Event_tenantId_idx" ON "public"."Event"("tenantId");

-- CreateIndex
CREATE INDEX "Event_type_createdAt_idx" ON "public"."Event"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_idx" ON "public"."Invoice"("tenantId");

-- CreateIndex
CREATE INDEX "Invoice_buyerCountry_idx" ON "public"."Invoice"("buyerCountry");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "public"."Invoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_number_key" ON "public"."Invoice"("tenantId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "public"."InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "Tenant_slug_idx" ON "public"."Tenant"("slug");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_tenantId_idx" ON "public"."WebhookEndpoint"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_enabled_idx" ON "public"."WebhookEndpoint"("enabled");
