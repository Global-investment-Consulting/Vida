// openapi.js
export const openapi = {
  openapi: "3.0.3",
  info: { title: "ViDA API", version: "0.3.8" },
  servers: [{ url: "http://localhost:3001" }],
  paths: {
    "/api/invoice": {
      post: {
        summary: "Generate a BIS 3.0-compliant UBL 2.1 invoice",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/Order"
              }
            }
          }
        },
        responses: {
          "200": {
            description: "UBL 2.1 XML",
            content: { "application/xml": { schema: { type: "string" } } }
          },
          "400": {
            description: "Invalid order payload",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } }
            }
          },
          "422": {
            description: "BIS validation failed",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ValidationErrorResponse" } }
            }
          }
        }
      }
    },
    "/v1/invoices": {
      get: {
        summary: "List invoices",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "q", in: "query", schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" } }
      },
      post: {
        summary: "Create invoice (idempotent by externalId)",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { "201": { description: "Created" }, "200": { description: "Idempotent (existing)" } }
      }
    },
    "/v1/invoices/{id}": {
      get: {
        summary: "Get invoice by id",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } }
      }
    },
    "/v1/invoices/{ref}/pdf": {
      get: {
        summary: "Invoice PDF (auth via Bearer or ?access_token)",
        parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "OK (application/pdf)" },
          "403": { description: "Bad token" },
          "404": { description: "Not found" }
        }
      }
    },
    "/v1/invoices/{ref}/xml": {
      get: {
        summary: "Invoice UBL XML (auth via Bearer or ?access_token)",
        parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "OK (application/xml)" },
          "403": { description: "Bad token" },
          "404": { description: "Not found" }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      ApiKeyQuery: { type: "apiKey", in: "query", name: "access_token" },
      ApiKeyHeader: { type: "apiKey", in: "header", name: "Authorization" }
    },
    schemas: {
      Order: {
        type: "object",
        required: ["orderNumber", "currency", "issueDate", "buyer", "supplier", "lines"],
        properties: {
          orderNumber: { type: "string", description: "Buyer-facing invoice number" },
          currency: { type: "string", description: "ISO 4217 currency code", example: "EUR" },
          issueDate: { type: "string", format: "date" },
          dueDate: { type: "string", format: "date", nullable: true },
          buyer: { $ref: "#/components/schemas/Party" },
          supplier: { $ref: "#/components/schemas/Party" },
          defaultVatRate: { type: "number", enum: [0, 6, 12, 21] },
          lines: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/OrderLine" }
          }
        }
      },
      Party: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          registrationName: { type: "string" },
          companyId: { type: "string" },
          vatId: { type: "string" },
          endpoint: {
            type: "object",
            properties: {
              id: { type: "string" },
              scheme: { type: "string" }
            }
          },
          address: {
            type: "object",
            properties: {
              streetName: { type: "string" },
              additionalStreetName: { type: "string" },
              buildingNumber: { type: "string" },
              cityName: { type: "string" },
              postalZone: { type: "string" },
              countryCode: { type: "string", description: "ISO 3166-1 alpha-2" }
            }
          },
          contact: {
            type: "object",
            properties: {
              name: { type: "string" },
              telephone: { type: "string" },
              electronicMail: { type: "string" }
            }
          }
        }
      },
      OrderLine: {
        type: "object",
        required: ["description", "quantity", "unitPriceMinor"],
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          unitCode: { type: "string", default: "EA" },
          unitPriceMinor: {
            type: "integer",
            description: "Minor units (cents) for the net line price"
          },
          discountMinor: { type: "integer", minimum: 0 },
          vatRate: { type: "number", enum: [0, 6, 12, 21] },
          vatCategory: { type: "string" }
        }
      },
      ErrorResponse: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          field: { type: "string" }
        }
      },
      ValidationErrorResponse: {
        allOf: [
          { $ref: "#/components/schemas/ErrorResponse" },
          {
            type: "object",
            properties: {
              ruleId: { type: "string" }
            }
          }
        ]
      }
    }
  }
};
