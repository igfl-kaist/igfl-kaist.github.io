import test from "node:test";
import assert from "node:assert/strict";
import { League } from "../server/league.mjs";
import { DIRECTORY_EXAMPLES } from "../src/directory-examples.mjs";
import { fixture } from "../dev/fixtures.mjs";
import { harness } from "./helpers/gas.mjs";
test("examples stay separate from real members, private profiles, rosters and every season's rankings", () => {
  const state = fixture();
  assert.equal(League.publicView(state).examples.teams.length, 0);
  state.settings.directoryExamplesEnabled = true;
  const before = JSON.stringify(state),
    view = League.publicView(state);
  assert.equal(view.examples.teams.length, 2);
  assert.equal(view.examples.players.length, 14);
  assert.equal(view.examples.players.filter((p) => !p.teamId).length, 2);
  assert.equal(view.examples.players.filter((p) => p.referee).length, 3);
  assert.equal(JSON.stringify(state), before);
  assert.equal(view.players.length, state.players.length);
  for (const board of view.seasonBoards)
    assert.ok(board.records.teams.every((t) => !t.id.startsWith("example-")));
  assert.doesNotMatch(
    JSON.stringify(view.examples),
    /@|identifier|consentVersion|sessionToken/,
  );
  for (const team of view.examples.teams) {
    assert.equal(team.members.length, 6);
    assert.ok(team.members.includes(team.captainId));
    assert.ok(team.members.includes(team.viceId));
    assert.ok(
      team.members.every(
        (id) =>
          view.examples.players.find((p) => p.id === id)?.teamId === team.id,
      ),
    );
  }
  view.examples.players[0].name = "client mutation";
  assert.equal(
    League.publicView(state).examples.players[0].name,
    DIRECTORY_EXAMPLES.players[0].name,
  );
});
test("forged example IDs cannot join, invite, recruit, referee or create real team memberships", () => {
  const now = Date.now(),
    state = fixture(now);
  state.settings.directoryExamplesEnabled = true;
  const example = DIRECTORY_EXAMPLES,
    before = JSON.stringify(state);
  const run = (id, command, args) =>
    League.execute(
      state,
      { userId: id, email: "synthetic@kaist.ac.kr" },
      command,
      { expectedRevision: state.revision, ...args },
      { now, id: () => "synthetic-test" },
    );
  assert.throws(
    () =>
      run("p19", "joinRequest", {
        teamId: example.teams[0].id,
        message: "synthetic",
      }),
    { code: "NOT_FOUND" },
  );
  assert.throws(
    () =>
      run("p1", "inviteMatch", {
        teamId: "t1",
        opponentId: example.teams[0].id,
        message: "synthetic",
      }),
    { code: "NOT_FOUND" },
  );
  assert.throws(
    () =>
      run("p19", "createTeam", {
        name: "합성 검증",
        description: "synthetic",
        members: ["p19", ...example.players.slice(0, 5).map((p) => p.id)],
        captainId: "p19",
        viceId: example.players[0].id,
      }),
    { code: "NOT_FOUND" },
  );
  assert.throws(
    () =>
      run("p1", "schedule", {
        teamId: "t1",
        opponentId: "t2",
        startsAt: now + 3 * 86400000,
        place: "합성",
        roster: ["p1", "p2", "p3", "p4", "p5", "p6"],
        refereeIds: [example.players[12].id],
      }),
    { code: "NON_NEUTRAL_REFEREE" },
  );
  assert.throws(() => run(example.players[0].id, "leaveTeam", {}), {
    code: "FORBIDDEN",
  });
  assert.equal(JSON.stringify(state), before);
});
test("owner example toggle preserves launch settings, authentication and the active league snapshot", () => {
  const h = harness(),
    pointer = h.properties.LEAGUE_ACTIVE_SNAPSHOT;
  h.properties.LEAGUE_REGISTRATION_OPEN = "true";
  h.properties.PRIVACY_STORAGE_APPROVED = "true";
  h.properties.LEAGUE_ADMIN_USER_IDS = "existing-operator";
  const authBefore = Object.keys(h.properties).filter((k) =>
    k.startsWith("IGFL_AUTH:"),
  );
  const enabled = h.c.configureDirectoryExamples();
  assert.equal(enabled.exampleTeams, 2);
  assert.equal(enabled.examplePlayers, 14);
  assert.equal(enabled.realPlayers, 0);
  assert.equal(enabled.realTeams, 0);
  assert.equal(enabled.registrationOpen, true);
  assert.equal(enabled.seasonOpen, false);
  assert.equal(enabled.leagueEmailsEnabled, false);
  assert.equal(h.c.configureDirectoryExamples().examplePlayers, 14);
  const disabled = h.c.disableDirectoryExamples();
  assert.equal(disabled.examplePlayers, 0);
  assert.equal(disabled.exampleTeams, 0);
  assert.equal(disabled.registrationOpen, true);
  assert.equal(h.properties.PRIVACY_STORAGE_APPROVED, "true");
  assert.equal(h.properties.LEAGUE_ADMIN_USER_IDS, "existing-operator");
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, pointer);
  assert.deepEqual(
    Object.keys(h.properties).filter((k) => k.startsWith("IGFL_AUTH:")),
    authBefore,
  );
});
