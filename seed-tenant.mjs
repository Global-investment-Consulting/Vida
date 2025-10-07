import { prisma } from "./src/db.js";

const run = async () => {
  let t = await prisma.tenant.findFirst({ where: { slug: "demo-tenant" } });
  if (!t) t = await prisma.tenant.create({ data: { slug: "demo-tenant" } });

  const k = "key_test_12345";
  await prisma.apiKey.upsert({
    where: { key: k },
    update: {},
    create: { key: k, tenantId: t.id, label: "Test key" }
  });

  console.log("Tenant:", t.slug, "Key:", k);
  process.exit(0);
};
run();
