/**
 * Legacy save compatibility: old providers persisted a newspaper headline as
 * the first diplomatic message and as the thread subject. Render a spoken
 * invitation for that one case; never alter the saved record or the LLM input.
 */
export function diplomaticMessageForDisplay(
  content: string,
  subject: string | null | undefined,
  role: string,
): string {
  const text = content.trim();
  if (role !== 'polity' || !subject || text !== subject.trim() ||
      !text || text.length > 200 || /[.!?…]$/.test(text)) return content;
  return `Desideriamo sottoporre al vostro governo questa questione: ${text.charAt(0).toLowerCase() + text.slice(1)}. Prima di assumere impegni, vorremmo conoscere la vostra posizione e le condizioni che ritenete necessarie.`;
}
