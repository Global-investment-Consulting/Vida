-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerCountry" TEXT NOT NULL,
    "vatRate" DECIMAL NOT NULL DEFAULT 0,
    "net" DECIMAL NOT NULL,
    "tax" DECIMAL NOT NULL,
    "gross" DECIMAL NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Invoice" ("buyerCountry", "buyerName", "createdAt", "currency", "gross", "id", "net", "number", "status", "tax", "updatedAt", "vatRate") SELECT "buyerCountry", "buyerName", "createdAt", "currency", "gross", "id", "net", "number", "status", "tax", "updatedAt", "vatRate" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
