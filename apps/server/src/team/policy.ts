/**
 * Règles déterministes de la messagerie entre compagnons : réponses explicites,
 * accusés de réception et garde-fous anti ping-pong. Indépendant du modèle.
 */

/** Jeton explicite « pas de réponse nécessaire » qu'un compagnon peut renvoyer. */
export const NO_REPLY = /^\s*<no[_-]?reply\s*\/?>\s*$/i;

/** Nombre maximal de messages dans un même fil entre deux compagnons sur une heure. */
export const PAIR_THREAD_CAP = 12;

const ACK_WORDS =
  /^(ok(ay)?|d'?accord|dac|merci( beaucoup| bien)?|thanks?( you)?|thx|re[çc]u( 5\/5)?|bien re[çc]u|not[ée]|parfait|super|top|nickel|g[ée]nial|cool|great|got it|understood|compris|ça marche|ca marche|entendu|👍|🙏|✅)$/i;

/** Vrai si le texte n'est qu'un accusé de réception / remerciement, sans contenu à traiter. */
export function isPureAck(text: string): boolean {
  const t = text
    .trim()
    .replace(/[!.,;:\s]+$/g, '')
    .replace(/^[!.,;:\s]+/g, '');
  if (!t) return true;
  if (t.length > 80 || /\?/.test(t)) return false;
  // Découpe en segments (« Ok, merci ! », « Super, bien reçu »).
  const segments = t.split(/[!.,;:\n]+|\s+(?:et|and)\s+/i).map((s) => s.trim()).filter(Boolean);
  return segments.length > 0 && segments.every((s) => ACK_WORDS.test(s));
}

export type ReplyDecision = { kind: 'reply'; text: string } | { kind: 'no_reply' } | { kind: 'missing' };

/** Interprète la sortie finale d'un compagnon qui vient de traiter un message d'un coéquipier. */
export function decideReply(text: string): ReplyDecision {
  if (NO_REPLY.test(text)) return { kind: 'no_reply' };
  const cleaned = text.trim();
  if (!cleaned) return { kind: 'missing' };
  return { kind: 'reply', text: cleaned };
}

/** Faut-il réveiller l'expéditeur pour qu'il traite la réponse ? */
export function shouldWakeSender(p: { expectsReply: boolean; decision: ReplyDecision; depth: number; maxDepth: number; threadCount: number }): boolean {
  if (!p.expectsReply || p.decision.kind !== 'reply') return false;
  if (p.depth >= p.maxDepth || p.threadCount >= PAIR_THREAD_CAP) return false;
  return true;
}
