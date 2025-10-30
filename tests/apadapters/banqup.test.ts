import { describe, expect, it } from "vitest";
import { banqupAdapter, BANQUP_NOT_CONFIGURED } from "src/apadapters/banqup.js";

const sendParams = {
  tenant: "tenant-123",
  invoiceId: "inv-001",
  ublXml: "<Invoice />"
};

describe("banqup adapter stub", () => {
  it("throws when send is invoked", async () => {
    await expect(banqupAdapter.send(sendParams)).rejects.toThrow(BANQUP_NOT_CONFIGURED);
  });

  it("throws when status is requested", async () => {
    await expect(banqupAdapter.getStatus("banqup-123"))
      .rejects.toThrow(BANQUP_NOT_CONFIGURED);
  });
});
