import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const panel = readFileSync(join(root, 'src/components/TechnicianProfilePanel.tsx'), 'utf8');

assert.match(panel, /tile\.openstreetmap\.org/, 'profile map should render street tiles');
assert.match(panel, /aria-label="Spindel office area map"/, 'the map should be labelled for accessibility');
assert.match(panel, /view\.on\('click', \(\{ latlng \}\) => updateHomePin\(latlng\)\)/, 'home pins should use coordinates from the visible map');
assert.match(panel, /circleMarker\(\[lat, lng\]/, 'office markers should be rendered on the same map as the streets');

console.log('technician profile panel tests passed');
