import { XMLParser } from 'fast-xml-parser';
import { asArray } from '../../../backend/bgg-parser.js';
import { facts, positive, text } from './io.js';

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
export async function bgg(input, io) {
  const endpoint = input.action === 'detail' ? `thing?id=${input.id}&type=boardgame,boardgameexpansion` : `search?type=${input.kind === 'expansion' ? 'boardgameexpansion' : 'boardgame,boardgameexpansion'}&query=${encodeURIComponent(input.query)}`;
  const data = parser.parse(await io(`https://boardgamegeek.com/xmlapi2/${endpoint}`, { xml: true }));
  const items = asArray(data.items?.item).filter((v) => ['boardgame', 'boardgameexpansion'].includes(v['@_type']));
  return items
    .slice(0, 10)
    .map((item) => {
      const id = text(String(item['@_id'])),
        names = asArray(item.name)
          .map((v) => ({ value: text(v['@_value']), language: 'unknown' }))
          .filter((v) => v.value);
      const title = text(asArray(item.name).find((v) => v['@_type'] === 'primary')?.['@_value']) || names[0]?.value || '';
      if (!/^[1-9]\d{0,8}$/.test(id) || !title) return null;
      let min = positive(item.minplayers?.['@_value'], 100),
        max = positive(item.maxplayers?.['@_value'], 100);
      if (!min || !max || min > max) min = max = null;
      return facts(
        'bgg',
        id,
        `https://boardgamegeek.com/${item['@_type']}/${id}`,
        {
          title,
          minPlayers: min,
          maxPlayers: max,
          durationMinutes: positive(item.playingtime?.['@_value']),
          recommendedAge: positive(item.minage?.['@_value'], 100),
        },
        { names: names.slice(0, 40), kind: item['@_type'] === 'boardgameexpansion' ? 'expansion' : 'base', identifiers: { bgg: id }, language: 'unknown', license: 'BGG · API autorizada; fatos com atribuição', needsDetail: input.action !== 'detail' },
      );
      // Descrições autorais e imagens não são copiadas sem licença específica.
    })
    .filter(Boolean);
}
