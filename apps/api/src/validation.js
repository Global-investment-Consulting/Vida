// src/validation.js
import { z } from "zod";

// Common pieces
const Currency = z.string().trim().toUpperCase().length(3, "currency must be a 3-letter code");
const Country2 = z.string().trim().toUpperCase().length(2, "buyer.country must be 2 letters");

const Line = z.object({
  name: z.string().trim().min(1, "line.name is required"),
  qty: z.number({ invalid_type_error: "line.qty must be a number" })
        .int("line.qty must be an integer")
        .min(1, "line.qty must be >= 1"),
  price: z.number({ invalid_type_error: "line.price must be a number" })
          .nonnegative("line.price must be >= 0")
});

// === Bodies ===
export const CreateInvoiceSchema = z.object({
  currency: Currency,
  buyer: z.object({
    name: z.string().trim().min(1, "buyer.name is required"),
    country: Country2,
    vat_id: z.string().trim().optional().nullable().default(""),
    vatId: z.string().trim().optional().nullable(), // legacy alias accepted
  }),
  lines: z.array(Line).min(1, "lines must have at least 1 item"),
});

export const PatchInvoiceSchema = z.object({
  buyer: z.object({
    name: z.string().trim().min(1).optional(),
    country: Country2.optional(),
    vat_id: z.string().trim().optional().nullable(),
    vatId: z.string().trim().optional().nullable(), // alias
  }).strict().optional(),
  // (you can expand here later with other patchable fields)
}).strict();

// === Query ===
export const ListInvoicesQuerySchema = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(), // defaults applied in route
  status: z.enum(["SENT", "PAID", "CANCELED"]).optional(),
});

// === Middlewares ===
function formatZodIssues(issues) {
  return issues.map(i => ({
    path: i.path.join("."),
    message: i.message,
    code: i.code
  }));
}

export const validateBody = (schema) => (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: { type: "validation_error", message: "Invalid request body", details: formatZodIssues(parsed.error.issues) }
    });
  }
  req.validated = parsed.data;
  next();
};

export const validateQuery = (schema) => (req, res, next) => {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: { type: "validation_error", message: "Invalid query parameters", details: formatZodIssues(parsed.error.issues) }
    });
  }
  req.validated = parsed.data;
  next();
};
