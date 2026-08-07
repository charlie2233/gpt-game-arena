export type SubmissionWorkflowCase = {
  tools_triggered?: unknown;
  expected_output?: unknown;
};

export function validatePositiveWorkflows(testCases: SubmissionWorkflowCase[], knownTools: Set<string>): string[];
export function validateNegativeWorkflows(testCases: SubmissionWorkflowCase[]): string[];
