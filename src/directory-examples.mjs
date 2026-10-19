// Fictional, public display data. Never insert these into players, profiles or teams.
export const DIRECTORY_EXAMPLES = Object.freeze({
  teams: [
    {
      id: "example-team-datakick",
      name: "데이터킥 (샘플)",
      description:
        "가상 팀이에요. 서로 다른 연구실이 함께 뛰는 모습을 소개해요.",
      captainId: "example-player-01",
      viceId: "example-player-02",
      members: Array.from(
        { length: 6 },
        (_, i) => "example-player-" + String(i + 1).padStart(2, "0"),
      ),
      recruiting: true,
      status: "active",
      image: null,
      example: true,
    },
    {
      id: "example-team-lab-united",
      name: "랩 유나이티드 (샘플)",
      description: "가상 팀이에요. 팀 프로필과 선수 구성을 살펴보세요.",
      captainId: "example-player-07",
      viceId: "example-player-08",
      members: Array.from(
        { length: 6 },
        (_, i) => "example-player-" + String(i + 7).padStart(2, "0"),
      ),
      recruiting: false,
      status: "active",
      image: null,
      example: true,
    },
  ],
  players: Array.from({ length: 14 }, (_, i) => ({
    id: "example-player-" + String(i + 1).padStart(2, "0"),
    name: "샘플 선수 " + String(i + 1).padStart(2, "0"),
    lab: ["가상 데이터 연구실", "가상 최적화 연구실", "가상 의사결정 연구실"][
      i % 3
    ],
    referee: [2, 8, 12].includes(i),
    teamId:
      i < 6
        ? "example-team-datakick"
        : i < 12
          ? "example-team-lab-united"
          : null,
    example: true,
  })),
});
