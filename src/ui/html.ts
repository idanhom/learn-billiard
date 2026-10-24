/** Text made safe to put inside HTML, in content or a double-quoted attribute. */
export function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
