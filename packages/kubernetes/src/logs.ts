import { stripVTControlCharacters } from "node:util";

export function cleanLogText(value: string): string {
  const withoutOperatingSystemCommands = value.replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g, "");
  return stripVTControlCharacters(withoutOperatingSystemCommands).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}
