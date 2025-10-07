import { prisma } from "./src/db.js";

const run = async () => {
  const t = await prisma.tenant.findFirst({ where: { slug: "demo-tenant" } });
  const url = "https://webhook.site/your-real-id";
  await prisma.webhookEndpoint.create({ data: { tenantId: t.id, url } });
  console.log("Webhook added:", url);
  process.exit(0);
};
run();
