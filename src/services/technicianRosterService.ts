import { Technician } from '../constants/technicians';
import { type SheetDaySchedule } from './sheetService';

export const SCHEDULE_CHANGE_REQUESTS_STORAGE_KEY = 'spindelScheduleChangeRequests';
const CANONICAL_TECHNICIAN_IDS: Record<string, string> = {
  DS_T: 'DSJ',
};
const ACTIVE_TECH_STATUSES = new Set([
  'LASIK', 'BIO', 'VF', 'OCT', 'OUT', 'REQ', 'PREOPS',
  'PREOPS_ADMIN', 'FLOAT', 'FLOATING',
]);

export interface TechnicianRosterUpdate {
  initials: string;
  fullRefracting: boolean;
  refractingNote?: string;
}

export interface ScheduleChangeRequestInput {
  requester: string;
  dayName: string;
  details: string;
}

export interface ScheduleChangeRequest {
  id: string;
  requester: string;
  dayName: string;
  details: string;
  status: 'open' | 'done';
  createdAt: string;
}

export function normalizeTechnicianInitials(initials: string) {
  return initials.trim().toUpperCase().replace(/\s+/g, '_');
}

export function canonicalizeTechnicianInitials(initials: string) {
  const normalized = normalizeTechnicianInitials(initials);
  return CANONICAL_TECHNICIAN_IDS[normalized] || normalized;
}

const parseRosterDate = (value: string, today: Date) => {
  const parts = value.split('/').map(part => Number(part));
  if (parts.length < 2 || parts.some(Number.isNaN)) return null;

  const [month, day, rawYear] = parts;
  const year = rawYear === undefined
    ? today.getFullYear()
    : rawYear < 100 ? 2000 + rawYear : rawYear;

  return new Date(year, month - 1, day);
};

const hasRosterActivity = (assignment: { startTime?: string; endTime?: string; location?: string; status?: string }) => {
  if (assignment.startTime || assignment.endTime) return true;
  if (assignment.location && !['Floating', 'Off'].includes(assignment.location)) return true;

  const status = normalizeTechnicianInitials(assignment.status || '');
  if (!status) return false;
  const statusParts = status.split(/[_/,]+/).filter(Boolean);
  return ACTIVE_TECH_STATUSES.has(status) || statusParts.some(part => ACTIVE_TECH_STATUSES.has(part));
};

export function buildRecentTechnicianRoster(
  schedules: SheetDaySchedule[],
  knownTechnicians: Record<string, Technician>,
  options: { today?: Date; doctorIds?: string[]; lookbackDays?: number; includeHistorical?: boolean } = {}
): Record<string, Technician> {
  const today = options.today || new Date();
  const lookbackDays = options.lookbackDays ?? 14;
  const roster: Record<string, Technician> = {};

  for (const daySchedule of schedules) {
    const rosterDate = parseRosterDate(daySchedule.date, today);
    if (rosterDate && !options.includeHistorical) {
      const ageDays = (today.getTime() - rosterDate.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > lookbackDays) continue;
    }

    for (const assignments of Object.values(daySchedule.locations)) {
      for (const assignment of assignments) {
        const canonicalId = canonicalizeTechnicianInitials(assignment.person);
        if (!canonicalId || assignment.isDoctor || !hasRosterActivity(assignment)) continue;
        roster[canonicalId] = knownTechnicians[canonicalId] || { fullRefracting: true };
      }
    }
  }

  return Object.fromEntries(Object.entries(roster).sort(([a], [b]) => a.localeCompare(b)));
}

export function upsertTechnicianInRoster(
  roster: Record<string, Technician>,
  update: TechnicianRosterUpdate
): Record<string, Technician> {
  const initials = canonicalizeTechnicianInitials(update.initials);
  if (!initials) {
    throw new Error('Technician initials are required.');
  }

  const refractingNote = update.fullRefracting
    ? undefined
    : update.refractingNote?.trim() || 'Does not refract yet';

  return {
    ...roster,
    [initials]: {
      ...(roster[initials] || {}),
      fullRefracting: update.fullRefracting,
      ...(refractingNote ? { refractingNote } : {}),
    },
  };
}

export function removeTechnicianFromRoster(
  roster: Record<string, Technician>,
  initials: string
): Record<string, Technician> {
  const normalized = normalizeTechnicianInitials(initials);
  const { [normalized]: _removed, ...remaining } = roster;
  return remaining;
}

export function createScheduleChangeRequest(input: ScheduleChangeRequestInput): ScheduleChangeRequest {
  const requester = normalizeTechnicianInitials(input.requester || 'Admin');
  const details = input.details.trim();
  if (!details) {
    throw new Error('Schedule change details are required.');
  }

  return {
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    requester: requester || 'ADMIN',
    dayName: input.dayName,
    details,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
}
