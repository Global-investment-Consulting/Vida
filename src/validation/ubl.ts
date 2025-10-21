import { create } from "xmlbuilder2";

export type ValidationError = {
  path: string;
  msg: string;
};

export type ValidationResult = {
  ok: boolean;
  errors: ValidationError[];
};

function hasInvoiceRoot(xml: string): boolean {
  return /<\s*Invoice[\s>]/i.test(xml) && /<\s*\/\s*Invoice\s*>/i.test(xml);
}

export function validateUbl(xml: string): ValidationResult {
  const errors: ValidationError[] = [];
  const trimmed = xml.trim();

  if (trimmed.length === 0) {
    errors.push({ path: "/", msg: "Document is empty" });
    return { ok: false, errors };
  }

  if (!hasInvoiceRoot(trimmed)) {
    errors.push({ path: "/", msg: "Missing Invoice root element" });
  }

  try {
    create(trimmed).end();
  } catch {
    errors.push({ path: "/", msg: "Invalid XML structure" });
    return { ok: false, errors };
  }

  const requiredFragments = [{ path: "/cbc:ID", msg: "Missing Invoice ID element" }];

  for (const fragment of requiredFragments) {
    const pattern = new RegExp(`<\\s*${fragment.path.slice(1)}[\\s>]`, "i");
    if (!pattern.test(trimmed)) {
      errors.push({ path: fragment.path, msg: fragment.msg });
    }
  }

  // TODO: Integrate full EN16931 XSD validation when the schema is available locally.

  return {
    ok: errors.length === 0,
    errors
  };
}
