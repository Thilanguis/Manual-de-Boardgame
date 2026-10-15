// Conversão apenas de sugestões da fonte. Não recupera duração antiga em campos que o usuário apagou.
const valid = (minutes) => Number.isInteger(minutes) && minutes > 0 && minutes <= 1440;
const empty = (value) => value == null || String(value).trim() === '';
function scalar(value) {
  const text = String(value ?? '').trim();
  const mixed = text.match(/^(\d+)\s*(?:h|hrs?|horas?|hours?|heures?)\s*(\d+)\s*(?:mins?|minutes?|minutos?)$/i);
  if (mixed) {
    const minutes = Number(mixed[1]) * 60 + Number(mixed[2]);
    return valid(minutes) && Number(mixed[2]) < 60 ? { minutes, unit: true } : null;
  }
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(min(?:s|utos?|utes?)?|h|hrs?|horas?|hours?|heures?)?$/i);
  if (!match) return null;
  return { amount: Number(match[1].replace(',', '.')), hours: /^(?:h|hr|hora|hour|heure)/i.test(match[2] || ''), unit: !!match[2] };
}
function minutes(value, inheritedHours = false) {
  if (!value) return null;
  const result = value.minutes ?? value.amount * ((value.unit ? value.hours : inheritedHours) ? 60 : 1);
  return valid(result) ? result : null;
}
function legacyRange(value) {
  if (empty(value)) return {};
  const parts = String(value)
    .trim()
    .split(/\s*(?:[–—-]|(?<!\p{L})(?:a|à|até|to)(?!\p{L}))\s*/iu);
  if (parts.length > 2) return {};
  const first = scalar(parts[0]),
    last = parts.length === 2 ? scalar(parts[1]) : first;
  const min = minutes(first, last?.hours),
    max = minutes(last, first?.hours);
  return min != null && max != null && min <= max ? { minDurationMinutes: min, maxDurationMinutes: max } : {};
}
export function durationSuggestion(fields = {}) {
  const legacy = legacyRange(fields.durationMinutes);
  const hasMin = !empty(fields.minDurationMinutes),
    hasMax = !empty(fields.maxDurationMinutes);
  if (hasMin || hasMax) {
    const min = minutes(scalar(fields.minDurationMinutes)),
      max = minutes(scalar(fields.maxDurationMinutes));
    if (min != null && max != null && min > max) return {};
    // Completa um limite ausente somente quando a própria fonte também informa o intervalo completo, sem divergência.
    if (legacy.minDurationMinutes != null && (!hasMin || min === legacy.minDurationMinutes) && (!hasMax || max === legacy.maxDurationMinutes)) return legacy;
    return { ...(min != null ? { minDurationMinutes: min } : {}), ...(max != null ? { maxDurationMinutes: max } : {}) };
  }
  return legacy;
}
