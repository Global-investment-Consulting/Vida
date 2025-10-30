import { type ApAdapter } from "./contracts.js";

export const BANQUP_NOT_CONFIGURED = "BANQUP_NOT_CONFIGURED";

export const banqupAdapter: ApAdapter = {
  name: "banqup",
  async send() {
    throw new Error(BANQUP_NOT_CONFIGURED);
  },
  async getStatus() {
    throw new Error(BANQUP_NOT_CONFIGURED);
  }
};
