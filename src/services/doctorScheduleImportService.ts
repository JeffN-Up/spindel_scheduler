import Papa from 'papaparse';
import { DOCTORS } from '../constants/doctors';
import { type SheetAssignment, type SheetDaySchedule, parseSheetRows } from './sheetService';

export interface DoctorScheduleEntry {
  date: string;
  dayName: string;
  locations: Record<string, SheetAssignment[]>;
}

export interface DoctorScheduleImportResult {
  entries: DoctorScheduleEntry[];
  warnings: string[];
}

export interface DoctorScheduleMergeResult {
  schedules: SheetDaySchedule[];
  updatedDayIndexes: number[];
  unmatchedDates: string[];
  appliedAssignments: number;
}

const DOCTOR_IDS = new Set(Object.keys(DOCTORS).map(id => id.toUpperCase()));
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOCTOR_IMPORT_LOCATIONS = ['Derry', 'Londonderry', 'Windham', 'Raymond', 'Bedford', 'Surgery'];

const LOCATION_ALIASES: Record<string, string> = {
  D: 'Derry',
  DERRY: 'Derry',
  LD: 'Londonderry',
  LDERRY: 'Londonderry',
  LONDONDERRY: 'Londonderry',
  LONDONDERRYOFFICE: 'Londonderry',
  W: 'Windham',
  WINDHAM: 'Windham',
  R: 'Raymond',
  RAYMOND: 'Raymond',
  B: 'Bedford',
  BEDFORD: 'Bedford',
  S: 'Surgery',
  SURGERY: 'Surgery',
  SURG: 'Surgery',
};

const emptyDoctorLocations = (): Record<string, SheetAssignment[]> =>
  Object.fromEntries(DOCTOR_IMPORT_LOCATIONS.map(location => [location, []]));

const normalize = (value: unknown): string => String(value ?? '').trim().replace(/\s+/g, ' ');

const normalizeCode = (value: unknown): string =>
  normalize(value).replace(/[^a-z0-9]/gi, '').toUpperCase();

const resolveLocation = (value: unknown): string | undefined => LOCATION_ALIASES[normalizeCode(value)];

const getDayName = (value: unknown): string => {
  const normalized = normalize(value);
  const upper = normalized.toUpperCase();
  return DAY_NAMES.find(day => upper.includes(day.toUpperCase())) || normalized;
};

const parseDateParts = (value: string): { year?: number; month: number; day: number } | null => {
  const normalized = normalize(value);
  if (!normalized) return null;

  const iso = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }

  const slash = normalized.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!slash) return null;

  const rawYear = slash[3] ? Number(slash[3]) : undefined;
  const year = rawYear && rawYear < 100 ? 2000 + rawYear : rawYear;
  return { year, month: Number(slash[1]), day: Number(slash[2]) };
};

const datesMatch = (left: string, right: string): boolean => {
  const a = parseDateParts(left);
  const b = parseDateParts(right);
  if (!a || !b) return normalize(left) === normalize(right);
  if (a.month !== b.month || a.day !== b.day) return false;
  return !a.year || !b.year || a.year === b.year;
};

const toDoctorAssignment = (person: string, location: string, status = ''): SheetAssignment => ({
  person,
  role: 'Doctor',
  startTime: '',
  endTime: '',
  location,
  isDoctor: true,
  status,
});

const parseDoctorCell = (value: unknown, location: string): { assignments: SheetAssignment[]; unknowns: string[] } => {
  const tokens = normalize(value).match(/[A-Za-z]+(?:\([^)]*\))?/g) || [];
  const assignments: SheetAssignment[] = [];
  const unknowns: string[] = [];

  for (const token of tokens) {
    const person = normalizeCode(token.replace(/\([^)]*\)/g, ''));
    if (!person) continue;

    if (!DOCTOR_IDS.has(person)) {
      unknowns.push(token);
      continue;
    }

    if (assignments.some(assignment => assignment.person === person)) continue;

    assignments.push(toDoctorAssignment(
      person,
      location,
      token.match(/\(([^)]*)\)/)?.[1]?.trim() || '',
    ));
  }

  return { assignments, unknowns };
};

const parseRows = (csv: string): string[][] => {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: false });
  return parsed.data
    .filter(row => Array.isArray(row))
    .map(row => row.map(cell => normalize(cell)));
};

