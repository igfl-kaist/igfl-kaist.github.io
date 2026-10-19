/** Owner-only display toggle. Does not create real members, teams or auth identities. */
function configureDirectoryExamples() {
  return locked_(() => {
    storageProperties_(config_()).setProperty(
      "LEAGUE_DIRECTORY_EXAMPLES",
      "true",
    );
    return inspectDirectoryExamples_();
  });
}
function disableDirectoryExamples() {
  return locked_(() => {
    storageProperties_(config_()).setProperty(
      "LEAGUE_DIRECTORY_EXAMPLES",
      "false",
    );
    return inspectDirectoryExamples_();
  });
}
function inspectDirectoryExamples_() {
  const config = config_(),
    p = storageProperties_(config),
    state = loadLeague_(config),
    view = League.publicView(state);
  const status = {
    enabled: state.settings.directoryExamplesEnabled,
    exampleTeams: view.examples.teams.length,
    examplePlayers: view.examples.players.length,
    realTeams: state.teams.length,
    realPlayers: state.players.length,
    registrationOpen: state.settings.registrationOpen,
    seasonOpen: state.settings.seasonOpen,
    leagueEmailsEnabled: p.getProperty("LEAGUE_EMAILS_ENABLED") === "true",
  };
  Logger.log(JSON.stringify(status));
  return status;
}
function inspectDirectoryExamples() {
  return locked_(() => inspectDirectoryExamples_());
}
