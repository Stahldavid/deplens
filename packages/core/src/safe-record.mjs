export function createSafeRecord(entries = null) {
  const record = Object.create(null);
  if (entries) {
    for (const [key, value] of Object.entries(entries)) record[key] = value;
  }
  return record;
}

export function appendSafeRecord(record, key, value) {
  if (!Object.hasOwn(record, key)) record[key] = [];
  record[key].push(value);
  return record[key];
}

export function setSafeRecord(record, key, value) {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return value;
}

export function toPlainRecord(record) {
  return Object.fromEntries(Object.entries(record || {}));
}
