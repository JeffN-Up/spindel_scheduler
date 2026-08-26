import assert from 'node:assert/strict';
import { parseDoctorScheduleCsv, applyDoctorScheduleToWeek } from '../src/services/doctorScheduleImportService';
import { type SheetDaySchedule } from '../src/services/sheetService';

const csv = [
  'Date,Day,Derry,LDerry,Windham,Raymond,Bedford,Surgery',
  '8/26,Wednesday,"GS DR","BN","MF JO(p)","DV NL","JN",""',
  '8/27,Thursday,"GS SW","MF BN","JO","NL","DS JN",""',
].join('\n');

const parsed = parseDoctorScheduleCsv(csv);
assert.equal(parsed.entries.length, 2);
assert.deepEqual(parsed.entries[0].locations.Derry.map(item => item.person), ['GS', 'DR']);
assert.deepEqual(parsed.entries[0].locations.Windham.map(item => item.person), ['MF', 'JO']);
assert.equal(parsed.entries[0].locations.Windham[1].status, 'p');
assert.deepEqual(parsed.warnings, []);

const week: SheetDaySchedule[] = [{
  date: '8/26',
  dayName: 'Wednesday',
  locations: {
    Derry: [
      { person: 'OLD', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true },
      { person: 'SG', role: 'Technician', startTime: '7:45a', endTime: '2:00p', location: 'Derry', isDoctor: false },
    ],
    Windham: [
      { person: 'CV', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Windham', isDoctor: false },
    ],
    Londonderry: [],
    Raymond: [],
    Bedford: [],
    Surgery: [],
    Off: [],
    Floating: [],
  },
}];

const merge = applyDoctorScheduleToWeek(week, parsed.entries);
assert.equal(merge.appliedAssignments, 8);
assert.deepEqual(merge.updatedDayIndexes, [0]);
assert.deepEqual(merge.unmatchedDates, ['8/27']);
assert.deepEqual(merge.schedules[0].locations.Derry.map(item => item.person), ['GS', 'DR', 'SG']);
assert.deepEqual(merge.schedules[0].locations.Windham.map(item => item.person), ['MF', 'JO', 'CV']);
assert.equal(merge.schedules[0].locations.Windham[1].status, 'p');
assert.equal(merge.schedules[0].locations.Derry.find(item => item.person === 'SG')?.isDoctor, false);

const mainScheduleCsv = [
  ' ,Monday,,,Tuesday,,,Wednesday,,,Thursday,,,Friday,,,Saturday,,',
  ',8/24,,,8/25,,,8/26,,,8/27,,,8/28,,,8/29,,',
  'DERRY,SW DS(p),,,MF DS SW(p),,,GS DR,,,GS SW,,,SW,,,,,',
  'WINDHAM,DV JO,,,JO(a) DV(a),,,MF JO,,,JO,,,DV,,,,,',
  'NOTES,,,,,,,,,,,,,,,,,,',
].join('\n');
const summaryImport = parseDoctorScheduleCsv(mainScheduleCsv);
assert.equal(summaryImport.entries.find(entry => entry.date === '8/26')?.locations.Derry.map(item => item.person).join(','), 'GS,DR');

console.log('doctor schedule import tests passed');
