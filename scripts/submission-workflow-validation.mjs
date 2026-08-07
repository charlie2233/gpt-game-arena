export function validatePositiveWorkflows(testCases, knownTools) {
  const errors = [];
  let createWorkflowCount = 0;
  let importWorkflowCount = 0;

  if (testCases.length !== 5) errors.push("submission must contain exactly five positive cases");

  for (const [index, testCase] of testCases.entries()) {
    const label = `submission positive case ${index + 1}`;
    const toolsTriggered = testCase?.tools_triggered;
    if (typeof toolsTriggered !== "string" || toolsTriggered.trim().length === 0) {
      errors.push(`${label}: tools_triggered must be a nonempty string`);
      continue;
    }

    const rawSegments = toolsTriggered.split(",");
    if (rawSegments.some(segment => segment.trim().length === 0)) {
      errors.push(`${label}: tools_triggered contains a blank tool segment`);
      continue;
    }
    const workflow = rawSegments.map(segment => segment.trim());

    for (const tool of workflow) {
      if (!knownTools.has(tool)) errors.push(`${label}: unknown tool token ${tool}`);
    }
    const seen = new Set();
    for (const tool of workflow) {
      if (seen.has(tool)) errors.push(`${label}: duplicate tool token ${tool}`);
      seen.add(tool);
    }

    const createCount = workflow.filter(tool => tool === "create_game").length;
    const renderCount = workflow.filter(tool => tool === "render_game").length;
    const hasCreate = createCount > 0;
    const hasImport = workflow.includes("import_go_position");
    if (!hasCreate && !hasImport) errors.push(`${label}: workflow must start from create_game or import_go_position`);

    if (hasCreate) {
      createWorkflowCount += 1;
      if (workflow[0] !== "create_game") errors.push(`${label}: create_game must be the first tool`);
      if (createCount !== 1) errors.push(`${label}: create_game must appear exactly once`);
      if (renderCount !== 1) errors.push(`${label}: render_game must appear exactly once`);
      if (workflow.indexOf("render_game") !== workflow.indexOf("create_game") + 1) {
        errors.push(`${label}: render_game must appear immediately after create_game`);
      }
      if (typeof testCase?.expected_output !== "string" || !testCase.expected_output.includes("interactive board renders from the same gameId")) {
        errors.push(`${label}: expected output must confirm the interactive board uses the same gameId`);
      }
    }

    if (hasImport) {
      importWorkflowCount += 1;
      if (renderCount !== 0) errors.push(`${label}: import_go_position must not include render_game`);
      if (workflow.length !== 1 || workflow[0] !== "import_go_position") {
        errors.push(`${label}: import workflow must contain only import_go_position`);
      }
    }
  }

  if (createWorkflowCount !== 4) errors.push("submission must contain exactly four create_game workflows");
  if (importWorkflowCount !== 1) errors.push("submission must contain exactly one import_go_position workflow");
  return errors;
}

export function validateNegativeWorkflows(testCases) {
  const errors = [];
  if (testCases.length !== 3) errors.push("submission must contain exactly three negative cases");
  for (const [index, testCase] of testCases.entries()) {
    if (testCase?.tools_triggered !== null) errors.push(`submission negative case ${index + 1}: tools_triggered must remain null`);
  }
  return errors;
}
