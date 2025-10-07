{
  "openapi": "3.0.3",
  "info": {
    "title": "Vida MVP API",
    "version": "0.1.1"
  },
  "servers": [
    { "url": "http://localhost:3001" }
  ],
  "paths": {
    "/v1/invoices": {
      "get": {
        "summary": "List invoices",
        "parameters": [
          { "name": "limit", "in": "query", "schema": { "type": "integer", "minimum": 1, "maximum": 100 }, "description": "Max items to return (default 10)" },
          { "name": "starting_after", "in": "query", "schema": { "type": "string" }, "description": "Cursor for pagination" },
          { "name": "status", "in": "query", "schema": { "type": "string", "enum": ["SENT", "PAID", "CANCELED"] }, "description": "Filter by status" },
          { "name": "q", "in": "query", "schema": { "type": "string" }, "description": "Search over buyer name/number" }
        ],
        "responses": {
          "200": {
            "description": "List response",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "object": { "type": "string", "example": "list" },
                    "data": { "type": "array", "items": { "$ref": "#/components/schemas/Invoice" } },
                    "has_more": { "type": "boolean" },
                    "next_starting_after": { "type": "string", "nullable": true }
                  }
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Create invoice",
        "parameters": [
          { "name": "Authorization", "in": "header", "required": true, "schema": { "type": "string", "example": "Bearer key_test_12345" } },
          { "name": "X-Idempotency-Key", "in": "header", "required": true, "schema": { "type": "string" } }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/CreateInvoice" }
            }
          }
        },
        "responses": {
          "200": { "description": "Created", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Invoice" } } } },
          "422": { "$ref": "#/components/responses/ValidationError" }
        }
      }
    },
    "/v1/invoices/{id}": {
      "get": {
        "summary": "Retrieve invoice",
        "parameters": [
          { "$ref": "#/components/parameters/AuthHeader" },
          { "$ref": "#/components/parameters/InvoiceId" }
        ],
        "responses": {
          "200": { "description": "Invoice", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Invoice" } } } },
          "404": { "$ref": "#/components/responses/NotFound" }
        }
      },
      "patch": {
        "summary": "Update invoice (only when SENT)",
        "parameters": [
          { "$ref": "#/components/parameters/AuthHeader" },
          { "$ref": "#/components/parameters/InvoiceId" }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": { "schema": { "$ref": "#/components/schemas/UpdateInvoice" } }
          }
        },
        "responses": {
          "200": { "description": "Updated", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Invoice" } } } },
          "404": { "$ref": "#/components/responses/NotFound" },
          "409": { "$ref": "#/components/responses/Conflict" },
          "422": { "$ref": "#/components/responses/ValidationError" }
        }
      },
      "delete": {
        "summary": "Cancel invoice",
        "parameters": [
          { "$ref": "#/components/parameters/AuthHeader" },
          { "$ref": "#/components/parameters/InvoiceId" }
        ],
        "responses": {
          "200": { "description": "Canceled", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Invoice" } } } },
          "404": { "$ref": "#/components/responses/NotFound" },
          "409": { "$ref": "#/components/responses/Conflict" }
        }
      }
    },
    "/v1/invoices/{id}/xml": {
      "get": {
        "summary": "Invoice UBL XML",
        "parameters": [
          { "$ref": "#/components/parameters/AuthHeader" },
          { "$ref": "#/components/parameters/InvoiceId" }
        ],
        "responses": {
          "200": { "description": "UBL XML", "content": { "application/xml": {} } },
          "404": { "$ref": "#/components/responses/NotFound" }
        }
      }
    },
    "/v1/invoices/{id}/pdf": {
      "get": {
        "summary": "Invoice PDF",
        "parameters": [
          { "$ref": "#/components/parameters/AuthHeader" },
          { "$ref": "#/components/parameters/InvoiceId" }
        ],
        "responses": {
          "200": { "description": "PDF stream", "content": { "application/pdf": {} } },
          "401": { "$ref": "#/components/responses/Unauthorized" },
          "404": { "$ref": "#/components/responses/NotFound" }
        }
      }
    },
    "/v1/invoices/{id}/send": {
      "post": {
        "summary": "Send invoice (stub)",
        "parameters": [
          { "$ref": "#/components/parameters/AuthHeader" },
          { "$ref": "#/components/parameters/InvoiceId" }
        ],
        "responses": {
          "200": {
            "description": "Sent (stubbed)",
            "content": { "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "ok": { "type": "boolean" },
                  "message": { "type": "string" },
                  "invoice": { "$ref": "#/components/schemas/Invoice" }
                }
              }
            } }
          },
          "404": { "$ref": "#/components/responses/NotFound" }
        }
      }
    },
    "/v1/invoices/{id}/pay": {
      "post": {
        "summary": "Mark invoice as paid (manual)",
        "parameters": [
          { "$ref": "#/components/parameters/AuthHeader" },
          { "$ref": "#/components/parameters/InvoiceId" }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "amount": { "type": "number", "description": "Must equal gross for full settlement" },
                  "method": { "type": "string", "example": "manual" }
                }
              }
            }
          }
        },
        "responses": {
          "200": { "description": "Invoice (now PAID)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Invoice" } } } },
          "404": { "$ref": "#/components/responses/NotFound" },
          "409": { "$ref": "#/components/responses/Conflict" },
          "422": { "$ref": "#/components/responses/ValidationError" }
        }
      }
    },
    "/v1/invoices/{id}/payments": {
      "get": {
        "summary": "List payments for an invoice",
        "parameters": [
          { "$ref": "#/components/parameters/AuthHeader" },
          { "$ref": "#/components/parameters/InvoiceId" }
        ],
        "responses": {
          "200": {
            "description": "Payments array",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "object": { "type": "string", "example": "list" },
                    "data": {
                      "type": "array",
                      "items": { "$ref": "#/components/schemas/Payment" }
                    }
                  }
                }
              }
            }
          },
          "404": { "$ref": "#/components/responses/NotFound" }
        }
      }
    },
    "/v1/healthz": {
      "get": {
        "summary": "Health",
        "responses": {
          "200": {
            "description": "Health payload",
            "content": { "application/json": { "schema": { "type": "object" } } }
          }
        }
      }
    }
  },
  "components": {
    "parameters": {
      "AuthHeader": {
        "name": "Authorization",
        "in": "header",
        "required": true,
        "schema": { "type": "string", "example": "Bearer key_test_12345" }
      },
      "InvoiceId": {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": { "type": "string" }
      }
    },
    "responses": {
      "Unauthorized": {
        "description": "Unauthorized",
        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } }
      },
      "NotFound": {
        "description": "Not found",
        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } }
      },
      "Conflict": {
        "description": "Conflict",
        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } }
      },
      "ValidationError": {
        "description": "Validation error",
        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } }
      }
    },
    "schemas": {
      "Money": { "type": "number", "example": 60.5 },
      "Line": {
        "type": "object",
        "required": ["name", "qty", "price"],
        "properties": {
          "name": { "type": "string" },
          "qty": { "type": "number" },
          "price": { "type": "number" }
        }
      },
      "Buyer": {
        "type": "object",
        "required": ["name","country"],
        "properties": {
          "name": { "type": "string" },
          "country": { "type": "string", "minLength": 2, "maxLength": 2, "example": "BE" },
          "vat_id": { "type": "string", "nullable": true }
        }
      },
      "Invoice": {
        "type": "object",
        "properties": {
          "object": { "type": "string", "example": "invoice" },
          "id": { "type": "string" },
          "idempotencyKey": { "type": "string" },
          "number": { "type": "string" },
          "status": { "type": "string", "enum": ["SENT","PAID","CANCELED"] },
          "currency": { "type": "string", "example": "EUR" },
          "buyer": { "$ref": "#/components/schemas/Buyer" },
          "lines": { "type": "array", "items": { "$ref": "#/components/schemas/Line" } },
          "issueDate": { "type": "string", "format": "date-time" },
          "createdAt": { "type": "number" },
          "meta": {
            "type": "object",
            "properties": {
              "exemptionReason": { "type": "string", "nullable": true }
            }
          },
          "vatRate": { "type": "number" },
          "taxCategory": { "type": "string", "example": "S" },
          "net": { "$ref": "#/components/schemas/Money" },
          "tax": { "$ref": "#/components/schemas/Money" },
          "gross": { "$ref": "#/components/schemas/Money" },
          "payments": { "type": "array", "items": { "$ref": "#/components/schemas/Payment" } },
          "paidAt": { "type": "string", "format": "date-time", "nullable": true },
          "amountPaid": { "$ref": "#/components/schemas/Money" },
          "paymentMethod": { "type": "string", "nullable": true }
        }
      },
      "Payment": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "amount": { "$ref": "#/components/schemas/Money" },
          "method": { "type": "string", "example": "manual" },
          "paidAt": { "type": "string", "format": "date-time" }
        }
      },
      "CreateInvoice": {
        "type": "object",
        "required": ["currency", "buyer", "lines"],
        "properties": {
          "currency": { "type": "string", "example": "EUR" },
          "buyer": { "$ref": "#/components/schemas/Buyer" },
          "lines": { "type": "array", "items": { "$ref": "#/components/schemas/Line" }, "minItems": 1 }
        }
      },
      "UpdateInvoice": {
        "type": "object",
        "properties": {
          "buyer": { "$ref": "#/components/schemas/Buyer" },
          "meta": {
            "type": "object",
            "additionalProperties": true
          }
        }
      },
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "object",
            "properties": {
              "type": { "type": "string" },
              "message": { "type": "string" }
            },
            "required": ["type","message"]
          }
        }
      }
    }
  }
}
