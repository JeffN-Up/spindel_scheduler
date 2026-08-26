import assert from 'node:assert/strict';
import { getMyDaySummary } from '../src/services/myDayService';

const summary = getMyDaySummary({
  date: '8/12/26',
  dayName: 'Wednesday',
  locations: {
    Derry: [
      { person: 'MG', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true },
      { person: 'SW', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true },
      { person: 'JC', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Derry', isDoctor: false },
      { person: 'AP', role: 'Technician', startTime: '8:00a', endTime: '5:00p', location: 'Derry', isDoctor: false },
    ],
    Windham: [
      { person: 'DS_T', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Windham', isDoctor: false },
    ],
  },
}, 'JC');

assert.ok(summary);
assert.equal(summary?.locationId, 'Derry');
assert.equal(summary?.hours, '7:45a - 4:45p');
assert.deepEqual(summary?.doctors.map(person => person.person), ['MG', 'SW']);
assert.deepEqual(summary?.technicians.map(person => person.person), ['AP']);
assert.equal((summary?.notes || '').includes('SG until 2:00p'), false);

const windhamSummary = getMyDaySummary({
  date: '8/12/26',
  dayName: 'Wednesday',
  locations: {
    Derry: [
      { person: 'JC', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Derry', isDoctor: false },
    ],
    Windham: [
      { person: 'DSJ', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Windham', isDoctor: false },
      { person: 'SG', role: 'Technician', startTime: '7:45a', endTime: '2:00p', location: 'Windham', isDoctor: false },
    ],
  },
}, 'DSJ');

assert.equal(windhamSummary?.notes, 'SG until 2:00p');

const canonicalSummary = getMyDaySummary({
  date: '8/12/26',
  dayName: 'Wednesday',
  locations: {
    Windham: [
      { person: 'DS_T', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Windham', isDoctor: false },
    ],
  },
}, 'DSJ');

assert.equal(canonicalSummary?.assignment.person, 'DS_T');
assert.equal(getMyDaySummary(canonicalSummary ? { ...canonicalSummary.day, locations: {} } : {
  date: '8/12/26',
  dayName: 'Wednesday',
  locations: {},
}, 'JC'), null);

console.log('my day summary tests passed');
