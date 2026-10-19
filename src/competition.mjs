export const COMPETITION = Object.freeze({
  preseasonId: "preseason-2026-27",
  regularId: "regular-2027",
  preseasonName: "2026–27 프리시즌",
  regularName: "2027 정규리그",
  periodLabel: "2027년 봄학기 개강 전까지 · 정확한 종료일 추후 공지",
  calendarUrl: "https://www.kaist.ac.kr/kr/html/edu/03110101.html",
});
export const isUnrefereed = (m) =>
  m.phase === "preseason" && m.refereeMode === "none";
export const matchDuration = (m) => (2 * (m.halfMinutes || 20) + 5) * 60000;
export const formatLabel = (m) =>
  `${m.phase === "preseason" ? "프리시즌" : "정규리그"} · ${m.playersPerSide || 5}대${m.playersPerSide || 5} · ${m.halfMinutes || 20}분 / 5분 / ${m.halfMinutes || 20}분`;
