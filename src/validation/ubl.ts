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

  return {
    ok: errors.length === 0,
    errors
  };
}
