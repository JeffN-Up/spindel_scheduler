import { SheetAssignment, SheetDaySchedule } from './sheetService';
import { canonicalizeTechnicianInitials } from './technicianRosterService';

export interface MyDaySummary {
  day: SheetDaySchedule;
  locationId: string;
  assignment: SheetAssignment;
  doctors: SheetAssignment[];
  technicians: SheetAssignment[];
  hours: string;
  notes: string;
}

const formatHours = (assignment: SheetAssignment) => {
  if (!assignment.startTime && !assignment.endTime) return 'Hours not listed';
  if (!assignment.endTime) return assignment.startTime;
  if (!assignment.startTime) return assignment.endTime;
  return `${assignment.startTime} - ${assignment.endTime}`;
};

const DEFAULT_END_TIME_MINUTES = 16 * 60 + 45;

const parseTimeToMinutes = (value: string): number | null => {
  const match = value.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(a|am|p|pm)$/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3][0];

  if (hours > 12 || minutes > 59) return null;
  if (meridiem === 'p' && hours !== 12) hours += 12;
  if (meridiem === 'a' && hours === 12) hours = 0;

  return hours * 60 + minutes;
};

const appendNote = (notes: string[], note: string) => {
  if (!notes.some(existing => existing.toLowerCase() === note.toLowerCase())) {
    notes.push(note);
  }
};

const getLocationNotes = (day: SheetDaySchedule, assignments: SheetAssignment[]): string => {
  const notes: string[] = [];
  if (day.notes?.trim()) notes.push(day.notes.trim());

  for (const assignment of assignments) {
    if (assignment.isDoctor || !assignment.endTime) continue;

    const endMinutes = parseTimeToMinutes(assignment.endTime);
    if (endMinutes !== null && endMinutes < DEFAULT_END_TIME_MINUTES) {
      appendNote(notes, `${canonicalizeTechnicianInitials(assignment.person)} until ${assignment.endTime}`);
    }
  }

  return notes.join('; ');
};

export function getMyDaySummary(day: SheetDaySchedule, technicianId: string): MyDaySummary | null {
  const selectedTech = canonicalizeTechnicianInitials(technicianId);
  if (!selectedTech) return null;

  for (const [locationId, assignments] of Object.entries(day.locations)) {
    const assignment = assignments.find(item =>
      !item.isDoctor && canonicalizeTechnicianInitials(item.person) === selectedTech
    );
    if (!assignment) continue;

    return {
      day,
      locationId,
      assignment,
      doctors: assignments.filter(item => item.isDoctor),
      technicians: assignments.filter(item =>
        !item.isDoctor && canonicalizeTechnicianInitials(item.person) !== selectedTech
      ),
      hours: formatHours(assignment),
      notes: getLocationNotes(day, assignments),
    };
  }

  return null;
}
