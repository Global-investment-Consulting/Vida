// src/validator.js
//
// Small, dependency-free validation helpers used by routes_v1.js.
// If invalid, functions return an array of {field,message}. If valid, return [].

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
function isCurrency(v) {
  return typeof v === 'string' && /^[A-Z]{3}$/.test(v.trim().toUpperCase());
}
function isCountryCode(v) {
  return typeof v === 'string' && /^[A-Z]{2}$/.test(v.trim().toUpperCase());
}
function isPosNumber(n) {
  return typeof n === 'number' && isFinite(n) && n > 0;
}
function isNonNegNumber(n) {
  return typeof n === 'number' && isFinite(n) && n >= 0;
}

export function validateCreatePayload(body) {
  const errs = [];
  if (!body || typeof body !== 'object') {
    return [{ field: 'body', message: 'Body must be a JSON object.' }];
  }

  // currency
  if (!isCurrency(body.currency ?? '')) {
    errs.push({ field: 'currency', message: 'currency must be a 3-letter code (e.g. EUR, USD).' });
  }

  // buyer
  const buyer = body.buyer ?? {};
  if (!isNonEmptyString(buyer.name ?? '')) {
    errs.push({ field: 'buyer.name', message: 'buyer.name is required.' });
  }
  if (!isCountryCode(String(buyer.country ?? '').toUpperCase())) {
    errs.push({ field: 'buyer.country', message: 'buyer.country must be a 2-letter code (e.g. BE).' });
  }

  // lines
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) {
    errs.push({ field: 'lines', message: 'lines must be a non-empty array.' });
  } else {
    lines.forEach((ln, i) => {
      if (!isNonEmptyString(ln.name ?? '')) {
        errs.push({ field: `lines[${i}].name`, message: 'name is required.' });
      }
      if (!isPosNumber(Number(ln.qty))) {
        errs.push({ field: `lines[${i}].qty`, message: 'qty must be > 0.' });
      }
      if (!isNonNegNumber(Number(ln.price))) {
        errs.push({ field: `lines[${i}].price`, message: 'price must be >= 0.' });
      }
    });
  }

  return errs;
}

export function validatePatchPayload(body) {
  const errs = [];
  if (!body || typeof body !== 'object') {
    return [{ field: 'body', message: 'Body must be a JSON object.' }];
  }

  if ('currency' in body && !isCurrency(body.currency ?? '')) {
    errs.push({ field: 'currency', message: 'currency must be a 3-letter code (e.g. EUR, USD).' });
  }

  if ('buyer' in body) {
    const b = body.buyer ?? {};
    if ('name' in b && !isNonEmptyString(b.name ?? '')) {
      errs.push({ field: 'buyer.name', message: 'buyer.name cannot be empty.' });
    }
    if ('country' in b && !isCountryCode(String(b.country ?? '').toUpperCase())) {
      errs.push({ field: 'buyer.country', message: 'buyer.country must be a 2-letter code.' });
    }
  }

  if ('lines' in body) {
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (lines.length === 0) {
      errs.push({ field: 'lines', message: 'lines must be a non-empty array when provided.' });
    } else {
      lines.forEach((ln, i) => {
        if ('name' in ln && !isNonEmptyString(ln.name ?? '')) {
          errs.push({ field: `lines[${i}].name`, message: 'name cannot be empty.' });
        }
        if ('qty' in ln && !isPosNumber(Number(ln.qty))) {
          errs.push({ field: `lines[${i}].qty`, message: 'qty must be > 0.' });
        }
        if ('price' in ln && !isNonNegNumber(Number(ln.price))) {
          errs.push({ field: `lines[${i}].price`, message: 'price must be >= 0.' });
        }
      });
    }
  }

  return errs;
}
