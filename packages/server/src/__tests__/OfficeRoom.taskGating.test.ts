import { shouldMarkTaskDone } from '../rooms/OfficeRoom';

describe('task completion gating', () => {
  it('requires artifact + tool execution + validator approval before completion', () => {
    expect(shouldMarkTaskDone({ artifactExists: true, toolExecutionSucceeded: false, validatorApproved: true })).toBe(false);
    expect(shouldMarkTaskDone({ artifactExists: true, toolExecutionSucceeded: true, validatorApproved: false })).toBe(false);
    expect(shouldMarkTaskDone({ artifactExists: false, toolExecutionSucceeded: true, validatorApproved: true })).toBe(false);
    expect(shouldMarkTaskDone({ artifactExists: true, toolExecutionSucceeded: true, validatorApproved: true })).toBe(true);
  });
});
