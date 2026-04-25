const T = {
  TEAM: "TEAM",
  MEMBER: "MEMBER",
  ORG_TEAM: "ORG_TEAM",
  SECTION_OWNERSHIP: "SECTION_OWNERSHIP",
  SECTION_TEMPLATE: "SECTION_TEMPLATE",
  PATTERN: "PATTERN",
  EXCLUDE: "EXCLUDE",
  TEXT: "TEXT",
};

function tokenize(text) {
  const tokens = [];
  let templateMode = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();

    if (templateMode) {
      if (line.startsWith("team:")) {
        templateMode = false;
        tokens.push({ type: T.TEAM, value: line.slice(5).trim() });
      } else {
        tokens.push({ type: T.TEXT, raw: rawLine });
      }
      continue;
    }

    if (!line) continue;

    switch (line[0]) {
      case "+":
        tokens.push({ type: T.MEMBER, value: line.slice(1).trim() });
        break;
      case "@":
        tokens.push({ type: T.ORG_TEAM, value: line.slice(1).trim() });
        break;
      case "=":
        if (line === "=ownership:") tokens.push({ type: T.SECTION_OWNERSHIP });
        else if (line === "=template:") {
          tokens.push({ type: T.SECTION_TEMPLATE });
          templateMode = true;
        }
        break;
      case "!":
        tokens.push({ type: T.EXCLUDE, value: line.slice(1).trim() });
        break;
      default:
        if (line.startsWith("team:"))
          tokens.push({ type: T.TEAM, value: line.slice(5).trim() });
        else tokens.push({ type: T.PATTERN, value: line });
    }
  }

  return tokens;
}

function parse(tokens) {
  const teams = [];
  let current = null;
  let section = "members";

  for (const tok of tokens) {
    if (tok.type === T.TEAM) {
      if (current) teams.push(finalizeTeam(current));
      current = {
        name: tok.value,
        members: [],
        orgTeams: [],
        includePatterns: [],
        excludePatterns: [],
        templateLines: [],
      };
      section = "members";
      continue;
    }

    if (!current) continue;

    switch (tok.type) {
      case T.SECTION_OWNERSHIP:
        section = "ownership";
        break;
      case T.SECTION_TEMPLATE:
        section = "template";
        break;
      case T.MEMBER:
        if (section === "members") current.members.push(tok.value);
        break;
      case T.ORG_TEAM:
        if (section === "members") current.orgTeams.push(tok.value);
        break;
      case T.PATTERN:
        if (section === "ownership") current.includePatterns.push(tok.value);
        break;
      case T.EXCLUDE:
        if (section === "ownership") current.excludePatterns.push(tok.value);
        break;
      case T.TEXT:
        current.templateLines.push(tok.raw);
        break;
    }
  }

  if (current) teams.push(finalizeTeam(current));
  return teams;
}

function finalizeTeam(raw) {
  const lines = [...raw.templateLines];
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return {
    name: raw.name,
    members: raw.members,
    orgTeams: raw.orgTeams,
    includePatterns: raw.includePatterns,
    excludePatterns: raw.excludePatterns,
    template: lines.length ? lines.join("\n") : null,
  };
}

function parseOwnership(text) {
  return parse(tokenize(text));
}

module.exports = { tokenize, parse, parseOwnership };
