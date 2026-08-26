import assert from 'node:assert/strict';
import { parseSheetRows } from '../src/services/sheetService';

const rows: string[][] = [
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['', 'Monday', '', '', 'Tuesday', '', '', 'Wednesday', '', '', 'Thursday', '', '', 'Friday', '', '', 'Saturday', '', ''],
  ['', '03/09', '', '', '03/10', '', '', '03/11', '', '', '03/12', '', '', '03/13', '', '', '03/14', '', ''],
  ['Doctor', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['JC', 'D', '', '', 'OFF', '', '', 'D', '', '', 'D', '', '', '', '', '', '', '', ''],
  ['Tech', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['JC', 'LD', '7:45a', '4:45p', 'D', '12:30p', '4:45p', 'REQ', '', '', 'LD', '7:45a', '7:45p', 'OFF', '', '', '', '', ''],
  ['Notes', 'SW late clinic', '', '', '', '', '', '', '', '', '', '', '', 'SERUM TEARS', '', '', '', '', ''],
];

const schedules = parseSheetRows(rows);
const monday = schedules[0];
const tuesday = schedules[1];
const friday = schedules[4];

assert.equal(schedules.length, 6);
assert.equal(monday.notes, 'SW late clinic');
assert.equal(friday.notes, 'SERUM TEARS');

const mondayDoctor = monday.locations.Derry.find(assignment => assignment.person === 'JC' && assignment.isDoctor);
const mondayTech = monday.locations.Londonderry.find(assignment => assignment.person === 'JC' && !assignment.isDoctor);
const tuesdayDoctorOff = tuesday.locations.Off.find(assignment => assignment.person === 'JC' && assignment.isDoctor);
const tuesdayTech = tuesday.locations.Derry.find(assignment => assignment.person === 'JC' && !assignment.isDoctor);

assert.ok(mondayDoctor, 'JC in the Doctor section should parse as a doctor in Derry');
assert.ok(mondayTech, 'JC in the Tech section should parse as a technician in Londonderry');
assert.ok(tuesdayDoctorOff, 'OFF status should route doctors to the Off location');
assert.ok(tuesdayTech, 'Tech section should keep JC as a technician even when JC is also a doctor ID');
assert.equal(tuesdayTech?.startTime, '12:30p');
assert.equal(tuesdayTech?.endTime, '4:45p');

const compactRows: string[][] = [
  [' ', 'Week of 8/10-8/15 Monday', '', '', 'Tuesday', '', '', 'Wednesday', '', '', 'Thursday', '', '', 'Friday', '', '', 'Saturday', '', ''],
  ['', '8/10', '', '', '8/11', '', '', '8/12', '', '', '8/13', '', '', '8/14', '', '', '8/15', '', ''],
  ['DSJ', '7:45a', '4:45p', 'W', 'LASIK', '', '', '', '', 'DR', '7:45a', '4:45p', 'D', '', '', 'REQ', '', '', ''],
  ['JC', '7:45a', '4:45p', 'D', '12:30p', '4:45p', 'D', '7:45a', '7:45p', 'W', '7:45a', '4:45p', 'D', '7:30a', '4:30p', 'D', '', '', ''],
  ['SG', '', '', '', '', '', '', '7:45a', '2:00p', 'W', '', '', '', '', '', '', '', '', ''],
  ['DERRY', 'SW DS(p)', '', '', 'MF DS SW(p)', '', '', 'GS DR', '', '', 'GS SW', '', '', 'SW', '', '', 'SW', '', ''],
  ['Notes', 'SW 515', '', '', '', '', '', 'JO late night', '', '', '', '', '', 'SERUM TEARS', '', '', '', '', ''],
];

const compactSchedules = parseSheetRows(compactRows);
const compactMonday = compactSchedules[0];
const compactWednesday = compactSchedules[2];
const compactTuesday = compactSchedules[1];

assert.equal(compactMonday.dayName, 'Monday');
assert.equal(compactMonday.date, '8/10');
assert.ok(compactMonday.locations.Windham.find(assignment => assignment.person === 'DSJ' && !assignment.isDoctor));
assert.ok(compactMonday.locations.Derry.find(assignment => assignment.person === 'JC' && !assignment.isDoctor));
assert.deepEqual(
  compactMonday.locations.Derry.filter(assignment => assignment.isDoctor).map(assignment => assignment.person),
  ['SW', 'DS'],
  'DERRY summary doctor cells should create doctor assignments for Monday'
);
assert.deepEqual(
  compactTuesday.locations.Derry.filter(assignment => assignment.isDoctor).map(assignment => assignment.person),
  ['MF', 'DS', 'SW'],
  'DERRY summary doctor cells should create doctor assignments for Tuesday'
);
assert.equal(compactMonday.locations.Floating.find(assignment => assignment.person === 'DERRY'), undefined);
assert.equal(compactWednesday.notes, 'JO late night');

console.log('sheetService parser regression tests passed');
