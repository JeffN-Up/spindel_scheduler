import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const panel = readFileSync(join(root, 'src/components/TechnicianProfilePanel.tsx'), 'utf8');

assert.match(panel, /https:\/\/www\.google\.com\/maps/, 'profile map should use a real Google Maps embed');
assert.match(panel, /output=embed/, 'profile map should render an embedded map view');
assert.match(panel, /title="Spindel office area map"/, 'embedded map should be labelled for accessibility');
assert.match(panel, /pointerEvents:\s*'none'/, 'drop-pin layer should stay clickable over the embedded map');
assert.match(panel, /OFFICE_COORDINATES/, 'office markers should stay aligned to known office coordinates');

console.log('technician profile panel tests passed');
