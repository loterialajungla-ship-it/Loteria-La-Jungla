/** Une clases CSS, omitiendo valores falsy. Sin dependencias externas. */
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
