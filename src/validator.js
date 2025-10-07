// src/validator.js
export function validateCreate(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    errors.push({ field: 'body', message: 'must be a JSON object' });
    return errors;
  }

  const { currency, buyer, lines } = body;

  if (!currency || typeof currency !== 'string') {
    errors.push({ field: 'currency', message: 'currency is required (ISO code)' });
  }
  if (!buyer || typeof buyer !== 'object') {
    errors.push({ field: 'buyer', message: 'buyer is required' });
  } else {
    if (!buyer.name) errors.push({ field: 'buyer.name', message: 'buyer.name is required' });
    if (!buyer.country) errors.push({ field: 'buyer.country', message: 'buyer.country is required (ISO-2)' });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    errors.push({ field: 'lines', message: 'lines[] required' });
  } else {
    lines.forEach((l, i) => {
      if (!l || typeof l !== 'object') {
        errors.push({ field: `lines[${i}]`, message: 'must be an object' });
      } else {
        if (!l.name) errors.push({ field: `lines[${i}].name`, message: 'required' });
        if (l.qty == null || Number(l.qty) <= 0) errors.push({ field: `lines[${i}].qty`, message: 'must be > 0' });
        if (l.price == null || Number(l.price) < 0) errors.push({ field: `lines[${i}].price`, message: 'must be ≥ 0' });
      }
    });
  }
  return errors;
}

export function validatePatch(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    errors.push({ field: 'body', message: 'must be a JSON object' });
    return errors;
  }
  if (body.buyer) {
    if (typeof body.buyer !== 'object') {
      errors.push({ field: 'buyer', message: 'must be an object' });
    }
  }
  if (body.lines) {
    if (!Array.isArray(body.lines)) {
      errors.push({ field: 'lines', message: 'must be an array' });
    }
  }
  return errors;
}
