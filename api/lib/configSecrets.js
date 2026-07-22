'use strict';

const SECRET_KEY = /^(api[_-]?key|api[_-]?secret|secret[_-]?key|app[_-]?secret|hmac[_-]?secret|smtp[_-]?password|password|access[_-]?token|page[_-]?access[_-]?token|api[_-]?token|auth[_-]?token|verify[_-]?token|webhook[_-]?verify[_-]?token|secret)$/i;

function isPlainJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!isPlainJsonObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SECRET_KEY.test(key) && item ? '' : redactSecrets(item),
  ]));
}

function preserveStoredSecrets(stored, incoming) {
  if (Array.isArray(incoming)) {
    const oldById = new Map((Array.isArray(stored) ? stored : []).map(item => [item?.id, item]));
    return incoming.map((item, index) => preserveStoredSecrets(oldById.get(item?.id) || stored?.[index], item));
  }
  if (!isPlainJsonObject(incoming)) return incoming;
  const old = isPlainJsonObject(stored) ? stored : {};
  return Object.fromEntries(Object.entries(incoming).map(([key, item]) => {
    if (SECRET_KEY.test(key) && item === '') return [key, old[key] ?? ''];
    return [key, preserveStoredSecrets(old[key], item)];
  }));
}

module.exports = { isPlainJsonObject, preserveStoredSecrets, redactSecrets };
