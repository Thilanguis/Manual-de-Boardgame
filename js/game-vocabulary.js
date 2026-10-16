import { normalizeText } from './model.js';

// Vocabulário editorial: traduz termos conhecidos, sem inferir características do jogo.
const terms = [
  ['Cooperativo', 'cooperative', 'cooperatif', 'cooperativa', 'cooperativo'],
  ['Competitivo', 'competitive', 'competitif', 'competitivo'],
  ['Solo', 'solitaire', 'single player', 'solo'],
  ['Por equipes', 'team based', 'team based game', 'en equipes', 'por equipes'],
  ['Construção de baralho', 'deck building', 'deckbuilding', 'construction de deck', 'construction de baralho', 'construcao de baralho'],
  ['Alocação de trabalhadores', 'worker placement', 'placement d ouvriers', 'alocacao de trabalhadores'],
  ['Gestão de mão', 'hand management', 'gestion de main', 'gestao de mao'],
  ['Rolagem de dados', 'dice rolling', 'lancer de des', 'rolagem de dados'],
  ['Negociação', 'negotiation', 'negociation', 'negociacao'],
  ['Aventura', 'adventure', 'aventure', 'aventura'],
  ['Estratégia', 'strategy', 'strategie', 'estrategia'],
  ['Fantasia', 'fantasy', 'fantastique', 'fantasia'],
  ['Exploração', 'exploration', 'exploracao'],
  ['Cooperação', 'cooperative play', 'cooperation'],
  ['Controle de área', 'area control', 'area majority', 'controle de zone'],
  ['Seleção de ações', 'action selection', 'selection d actions'],
  ['Pontos de ação', 'action points', 'points d action'],
  ['Coleção de conjuntos', 'set collection', 'collection d ensembles'],
  ['Colocação de peças', 'tile placement', 'placement de tuiles'],
  ['Construção de rotas', 'route building', 'construction de routes'],
  ['Movimento em grade', 'grid movement', 'deplacement sur grille'],
  ['Combate', 'combat', 'fighting'],
  ['Memória', 'memory', 'memoire'],
  ['Dedução', 'deduction'],
  ['Blefe', 'bluffing', 'bluff'],
  ['Sorte e risco', 'push your luck', 'stop ou encore'],
  ['Poderes variáveis', 'variable player powers', 'pouvoirs variables'],
  ['Tabuleiro modular', 'modular board', 'plateau modulaire'],
  ['Jogo de cartas', 'card game', 'jeu de cartes'],
  ['Jogo de tabuleiro', 'board game', 'jeu de plateau', 'jeu de societe'],
  ['Familiar', 'family game', 'familial'],
  ['Terror', 'horror', 'horreur'],
  ['Ficção científica', 'science fiction', 'sci fi'],
  ['Temático', 'thematic', 'thematique'],
  ['Abstrato', 'abstract strategy', 'abstrait'],
];
const key = (value) =>
  normalizeText(value)
    .replace(/['’\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const dictionary = new Map(terms.flatMap(([pt, ...names]) => [pt, ...names].map((name) => [key(name), pt])));
export const knownVocabulary = (value) => dictionary.has(key(value));
export function vocabularyTerm(value) {
  return dictionary.get(key(value)) || String(value).trim();
}
export function vocabularyFields(fields) {
  return { ...fields, ...Object.fromEntries(['tags', 'mechanics', 'gameType'].filter((field) => fields[field]).map((field) => [field, Array.isArray(fields[field]) ? [...new Set(fields[field].map(vocabularyTerm))] : vocabularyTerm(fields[field])])) };
}
