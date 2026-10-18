// Remove somente propriedades opcionais ausentes. Preserva tipos do SDK, como
// Timestamp e serverTimestamp(), que uma conversão por JSON destruiria.
export function withoutUndefined(value) {
  if (Array.isArray(value)) return Array.from(value, (item) => (item === undefined ? null : withoutUndefined(item)));
  if (value && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, withoutUndefined(item)]),
    );
  return value;
}
