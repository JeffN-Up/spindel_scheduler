import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');

assert.match(app, /CURRENT_SCHEDULE_GID = '2063860995'/, 'current schedule gid should point to the 8/24-8/29 live tab');
assert.match(app, /LIVE_SPREADSHEET_URL/, 'live spreadsheet URL should be a shared app constant');
assert.match(app, /spindel-eye-associates-logo\.jpg/, 'Spindel logo should be incorporated into the app shell');
assert.match(app, /Live Spreadsheet/, 'header should always include a live spreadsheet link');
assert.doesNotMatch(app, /data\.map\(withCurrentWeekDate\)/, 'live sheet dates should not be rewritten to the current week');
assert.ok(existsSync(join(root, 'public/spindel-eye-associates-logo.jpg')), 'public logo asset should exist');

console.log('app shell tests passed');
