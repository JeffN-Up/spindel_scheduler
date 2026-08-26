import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const css = readFileSync(join(root, 'src/index.css'), 'utf8');

assert.match(app, /CURRENT_SCHEDULE_GID = '2063860995'/, 'current schedule gid should point to the 8/24-8/29 live tab');
assert.match(app, /LIVE_SPREADSHEET_URL/, 'live spreadsheet URL should be a shared app constant');
assert.match(app, /spindel-eye-associates-logo\.jpg/, 'Spindel logo should be incorporated into the app shell');
assert.match(app, /Live Spreadsheet/, 'header should always include a live spreadsheet link');
assert.doesNotMatch(app, /data\.map\(withCurrentWeekDate\)/, 'live sheet dates should not be rewritten to the current week');
assert.ok(existsSync(join(root, 'public/spindel-eye-associates-logo.jpg')), 'public logo asset should exist');
assert.match(app, /my-day-doctor-badge/, 'My Day doctor initials should use a dedicated visible badge class');
assert.match(css, /\.my-day-doctor-badge[\s\S]*color:\s*#ffffff\s*!important/, 'My Day doctor badge text should stay white inside brand-main');
assert.match(app, /Doctor Schedule Automation/, 'admin shell should expose doctor schedule import automation');
assert.match(app, /handleDoctorScheduleUpload/, 'admin shell should handle doctor schedule CSV uploads');

console.log('app shell tests passed');
