import { TERMINAL_BUFFER_LIMIT, TERMINAL_BUFFER_HEAD } from "../constants";

export function appendTerminalOutput(current: string, chunk: string): string {
  return compactTerminalOutput(`${current}${chunk}`);
}

export function compactTerminalOutput(value: string): string {
  if (value.length <= TERMINAL_BUFFER_LIMIT) return value;
  const markerFor = (removed: number) => `\n\n… terminal çıktısı kısaltıldı: ${removed.toLocaleString("tr-TR")} karakter gizlendi; son akış korunuyor …\n\n`;
  const initialMarker = markerFor(value.length - TERMINAL_BUFFER_HEAD);
  let tailLength = Math.max(0, TERMINAL_BUFFER_LIMIT - TERMINAL_BUFFER_HEAD - initialMarker.length);
  let removed = Math.max(0, value.length - TERMINAL_BUFFER_HEAD - tailLength);
  let marker = markerFor(removed);
  tailLength = Math.max(0, TERMINAL_BUFFER_LIMIT - TERMINAL_BUFFER_HEAD - marker.length);
  removed = Math.max(0, value.length - TERMINAL_BUFFER_HEAD - tailLength);
  marker = markerFor(removed);
  const next = [
    value.slice(0, TERMINAL_BUFFER_HEAD),
    marker,
    value.slice(-tailLength),
  ].join("");
  return next.length > TERMINAL_BUFFER_LIMIT ? next.slice(0, TERMINAL_BUFFER_LIMIT) : next;
}

export function formatTerminalRunOutput(command: string, statusLine: string, output: string): string {
  return terminalTranscript(command, statusLine, output);
}

export function terminalTranscript(command: string, statusLine: string, output = ""): string {
  return `$ ${command}\n${statusLine}${output ? `\n\n${output}` : ""}`;
}

export function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
