// Parser puro, separado da autenticação, para testes sem acessar o serviço externo.
export const asArray = (value) => (!value ? [] : Array.isArray(value) ? value : [value]);
const attribute = (element, key) => element?.[`@_${key}`];
function nameOf(item) {
  const names = asArray(item.name);
  const name = names.find((name) => attribute(name, 'type') === 'primary') || names[0];
  return String(attribute(name, 'value') || '')
    .trim()
    .slice(0, 160);
}
function positive(value, max = 1440) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= max ? number : null;
}
export function parseSearch(data) {
  return asArray(data.items?.item)
    .filter((item) => attribute(item, 'type') === 'boardgame')
    .slice(0, 12)
    .map((item) => ({ id: String(attribute(item, 'id')), title: nameOf(item), year: positive(attribute(item.yearpublished, 'value'), 3000) }));
}
export function parseThing(data) {
  const item = asArray(data.items?.item)[0];
  if (!item || attribute(item, 'type') !== 'boardgame') throw new Error('Jogo não encontrado no BoardGameGeek.');
  const image = typeof item.image === 'string' && item.image.startsWith('https://') ? item.image : '';
  const thumbnail = typeof item.thumbnail === 'string' && item.thumbnail.startsWith('https://') ? item.thumbnail : '';
  return {
    id: String(attribute(item, 'id')),
    title: nameOf(item),
    description: String(item.description || '').slice(0, 20000),
    image,
    thumbnail,
    minPlayers: positive(attribute(item.minplayers, 'value'), 100),
    maxPlayers: positive(attribute(item.maxplayers, 'value'), 100),
    durationMinutes: positive(attribute(item.playingtime, 'value')),
  };
}
