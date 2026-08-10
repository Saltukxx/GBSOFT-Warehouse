const STOP_COLORS = [
  "#1684ad",
  "#159993",
  "#b66b00",
  "#66549c",
  "#287b56",
  "#aa3f3a",
  "#4466a3",
  "#8b6d2f",
];

export function colorForStop(stopSeq: number): string {
  return STOP_COLORS[Math.max(0, stopSeq - 1) % STOP_COLORS.length];
}
