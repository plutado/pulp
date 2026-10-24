/**
 * The reporter CI runs with: the verbose reporter, plus one line the moment a
 * test starts. A stalled job then names the test it is inside, rather than
 * the last one that finished (docs/platform-notes.md, "Windows CI").
 */

import { VerboseReporter, type TestCase } from 'vitest/node';

export default class CiReporter extends VerboseReporter {
  override onTestCaseReady(test: TestCase): void {
    const at = new Date().toISOString().slice(11, 19);
    this.ctx.logger.log(`  ▶ ${at} ${test.module.moduleId.split(/[\\/]/).pop()} › ${test.fullName}`);
    super.onTestCaseReady(test);
  }
}