const parseTableRows = (rows: string[][]): DoctorScheduleImportResult => {
  const warnings: string[] = [];
  const headerIndex = rows.findIndex(row =>
    row.some(cell => normalizeCode(cell) === 'DATE') &&
    row.filter(cell => resolveLocation(cell)).length >= 2
  );

  if (headerIndex < 0) return { entries: [], warnings };

  const header = rows[headerIndex];
  const dateCol = header.findIndex(cell => normalizeCode(cell) === 'DATE');
  const dayCol = header.findIndex(cell => normalizeCode(cell) === 'DAY' || normalizeCode(cell) === 'WEEKDAY');
  const locationColumns = header
    .map((cell, index) => ({ index, location: resolveLocation(cell) }))
    .filter((item): item is { index: number; location: string } => Boolean(item.location));

  const entries: DoctorScheduleEntry[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const date = normalize(row[dateCol]);
    if (!parseDateParts(date)) continue;

    const locations = emptyDoctorLocations();

    for (const { index, location } of locationColumns) {
      const { assignments, unknowns } = parseDoctorCell(row[index], location);
      locations[location] = assignments;
      if (unknowns.length) warnings.push(`${date} ${location}: ignored ${unknowns.join(', ')}`);
    }

    entries.push({
      date,
      dayName: getDayName(row[dayCol]) || '',
      locations,
    });
  }

  return { entries, warnings };
};

const parseSummaryRows = (rows: string[][]): DoctorScheduleImportResult => {
  try {
    const paddedRows = rows.length >= 5 ? rows : [...rows, ...Array.from({ length: 5 - rows.length }, () => [''])];
    const schedules = parseSheetRows(paddedRows);
    const entries = schedules
      .map(day => {
        const locations = emptyDoctorLocations();
        for (const location of DOCTOR_IMPORT_LOCATIONS) {
          locations[location] = (day.locations[location] || [])
            .filter(assignment => assignment.isDoctor)
            .map(assignment => ({ ...assignment, location }));
        }
        return { date: day.date, dayName: day.dayName, locations };
      })
      .filter(entry => Object.values(entry.locations).some(assignments => assignments.length > 0));

    return { entries, warnings: [] };
  } catch {
    return { entries: [], warnings: [] };
  }
};

export function parseDoctorScheduleCsv(csv: string): DoctorScheduleImportResult {
  const rows = parseRows(csv);
  const table = parseTableRows(rows);
  if (table.entries.length) return table;

  const summary = parseSummaryRows(rows);
  if (summary.entries.length) return summary;

  return {
    entries: [],
    warnings: ['No doctor schedule rows were found. Export the sheet as CSV with Date, Day, and office columns.'],
  };
}

export function applyDoctorScheduleToWeek(
  week: SheetDaySchedule[],
  entries: DoctorScheduleEntry[],
): DoctorScheduleMergeResult {
  const schedules = week.map(day => ({
    ...day,
    locations: Object.fromEntries(
      Object.entries(day.locations).map(([location, assignments]) => [
        location,
        assignments.map(assignment => ({ ...assignment })),
      ]),
    ),
  }));
  const updatedDayIndexes = new Set<number>();
  const unmatchedDates: string[] = [];
  let appliedAssignments = 0;

  for (const entry of entries) {
    const dayIndex = schedules.findIndex(day =>
      datesMatch(day.date, entry.date) ||
      (!!entry.dayName && day.dayName.toLowerCase() === entry.dayName.toLowerCase())
    );

    if (dayIndex < 0) {
      unmatchedDates.push(entry.date || entry.dayName);
      continue;
    }

    for (const [location, doctors] of Object.entries(entry.locations)) {
      if (!doctors.length) continue;

      const existing = schedules[dayIndex].locations[location] || [];
      const technicians = existing.filter(assignment => !assignment.isDoctor);
      schedules[dayIndex].locations[location] = [
        ...doctors.map(doctor => ({ ...doctor, location })),
        ...technicians,
      ];
      appliedAssignments += doctors.length;
      updatedDayIndexes.add(dayIndex);
    }
  }

  return {
    schedules,
    updatedDayIndexes: Array.from(updatedDayIndexes).sort((a, b) => a - b),
    unmatchedDates,
    appliedAssignments,
  };
}
