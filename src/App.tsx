import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  Calendar, 
  Users, 
  Settings, 
  LogOut, 
  RefreshCw,
  X,
  Link as LinkIcon,
  AlertCircle,
  Sparkles,
  History,
  Terminal,
  GripVertical,
  ArrowRight,
  Heart,
  MapPin,
  Navigation,
  UserPlus,
  Trash2,
  MessageSquare,
  CheckCircle2,
  Clock,
  Upload
} from 'lucide-react';
import { db, auth, signOut, OperationType, handleFirestoreError } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, updateDoc, collection, addDoc, query, orderBy, limit, where, getDocs, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { fetchSheetData, SheetDaySchedule, SheetAssignment } from './services/sheetService';
import { DOCTORS } from './constants/doctors';
import { TECHNICIANS } from './constants/technicians';
import { GeminiPanel } from './components/GeminiPanel';
import { processScheduleCommand, ScheduleAction } from './services/geminiService';
import { addDays, format, startOfWeek, subDays } from 'date-fns';
import { OFFICE_LOCATIONS, SCHEDULE_LOCATIONS, googleMapsDirectionsUrl } from './constants/locations';
import { TechnicianProfilePanel } from './components/TechnicianProfilePanel';
import { saveTechnicianProfile, subscribeToTechnicianProfiles, TechnicianProfile } from './services/technicianProfileService';
import { rankMoveCandidates } from './services/happyScheduleService';
import { parseLocalScheduleCommand } from './services/localCommandService';
import {
  buildRecentTechnicianRoster,
  canonicalizeTechnicianInitials,
  createScheduleChangeRequest,
  normalizeTechnicianInitials,
  removeTechnicianFromRoster,
  ScheduleChangeRequest,
  SCHEDULE_CHANGE_REQUESTS_STORAGE_KEY,
  upsertTechnicianInRoster,
} from './services/technicianRosterService';
import { DEFAULT_SHIFT, resolveShiftForAssignment, ShiftRule, SHIFT_RULES_STORAGE_KEY } from './services/shiftRuleService';
import { getMyDaySummary } from './services/myDayService';
import {
  applyDoctorScheduleToWeek,
  parseDoctorScheduleCsv,
  type DoctorScheduleImportResult,
} from './services/doctorScheduleImportService';

// Dnd Kit
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  defaultDropAnimationSideEffects,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// --- Types ---
const THEMES = [
  { id: 'brand', label: 'Spindel Classic', color: '#243078' },
  { id: 'dark', label: 'Calm Charcoal', color: '#121116' },
  { id: 'light', label: 'Soft Daylight', color: '#f7f4f2' },
  { id: 'midnight', label: 'Deep Indigo', color: '#020617' },
  { id: 'forest', label: 'Quiet Sage', color: '#022c22' },
];

const LOCATIONS = SCHEDULE_LOCATIONS;
type ViewMode = 'admin' | 'technician' | 'myday';

// --- Dnd Components ---
const SortableTechnician = ({ id, assignment, isAdmin, onClick, isDragging, refractingNote }: any) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id, disabled: !isAdmin });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const displayPerson = canonicalizeTechnicianInitials(assignment.person);
  const isTechnicianJc = displayPerson === 'JC' && !assignment.isDoctor;
  const neutralClass = isTechnicianJc
    ? 'bg-white border-[#dce1eb] text-black'
    : 'bg-white/5 border-white/10 text-white/60';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative"
    >
      <button
        onClick={onClick}
        {...attributes}
        {...listeners}
        title={refractingNote || `${assignment.person} ${assignment.status || ''}`}
        className={`px-2 py-1 border rounded-lg text-[0.6rem] font-bold transition-all flex items-center gap-1.5 ${refractingNote ? 'bg-amber-500/15 border-amber-400/30 text-amber-200' : neutralClass} ${isAdmin ? 'hover:bg-white/10 cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
      >
        {isAdmin && <GripVertical className="w-2.5 h-2.5 opacity-20 group-hover:opacity-100 transition-opacity" />}
        {displayPerson} {assignment.status && <span className="opacity-40 ml-1">[{assignment.status}]</span>}
        {refractingNote && <span className="text-[0.48rem] font-black">NO_REF</span>}
      </button>
    </div>
  );
};

const DroppableLocation = ({ id, children, className }: any) => {
  const { setNodeRef, isOver } = useSortable({ id });
  
  return (
    <div 
      ref={setNodeRef} 
      className={`${className} ${isOver ? 'ring-2 ring-blue-500/50 bg-blue-500/5' : ''}`}
    >
      {children}
    </div>
  );
};

const TODAY = new Date();
const CURRENT_WEEK_START = startOfWeek(TODAY, { weekStartsOn: 1 });
const CURRENT_DAY_INDEX = Math.min((TODAY.getDay() + 6) % 7, 5);
const weekLabel = (weekOffset: number) => {
  const start = addDays(CURRENT_WEEK_START, weekOffset * 7);
  return `${format(start, 'M/d')} - ${format(addDays(start, 5), 'M/d')}`;
};

const SPREADSHEET_ID = '10MTeD3grwqFyr4Odug3VQAih-8115_YVYlBNne2HzA0';
const CURRENT_SCHEDULE_GID = '2063860995';
const LIVE_SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=${CURRENT_SCHEDULE_GID}#gid=${CURRENT_SCHEDULE_GID}`;
const SHEET_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?usp=sharing`;
const SPINDEL_LOGO_URL = `${import.meta.env.BASE_URL}spindel-eye-associates-logo.jpg`;

const WEEKS = [
  { id: 'current', label: `Current Week · ${format(TODAY, 'M/d/yy')}`, gid: CURRENT_SCHEDULE_GID },
  { id: 'week2', label: weekLabel(1), gid: '11223344' }, // Placeholder GIDs
  { id: 'week3', label: weekLabel(2), gid: '55667788' },
  { id: 'saturdays', label: 'Saturdays', gid: '99001122' },
];

const UNIVERSAL_PASSWORD = '68Camaro!!!';
const ADMIN_PASSWORD_VERSION = '68Camaro!!!';
const LOCAL_TECHNICIAN_PROFILES_KEY = 'spindelTechnicianProfiles';

const INITIAL_WEEK_TEMPLATE: SheetDaySchedule[] = [
  {
    date: '03/09',
    dayName: 'Monday',
    locations: {
      'Derry': [
        { person: 'MG', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'SW', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'DS', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'LT', role: 'Technician', startTime: '7:15a', endTime: '4:15p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'CV', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'HB', role: 'Technician', startTime: '8:00a', endTime: '3:30p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'MC', role: 'Technician', startTime: '12:30p', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'SG', role: 'Technician', startTime: '9:00a', endTime: '5:30p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'CS', role: 'Technician', startTime: '7:45a', endTime: '3:00p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'MA', role: 'Technician', startTime: '12:30p', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' }
      ],
      'Londonderry': [
        { person: 'BN', role: 'Doctor', startTime: '', endTime: '', location: 'Londonderry', isDoctor: true, status: '' },
        { person: 'JC', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Londonderry', isDoctor: false, status: 'LD' },
        { person: 'MJ', role: 'Technician', startTime: '8:00a', endTime: '5:00p', location: 'Londonderry', isDoctor: false, status: 'LD' }
      ],
      'Windham': [
        { person: 'DV', role: 'Doctor', startTime: '', endTime: '', location: 'Windham', isDoctor: true, status: '' },
        { person: 'JO', role: 'Doctor', startTime: '', endTime: '', location: 'Windham', isDoctor: true, status: '' },
        { person: 'DJ', role: 'Technician', startTime: '7:15a', endTime: '4:45p', location: 'Windham', isDoctor: false, status: 'W' },
        { person: 'DSJ', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Windham', isDoctor: false, status: 'W' },
        { person: 'AB', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Windham', isDoctor: false, status: 'W' },
        { person: 'JJ', role: 'Technician', startTime: '7:30a', endTime: '2:30p', location: 'Windham', isDoctor: false, status: 'W' }
      ],
      'Bedford': [
        { person: 'JN', role: 'Doctor', startTime: '', endTime: '', location: 'Bedford', isDoctor: true, status: '' },
        { person: 'AP', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Bedford', isDoctor: false, status: 'B' },
        { person: 'TB', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Bedford', isDoctor: false, status: 'B' }
      ],
      'Raymond': [
        { person: 'NL', role: 'Doctor', startTime: '', endTime: '', location: 'Raymond', isDoctor: true, status: '' },
        { person: 'ML', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Raymond', isDoctor: false, status: 'R' },
        { person: 'SC', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Raymond', isDoctor: false, status: 'R' }
      ],
      'Surgery': [
        { person: 'DS', role: 'Doctor', startTime: '', endTime: '', location: 'Surgery', isDoctor: true, status: '' }
      ],
      'Off': [
        { person: 'GS', role: 'Doctor', startTime: '', endTime: '', location: 'Off', isDoctor: true, status: '' },
        { person: 'MF', role: 'Doctor', startTime: '', endTime: '', location: 'Off', isDoctor: true, status: '' }
      ],
      'Floating': [
        { person: 'NC', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'OUT' },
        { person: 'HR', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'OUT' },
        { person: 'KM', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'BIO' },
        { person: 'GW', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'VF' }
      ]
    },
    notes: 'SW 515 | JO last pt @ 2pm'
  },
  {
    date: '03/10',
    dayName: 'Tuesday',
    locations: {
      'Derry': [
        { person: 'DS', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'MG', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'SW', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'LT', role: 'Technician', startTime: '7:15a', endTime: '4:15p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'JC', role: 'Technician', startTime: '12:30p', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'HR', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'MC', role: 'Technician', startTime: '7:15a', endTime: '7:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'MJ', role: 'Technician', startTime: '8:00a', endTime: '7:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'AP', role: 'Technician', startTime: '12:30p', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'ML', role: 'Technician', startTime: '12:30p', endTime: '6:00p', location: 'Derry', isDoctor: false, status: 'D' }
      ],
      'Windham': [
        { person: 'DV', role: 'Doctor', startTime: '', endTime: '', location: 'Windham', isDoctor: true, status: '' },
        { person: 'JO', role: 'Doctor', startTime: '', endTime: '', location: 'Windham', isDoctor: true, status: '' },
        { person: 'CV', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Windham', isDoctor: false, status: 'W' },
        { person: 'AB', role: 'Technician', startTime: '7:15a', endTime: '3:00p', location: 'Windham', isDoctor: false, status: 'W' },
        { person: 'JJ', role: 'Technician', startTime: '7:30a', endTime: '4:45p', location: 'Windham', isDoctor: false, status: 'W' },
        { person: 'SC', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Windham', isDoctor: false, status: 'W' }
      ],
      'Bedford': [
        { person: 'JN', role: 'Doctor', startTime: '', endTime: '', location: 'Bedford', isDoctor: true, status: '' },
        { person: 'HB', role: 'Technician', startTime: '8:00a', endTime: '4:45p', location: 'Bedford', isDoctor: false, status: 'B' },
        { person: 'MA', role: 'Technician', startTime: '7:30a', endTime: '7:45p', location: 'Bedford', isDoctor: false, status: 'B' },
        { person: 'CS', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Bedford', isDoctor: false, status: 'B' },
        { person: 'BM', role: 'Technician', startTime: '8:30a', endTime: '4:45p', location: 'Bedford', isDoctor: false, status: 'B' }
      ],
      'Raymond': [
        { person: 'NL', role: 'Doctor', startTime: '', endTime: '', location: 'Raymond', isDoctor: true, status: '' },
        { person: 'SG', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Raymond', isDoctor: false, status: 'R' },
        { person: 'TB', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Raymond', isDoctor: false, status: 'R' }
      ],
      'Surgery': [
        { person: 'MG', role: 'Doctor', startTime: '', endTime: '', location: 'Surgery', isDoctor: true, status: '' },
        { person: 'DV', role: 'Doctor', startTime: '', endTime: '', location: 'Surgery', isDoctor: true, status: '' }
      ],
      'Off': [
        { person: 'GS', role: 'Doctor', startTime: '', endTime: '', location: 'Off', isDoctor: true, status: '' },
        { person: 'MF', role: 'Doctor', startTime: '', endTime: '', location: 'Off', isDoctor: true, status: '' },
        { person: 'BN', role: 'Doctor', startTime: '', endTime: '', location: 'Off', isDoctor: true, status: '' }
      ],
      'Floating': [
        { person: 'DJ', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'LASIK' },
        { person: 'CG', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'LASIK' },
        { person: 'KM', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'LASIK' },
        { person: 'NC', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'OUT' },
        { person: 'DSJ', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'LASIK' },
        { person: 'GW', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'VF' }
      ]
    },
    notes: 'SW JN late night | DV return after Lasik'
  },
  {
    date: '03/11',
    dayName: 'Wednesday',
    locations: {
      'Derry': [
        { person: 'GS', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'DR', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'LT', role: 'Technician', startTime: '7:15a', endTime: '4:15p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'JC', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'HR', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'SG', role: 'Technician', startTime: '7:45a', endTime: '2:00p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'TB', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'LB', role: 'Technician', startTime: '7:45a', endTime: '12:30p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'CG', role: 'Technician', startTime: '3:00p', endTime: '', location: 'Derry', isDoctor: false, status: 'GS' }
      ],
      'Londonderry': [
        { person: 'BN', role: 'Doctor', startTime: '', endTime: '', location: 'Londonderry', isDoctor: true, status: '' },
        { person: 'MA', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Londonderry', isDoctor: false, status: 'LD' },
        { person: 'CS', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Londonderry', isDoctor: false, status: 'LD' },
        { person: 'BM', role: 'Technician', startTime: '8:30a', endTime: '4:45p', location: 'Londonderry', isDoctor: false, status: 'LD' }
      ],
      'Windham': [
        { person: 'JO', role: 'Doctor', startTime: '', endTime: '', location: 'Windham', isDoctor: true, status: '' },
        { person: 'JJ', role: 'Technician', startTime: '7:45a', endTime: '7:45p', location: 'Windham', isDoctor: false, status: 'W' },
        { person: 'ML', role: 'Technician', startTime: '7:45a', endTime: '7:45p', location: 'Windham', isDoctor: false, status: 'W' }
      ],
      'Bedford': [
        { person: 'JN', role: 'Doctor', startTime: '', endTime: '', location: 'Bedford', isDoctor: true, status: '' },
        { person: 'MC', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Bedford', isDoctor: false, status: 'B' },
        { person: 'AP', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Bedford', isDoctor: false, status: 'B' }
      ],
      'Raymond': [
        { person: 'DV', role: 'Doctor', startTime: '', endTime: '', location: 'Raymond', isDoctor: true, status: '' },
        { person: 'NL', role: 'Doctor', startTime: '', endTime: '', location: 'Raymond', isDoctor: true, status: '' },
        { person: 'DJ', role: 'Technician', startTime: '7:15a', endTime: '4:30p', location: 'Raymond', isDoctor: false, status: 'R' },
        { person: 'AB', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Raymond', isDoctor: false, status: 'R' },
        { person: 'HB', role: 'Technician', startTime: '8:00a', endTime: '4:45p', location: 'Raymond', isDoctor: false, status: 'R' }
      ],
      'Surgery': [
        { person: 'MG', role: 'Doctor', startTime: '', endTime: '', location: 'Surgery', isDoctor: true, status: '' },
        { person: 'DS', role: 'Doctor', startTime: '', endTime: '', location: 'Surgery', isDoctor: true, status: '' }
      ],
      'Off': [
        { person: 'MF', role: 'Doctor', startTime: '', endTime: '', location: 'Off', isDoctor: true, status: '' },
        { person: 'SW', role: 'Doctor', startTime: '', endTime: '', location: 'Off', isDoctor: true, status: '' }
      ],
      'Floating': [
        { person: 'NC', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'OUT' },
        { person: 'GW', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'VF' }
      ]
    },
    notes: 'JO late night'
  },
  {
    date: '03/12',
    dayName: 'Thursday',
    locations: {
      'Derry': [
        { person: 'GS', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'MG', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'SW', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'CV', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'MA', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'JJ', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'SG', role: 'Technician', startTime: '9:00a', endTime: '5:00p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'CS', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'BM', role: 'Technician', startTime: '8:30a', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' }
      ],
      'Londonderry': [
        { person: 'BN', role: 'Doctor', startTime: '', endTime: '', location: 'Londonderry', isDoctor: true, status: '' },
        { person: 'JC', role: 'Technician', startTime: '7:45a', endTime: '7:45p', location: 'Londonderry', isDoctor: false, status: 'LD' },
        { person: 'AP', role: 'Technician', startTime: '7:45a', endTime: '7:45p', location: 'Londonderry', isDoctor: false, status: 'LD' }
      ],
      'Windham': [
        { person: 'JO', role: 'Doctor', startTime: '', endTime: '', location: 'Windham', isDoctor: true, status: '' },
        { person: 'HR', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Windham', isDoctor: false, status: 'W' },
        { person: 'TB', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Windham', isDoctor: false, status: 'W' }
      ],
      'Bedford': [
        { person: 'JN', role: 'Doctor', startTime: '', endTime: '', location: 'Bedford', isDoctor: true, status: '' },
        { person: 'MC', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Bedford', isDoctor: false, status: 'B' },
        { person: 'ML', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Bedford', isDoctor: false, status: 'B' }
      ],
      'Raymond': [
        { person: 'NL', role: 'Doctor', startTime: '', endTime: '', location: 'Raymond', isDoctor: true, status: '' },
        { person: 'AB', role: 'Technician', startTime: '7:30a', endTime: '7:45p', location: 'Raymond', isDoctor: false, status: 'R' },
        { person: 'HB', role: 'Technician', startTime: '7:45a', endTime: '7:45p', location: 'Raymond', isDoctor: false, status: 'R' }
      ],
      'Surgery': [
        { person: 'DV', role: 'Doctor', startTime: '', endTime: '', location: 'Surgery', isDoctor: true, status: '' },
        { person: 'DS', role: 'Doctor', startTime: '', endTime: '', location: 'Surgery', isDoctor: true, status: '' }
      ],
      'Off': [
        { person: 'MF', role: 'Doctor', startTime: '', endTime: '', location: 'Off', isDoctor: true, status: '' }
      ],
      'Floating': [
        { person: 'DJ', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'ADMIN' },
        { person: 'CG', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'PREOPS' },
        { person: 'LT', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'REQ' },
        { person: 'KM', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'BIO' },
        { person: 'NC', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'OUT' },
        { person: 'DSJ', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'DR' },
        { person: 'GW', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'OCT' }
      ]
    },
    notes: 'BN NL late night'
  },
  {
    date: '03/13',
    dayName: 'Friday',
    locations: {
      'Derry': [
        { person: 'SW', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'KM', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'MJ', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'MA', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'CS', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'BM', role: 'Technician', startTime: '8:30a', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'D' }
      ],
      'Londonderry': [
        { person: 'MG', role: 'Doctor', startTime: '', endTime: '', location: 'Londonderry', isDoctor: true, status: '' },
        { person: 'BN', role: 'Doctor', startTime: '', endTime: '', location: 'Londonderry', isDoctor: true, status: '' },
        { person: 'JC', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Londonderry', isDoctor: false, status: 'LD' },
        { person: 'HR', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Londonderry', isDoctor: false, status: 'LD' },
        { person: 'AP', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Londonderry', isDoctor: false, status: 'LD' }
      ],
      'Windham': [
        { person: 'DV', role: 'Doctor', startTime: '', endTime: '', location: 'Windham', isDoctor: true, status: '' },
        { person: 'JO', role: 'Doctor', startTime: '', endTime: '', location: 'Windham', isDoctor: true, status: '' },
        { person: 'CV', role: 'Technician', startTime: '7:30a', endTime: '4:45p', location: 'Windham', isDoctor: false, status: 'W' },
        { person: 'AB', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Windham', isDoctor: false, status: 'W' }
      ],
      'Bedford': [
        { person: 'JN', role: 'Doctor', startTime: '', endTime: '', location: 'Bedford', isDoctor: true, status: '' },
        { person: 'MC', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Bedford', isDoctor: false, status: 'B' },
        { person: 'ML', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Bedford', isDoctor: false, status: 'B' }
      ],
      'Raymond': [
        { person: 'NL', role: 'Doctor', startTime: '', endTime: '', location: 'Raymond', isDoctor: true, status: '' },
        { person: 'HB', role: 'Technician', startTime: '7:45a', endTime: '4:45p', location: 'Raymond', isDoctor: false, status: 'R' },
        { person: 'SG', role: 'Technician', startTime: '7:30a', endTime: '4:30p', location: 'Raymond', isDoctor: false, status: 'R' }
      ],
      'Surgery': [
        { person: 'DS', role: 'Doctor', startTime: '', endTime: '', location: 'Surgery', isDoctor: true, status: '' }
      ],
      'Off': [
        { person: 'GS', role: 'Doctor', startTime: '', endTime: '', location: 'Off', isDoctor: true, status: '' },
        { person: 'MF', role: 'Doctor', startTime: '', endTime: '', location: 'Off', isDoctor: true, status: '' }
      ],
      'Floating': [
        { person: 'DJ', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'OFF' },
        { person: 'CG', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'PREOPS' },
        { person: 'LT', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'REQ' },
        { person: 'NC', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'OUT' },
        { person: 'GW', role: 'Technician', startTime: '', endTime: '', location: 'Floating', isDoctor: false, status: 'VF' }
      ]
    },
    notes: 'SERUM TEARS'
  },
  {
    date: '03/14',
    dayName: 'Saturday',
    locations: {
      'Derry': [
        { person: 'SW', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'BN', role: 'Doctor', startTime: '', endTime: '', location: 'Derry', isDoctor: true, status: '' },
        { person: 'MJ', role: 'Technician', startTime: '7:45a', endTime: '3:00p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'JJ', role: 'Technician', startTime: '7:45a', endTime: '3:00p', location: 'Derry', isDoctor: false, status: 'D' },
        { person: 'DJ', role: 'Technician', startTime: '7:15a', endTime: '4:45p', location: 'Derry', isDoctor: false, status: 'W' }
      ]
    },
    notes: ''
  }
];

const INITIAL_WEEK_DATA: SheetDaySchedule[] = INITIAL_WEEK_TEMPLATE.map((day, index) => ({
  ...day,
  date: format(addDays(CURRENT_WEEK_START, index), 'M/d/yy'),
}));

interface StaffCardProps {
  assignment: SheetAssignment;
  loc: any;
  getValidationIssues: any;
  isFullRefracting: any;
  onEdit: () => void;
  key?: string | number;
}

function StaffCard({ assignment, loc, getValidationIssues, isFullRefracting, onEdit }: StaffCardProps) {
  return (
    <motion.div 
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={onEdit}
      className="group relative bg-white/[0.03] backdrop-blur-xl border border-white/10 p-4 rounded-2xl hover:bg-white/[0.07] transition-all cursor-pointer overflow-hidden shadow-lg"
    >
      {/* Glow Effect */}
      <div 
        className="absolute -left-20 -top-20 w-40 h-40 opacity-0 group-hover:opacity-20 transition-opacity duration-500 blur-3xl pointer-events-none"
        style={{ backgroundColor: loc.color }}
      />
      
      <div 
        className="absolute left-0 top-0 bottom-0 w-[3px] opacity-30 group-hover:opacity-100 transition-all duration-300"
        style={{ backgroundColor: loc.color, boxShadow: `0 0 20px ${loc.color}` }}
      />
      
      <div className="flex justify-between items-start mb-3">
        <div className="space-y-0.5">
          <span 
            className="font-mono font-bold text-lg tracking-tight block"
            style={{ color: assignment.person === 'JC' && assignment.isDoctor ? '#ff4d4d' : 'inherit' }}
          >
            {assignment.person}
            {isFullRefracting(assignment.person) && (
              <span className="ml-2 inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]" title="Full Refracting" />
            )}
          </span>
          <span className="text-[0.5rem] uppercase tracking-[0.2em] text-white/30 font-bold">
            {assignment.role}
          </span>
        </div>
        <div 
          className={`px-2 py-0.5 rounded-lg text-[0.45rem] font-bold border ${assignment.isDoctor ? 'bg-white text-black border-white' : 'bg-white/5 text-white/40 border-white/10'}`}
        >
          {assignment.isDoctor ? 'MD_SURGEON' : 'CLINIC_TECH'}
        </div>
      </div>

      {getValidationIssues(assignment, loc.id).length > 0 && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg space-y-1">
          {getValidationIssues(assignment, loc.id).map((issue: string, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[0.5rem] text-red-400 font-mono">
              <AlertCircle className="w-2.5 h-2.5" />
              <span>{issue}</span>
            </div>
          ))}
        </div>
      )}
      
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2 text-[0.6rem] font-mono text-white/60">
          <RefreshCw className="w-2.5 h-2.5 opacity-30" />
          <span>{assignment.startTime} {assignment.endTime && `→ ${assignment.endTime}`}</span>
        </div>
        
        {assignment.status && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/5 rounded-lg border border-white/5">
            <div className="w-1 h-1 rounded-full bg-white/40 animate-pulse" />
            <span className="text-[0.45rem] font-bold text-white/60 uppercase tracking-widest">
              {assignment.status}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function EditAssignmentModal({ assignment, onClose, onSave }: { 
  assignment: SheetAssignment; 
  onClose: () => void; 
  onSave: (updated: SheetAssignment | null) => void;
}) {
  const [edited, setEdited] = useState(assignment);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/90 backdrop-blur-xl"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 30 }}
        className="brand-surface relative w-full max-w-md bg-white border border-[#dce1eb] rounded-3xl p-10 shadow-2xl"
      >
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-xl font-bold">Edit Assignment: {assignment.person}</h2>
          <button 
            onClick={() => setShowDeleteConfirm(true)}
            className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-colors"
            title="Delete Assignment"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {showDeleteConfirm ? (
          <div className="space-y-6 py-4">
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-center">
              <p className="text-sm font-mono text-red-400">Are you sure you want to delete this assignment?</p>
            </div>
            <div className="flex gap-4">
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 py-4 rounded-2xl text-sm font-bold transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={() => onSave(null)}
                className="flex-1 bg-red-500 text-white py-4 rounded-2xl text-sm font-bold transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[0.6rem] uppercase tracking-widest text-white/40 font-bold">Person ID</label>
              <input 
                type="text" 
                value={edited.person}
                onChange={(e) => setEdited({ ...edited, person: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm font-mono focus:outline-none focus:border-white/30"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[0.6rem] uppercase tracking-widest text-white/40 font-bold">Role</label>
              <select 
                value={edited.isDoctor ? 'Doctor' : 'Technician'}
                onChange={(e) => setEdited({ ...edited, isDoctor: e.target.value === 'Doctor', role: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm font-mono focus:outline-none focus:border-white/30"
              >
                <option value="Doctor" className="bg-[#0a0c10]">Doctor</option>
                <option value="Technician" className="bg-[#0a0c10]">Technician</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[0.6rem] uppercase tracking-widest text-white/40 font-bold">Start Time</label>
              <input 
                type="text" 
                value={edited.startTime}
                onChange={(e) => setEdited({ ...edited, startTime: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm font-mono focus:outline-none focus:border-white/30"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[0.6rem] uppercase tracking-widest text-white/40 font-bold">End Time</label>
              <input 
                type="text" 
                value={edited.endTime}
                onChange={(e) => setEdited({ ...edited, endTime: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm font-mono focus:outline-none focus:border-white/30"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[0.6rem] uppercase tracking-widest text-white/40 font-bold">Status / Location Override</label>
              <input 
                type="text" 
                value={edited.status}
                onChange={(e) => setEdited({ ...edited, status: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm font-mono focus:outline-none focus:border-white/30"
              />
            </div>
            
            <div className="pt-4 flex gap-4">
              <button 
                onClick={onClose}
                className="flex-1 bg-white/5 hover:bg-white/10 py-4 rounded-2xl text-sm font-bold transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={() => onSave(edited)}
                className="flex-1 bg-white text-black py-4 rounded-2xl text-sm font-bold transition-all"
              >
                Save Changes
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

import { initializeConstraints, subscribeToDoctors, subscribeToTechnicians, updateDoctorConstraint, updateTechConstraint, deleteTechConstraint } from "./services/constraintService";
import { Doctor } from "./constants/doctors";
import { Technician } from "./constants/technicians";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('myday');
  const [selectedTech, setSelectedTech] = useState<string>('');
  const [schedule, setSchedule] = useState<SheetDaySchedule>(INITIAL_WEEK_DATA[CURRENT_DAY_INDEX]);
  const [allSchedules, setAllSchedules] = useState<SheetDaySchedule[]>(INITIAL_WEEK_DATA);
  const [doctors, setDoctors] = useState<Record<string, Doctor>>(DOCTORS);
  const [technicians, setTechnicians] = useState<Record<string, Technician>>(TECHNICIANS);
  const [technicianProfiles, setTechnicianProfiles] = useState<Record<string, TechnicianProfile>>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_TECHNICIAN_PROFILES_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [selectedDayIdx, setSelectedDayIdx] = useState(CURRENT_DAY_INDEX);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sheetUrl, setSheetUrl] = useState(localStorage.getItem('sheetUrl') || SHEET_EXPORT_URL);
  const [weekGids, setWeekGids] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('weekGids');
    const parsed = saved ? JSON.parse(saved) : {};
    return { week2: '', week3: '', saturdays: '', ...parsed, current: CURRENT_SCHEDULE_GID };
  });
  const [selectedWeek, setSelectedWeek] = useState(WEEKS[0]);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [editingAssignment, setEditingAssignment] = useState<{ assignment: SheetAssignment, locationId: string, index: number } | null>(null);
  const [theme, setTheme] = useState('brand');
  const [showGemini, setShowGemini] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [commandInput, setCommandInput] = useState('');
  const [isProcessingCommand, setIsProcessingCommand] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeAssignment, setActiveAssignment] = useState<SheetAssignment | null>(null);
  const [showTechProfile, setShowTechProfile] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordUnlocked, setPasswordUnlocked] = useState(() =>
    localStorage.getItem('spindelPasswordUnlocked') === 'true' &&
    localStorage.getItem('spindelAdminPasswordVersion') === ADMIN_PASSWORD_VERSION
  );
  const [techUnlocked, setTechUnlocked] = useState(() => localStorage.getItem('spindelTechUnlocked') === 'true');
  const [authError, setAuthError] = useState<string | null>(null);
  const [newTechInitials, setNewTechInitials] = useState('');
  const [newTechCanRefract, setNewTechCanRefract] = useState(true);
  const [newTechNote, setNewTechNote] = useState('');
  const [manualTechnicianIds, setManualTechnicianIds] = useState<string[]>([]);
  const [shiftRules, setShiftRules] = useState<ShiftRule[]>(() => {
    try {
      const saved = localStorage.getItem(SHIFT_RULES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [newShiftRule, setNewShiftRule] = useState<ShiftRule>({
    id: '',
    technician: '',
    dayName: 'Monday',
    locationId: 'Derry',
    startTime: DEFAULT_SHIFT.startTime,
    endTime: DEFAULT_SHIFT.endTime,
  });
  const [scheduleRequestText, setScheduleRequestText] = useState('');
  const [scheduleRequests, setScheduleRequests] = useState<ScheduleChangeRequest[]>(() => {
    try {
      const saved = localStorage.getItem(SCHEDULE_CHANGE_REQUESTS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [doctorScheduleImport, setDoctorScheduleImport] = useState<DoctorScheduleImportResult | null>(null);
  const [doctorImportMessage, setDoctorImportMessage] = useState('');

  const adminUser = user?.email === 'jefchapin@gmail.com';
  const hasAccess = Boolean(user) || passwordUnlocked || techUnlocked;
  const isAdmin = Boolean(passwordUnlocked || adminUser);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user) return;

    if (isAdmin) {
      initializeConstraints().catch((err) => {
        console.error('Failed to initialize constraints:', err);
      });
    }

    const handleConstraintError = (err: Error) => {
      console.error('Failed to load schedule constraints:', err);
    };

    const unsubDoctors = subscribeToDoctors(setDoctors, handleConstraintError);
    const unsubTechs = subscribeToTechnicians(setTechnicians, handleConstraintError);
    const unsubProfiles = subscribeToTechnicianProfiles(setTechnicianProfiles, handleConstraintError);
    return () => {
      unsubDoctors();
      unsubTechs();
      unsubProfiles();
    };
  }, [user, isAdmin]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        // Default to admin if it's the specific admin email, otherwise technician
        if (u.email === 'jefchapin@gmail.com') {
          setViewMode('admin');
        } else {
          setViewMode('myday');
        }
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (passwordUnlocked && !user) {
      setViewMode('admin');
    }
  }, [passwordUnlocked, user]);

  useEffect(() => {
    if (techUnlocked && !passwordUnlocked && !user) {
      setViewMode('myday');
    }
  }, [techUnlocked, passwordUnlocked, user]);

  useEffect(() => {
    localStorage.setItem(SCHEDULE_CHANGE_REQUESTS_STORAGE_KEY, JSON.stringify(scheduleRequests));
  }, [scheduleRequests]);

  useEffect(() => {
    localStorage.setItem(LOCAL_TECHNICIAN_PROFILES_KEY, JSON.stringify(technicianProfiles));
  }, [technicianProfiles]);

  useEffect(() => {
    localStorage.setItem(SHIFT_RULES_STORAGE_KEY, JSON.stringify(shiftRules));
  }, [shiftRules]);

  useEffect(() => {
    if (!user || !isAdmin) return;
    
    const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLogs(newLogs);
    }, (err) => {
      console.error('Failed to load audit logs:', err);
    });

    // Cleanup logs older than 5 days
    const cleanupLogs = async () => {
      const fiveDaysAgo = subDays(new Date(), 5);
      const oldLogsQuery = query(collection(db, 'audit_logs'), where('timestamp', '<', Timestamp.fromDate(fiveDaysAgo)));
      const oldLogs = await getDocs(oldLogsQuery);
      oldLogs.forEach(async (logDoc) => {
        await deleteDoc(doc(db, 'audit_logs', logDoc.id));
      });
    };
    cleanupLogs().catch((err) => {
      console.error('Failed to clean audit logs:', err);
    });

    return unsubscribe;
  }, [user, isAdmin]);

  const addLog = async (action: string, description: string, details: any = {}) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'audit_logs'), {
        timestamp: serverTimestamp(),
        userEmail: user.email,
        action,
        description,
        details
      });
    } catch (err) {
      console.error('Failed to add log:', err);
    }
  };

  const handlePasswordSubmit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setAuthError(null);
    if (passwordInput.trim() !== UNIVERSAL_PASSWORD) {
      setAuthError('Incorrect password.');
      return;
    }
    localStorage.setItem('spindelPasswordUnlocked', 'true');
    localStorage.setItem('spindelAdminPasswordVersion', ADMIN_PASSWORD_VERSION);
    localStorage.removeItem('spindelTechUnlocked');
    setPasswordUnlocked(true);
    setTechUnlocked(false);
    setViewMode('admin');
    setPasswordInput('');
  };

  const handleTechnicianLogin = () => {
    localStorage.setItem('spindelTechUnlocked', 'true');
    localStorage.removeItem('spindelPasswordUnlocked');
    localStorage.removeItem('spindelAdminPasswordVersion');
    setTechUnlocked(true);
    setPasswordUnlocked(false);
    setViewMode('myday');
    setAuthError(null);
  };

  const handleSignOut = () => {
    localStorage.removeItem('spindelPasswordUnlocked');
    localStorage.removeItem('spindelTechUnlocked');
    setPasswordUnlocked(false);
    setTechUnlocked(false);
    setSelectedTech('');
    if (user) signOut();
  };

  const handleAddTechnician = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      const initials = canonicalizeTechnicianInitials(newTechInitials);
      const update = {
        initials,
        fullRefracting: newTechCanRefract,
        refractingNote: newTechCanRefract ? undefined : newTechNote || 'Does not refract yet',
      };

      setTechnicians(current => upsertTechnicianInRoster(current, update));
      setManualTechnicianIds(current => Array.from(new Set([...current, initials])).sort());
      if (user) {
        await updateTechConstraint(initials, {
          fullRefracting: update.fullRefracting,
          ...(update.refractingNote ? { refractingNote: update.refractingNote } : {}),
        });
        await addLog('TECHNICIAN_ROSTER', `Added or updated technician ${initials}`, update);
      }

      setNewTechInitials('');
      setNewTechCanRefract(true);
      setNewTechNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add technician.');
    }
  };

  const handleRemoveTechnician = async (initials: string) => {
    const normalized = canonicalizeTechnicianInitials(initials);
    if (!normalized) return;

    setTechnicians(current => removeTechnicianFromRoster(current, normalized));
    setManualTechnicianIds(current => current.filter(id => id !== normalized));
    if (selectedTech === normalized) setSelectedTech('');

    if (user) {
      try {
        await deleteTechConstraint(normalized);
        await addLog('TECHNICIAN_ROSTER', `Removed technician ${normalized}`, { initials: normalized });
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `technicians/${normalized}`);
      }
    }
  };

  const handleScheduleRequestSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      const requester = selectedTech || 'Admin';
      const profile = technicianProfiles[requester];
      const favoriteOffice = profile?.officeRanking?.[0];
      const dayOffice = allSchedules[selectedDayIdx]
        ? Object.entries(allSchedules[selectedDayIdx].locations)
            .find(([, assignments]) => assignments.some(assignment => !assignment.isDoctor && canonicalizeTechnicianInitials(assignment.person) === requester))?.[0]
        : undefined;
      const commuteNote = profile && dayOffice
        ? ` Current: ${dayOffice}${profile.commuteMiles?.[dayOffice] !== undefined ? ` (${profile.commuteMiles[dayOffice]} mi)` : ''}. Favorite: ${favoriteOffice || 'not set'}.`
        : '';
      const request = createScheduleChangeRequest({
        requester,
        dayName: allSchedules[selectedDayIdx]?.dayName || schedule.dayName,
        details: `${scheduleRequestText.trim()}${commuteNote}`,
      });
      setScheduleRequests(current => [request, ...current].slice(0, 25));
      setScheduleRequestText('');
      await addLog('SCHEDULE_REQUEST', `${request.requester} requested a schedule change`, request);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule change request.');
    }
  };

  const handleResolveScheduleRequest = (requestId: string) => {
    setScheduleRequests(current =>
      current.map(request => request.id === requestId ? { ...request, status: 'done' } : request)
    );
  };

  const handleDoctorScheduleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    try {
      const imported = parseDoctorScheduleCsv(await file.text());
      setDoctorScheduleImport(imported);
      setDoctorImportMessage(imported.entries.length
        ? `Ready to apply ${imported.entries.length} day${imported.entries.length === 1 ? '' : 's'} of doctor coverage.`
        : 'No doctor schedule rows were found in that upload.'
      );
    } catch (err) {
      setDoctorScheduleImport(null);
      setDoctorImportMessage('');
      setError(err instanceof Error ? err.message : 'Failed to read doctor schedule upload.');
    }
  };

  const applyDoctorScheduleImport = async () => {
    if (!doctorScheduleImport || !doctorScheduleImport.entries.length) return;

    setError(null);
    try {
      const merge = applyDoctorScheduleToWeek(allSchedules, doctorScheduleImport.entries);
      setAllSchedules(merge.schedules);
      setSchedule(merge.schedules[selectedDayIdx] || merge.schedules[0]);

      if (user) {
        await Promise.all(merge.updatedDayIndexes.map(dayIndex => persistDaySchedule(merge.schedules[dayIndex])));
        await addLog('DOCTOR_SCHEDULE_IMPORT', 'Imported doctor schedule coverage', {
          daysUpdated: merge.updatedDayIndexes.length,
          appliedAssignments: merge.appliedAssignments,
          unmatchedDates: merge.unmatchedDates,
        });
      }

      const skipped = merge.unmatchedDates.length
        ? ` ${merge.unmatchedDates.length} uploaded date${merge.unmatchedDates.length === 1 ? '' : 's'} did not match this selected week.`
        : '';
      setDoctorImportMessage(
        `Applied ${merge.appliedAssignments} doctor assignment${merge.appliedAssignments === 1 ? '' : 's'} to ${merge.updatedDayIndexes.length} day${merge.updatedDayIndexes.length === 1 ? '' : 's'}.${skipped}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply doctor schedule import.');
    }
  };

  const addShiftRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const technician = canonicalizeTechnicianInitials(newShiftRule.technician);
    if (!technician) return;
    setShiftRules(current => [
      ...current,
      { ...newShiftRule, id: `shift_${Date.now()}`, technician },
    ]);
    setNewShiftRule({
      id: '',
      technician: '',
      dayName: newShiftRule.dayName,
      locationId: newShiftRule.locationId,
      startTime: DEFAULT_SHIFT.startTime,
      endTime: DEFAULT_SHIFT.endTime,
    });
  };

  const removeShiftRule = (ruleId: string) => {
    setShiftRules(current => current.filter(rule => rule.id !== ruleId));
  };

  const getDefaultShift = (person: string, dayName: string, locationId: string) =>
    resolveShiftForAssignment({ person, dayName, locationId, rules: shiftRules });

  const cloneDaySchedule = (day: SheetDaySchedule): SheetDaySchedule => ({
    ...day,
    locations: Object.fromEntries(
      Object.entries(day.locations).map(([locationId, assignments]) => [
        locationId,
        assignments.map(assignment => ({ ...assignment })),
      ])
    ),
  });

  const getActionDayIndex = (day?: string) => {
    if (!day) return selectedDayIdx;
    const normalizedDay = day.toLowerCase();
    const foundIdx = allSchedules.findIndex(scheduleDay =>
      scheduleDay.dayName.toLowerCase().startsWith(normalizedDay.slice(0, 3)) ||
      scheduleDay.date === day
    );
    return foundIdx >= 0 ? foundIdx : selectedDayIdx;
  };

  const findPersonLocation = (daySchedule: SheetDaySchedule, person: string) => {
    const normalizedPerson = person.toLowerCase();
    return Object.keys(daySchedule.locations).find(locationId =>
      daySchedule.locations[locationId].some(assignment => assignment.person.toLowerCase() === normalizedPerson)
    );
  };

  const resolveLocationName = (location?: string) => {
    if (!location) return '';
    const normalizedLocation = location.toLowerCase();
    const loc = LOCATIONS.find(l =>
      l.id.toLowerCase() === normalizedLocation ||
      l.code.toLowerCase() === normalizedLocation
    );
    return loc?.id || location;
  };

  const persistDaySchedule = async (daySchedule: SheetDaySchedule) => {
    if (!user) return;
    const scheduleId = `${selectedWeek.id}_${daySchedule.dayName}`;
    await setDoc(doc(db, 'schedules', scheduleId), daySchedule);
  };

  const executeCommand = async () => {
    if (!commandInput.trim() || isProcessingCommand) return;
    
    setIsProcessingCommand(true);
    try {
      const result: ScheduleAction = parseLocalScheduleCommand(commandInput)
        || await processScheduleCommand(commandInput, schedule, doctors, technicians, technicianProfiles);
      
      if (result.action === 'UNKNOWN') {
        setError(`Could not interpret command: ${result.reasoning}`);
        return;
      }

      const targetDayIdx = getActionDayIndex(result.day);
      const newAllSchedules = allSchedules.map((day, idx) => idx === targetDayIdx ? cloneDaySchedule(day) : day);
      const newSchedule = newAllSchedules[targetDayIdx];
      let description = '';

      if (result.action === 'MOVE') {
        const fromLoc = resolveLocationName(result.fromLocation) || findPersonLocation(newSchedule, result.person);
        const toLoc = resolveLocationName(result.toLocation) || 'Floating';
        
        if (fromLoc && newSchedule.locations[fromLoc]) {
          const personIdx = newSchedule.locations[fromLoc].findIndex(a => a.person === result.person);
          if (personIdx === -1) {
            throw new Error(`Person ${result.person} not found in ${fromLoc}`);
          }
          const [assignment] = newSchedule.locations[fromLoc].splice(personIdx, 1);
          assignment.location = toLoc;
          if (!newSchedule.locations[toLoc]) newSchedule.locations[toLoc] = [];
          newSchedule.locations[toLoc].push(assignment);
          description = `Moved ${result.person} from ${fromLoc} to ${toLoc} on ${newSchedule.dayName}`;
        } else {
          throw new Error(`Person ${result.person} not found`);
        }
      } else if (result.action === 'ADD') {
        const toLoc = resolveLocationName(result.toLocation || result.fromLocation) || 'Floating';
        if (!newSchedule.locations[toLoc]) newSchedule.locations[toLoc] = [];
        const isDoctor = Boolean(doctors[result.person]);
        const defaultShift = isDoctor ? { startTime: '', endTime: '' } : getDefaultShift(result.person, newSchedule.dayName, toLoc);
        newSchedule.locations[toLoc].push({
          person: result.person,
          role: isDoctor ? 'Doctor' : 'Technician',
          startTime: result.startTime || defaultShift.startTime,
          endTime: result.endTime || defaultShift.endTime,
          location: toLoc,
          isDoctor,
          status: '',
        });
        description = `Added ${result.person} to ${toLoc} on ${newSchedule.dayName}`;
      } else if (result.action === 'REMOVE') {
        const fromLoc = resolveLocationName(result.fromLocation) || findPersonLocation(newSchedule, result.person);
        if (!fromLoc || !newSchedule.locations[fromLoc]) {
          throw new Error(`Person ${result.person} not found`);
        }
        const personIdx = newSchedule.locations[fromLoc].findIndex(a => a.person === result.person);
        if (personIdx === -1) {
          throw new Error(`Person ${result.person} not found in ${fromLoc}`);
        }
        newSchedule.locations[fromLoc].splice(personIdx, 1);
        description = `Removed ${result.person} from ${fromLoc} on ${newSchedule.dayName}`;
      } else if (result.action === 'UPDATE_TIME') {
        const loc = resolveLocationName(result.fromLocation) || findPersonLocation(newSchedule, result.person);
        if (loc) {
          const assignment = newSchedule.locations[loc].find(a => a.person === result.person);
          if (assignment) {
            if (result.startTime) assignment.startTime = result.startTime;
            if (result.endTime) assignment.endTime = result.endTime;
            description = `Updated times for ${result.person} in ${loc} on ${newSchedule.dayName}`;
          }
        }
        if (!description) throw new Error(`Person ${result.person} not found`);
      } else if (result.action === 'UPDATE_CONSTRAINT' && result.constraintUpdate) {
        const { type, id, updates } = result.constraintUpdate;
        if (type === 'DOCTOR') {
          await updateDoctorConstraint(id, updates);
          description = `Updated constraints for Doctor ${id}`;
        } else if (type === 'TECHNICIAN') {
          await updateTechConstraint(id, updates);
          description = `Updated constraints for Technician ${id}`;
        }
      }

      if (description) {
        if (result.action !== 'UPDATE_CONSTRAINT') {
          setAllSchedules(newAllSchedules);
          if (targetDayIdx === selectedDayIdx) setSchedule(newSchedule);
          await persistDaySchedule(newSchedule);
        }
        await addLog('AI_COMMAND', description, { command: commandInput, result });
        setCommandInput('');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to process AI command.');
    } finally {
      setIsProcessingCommand(false);
    }
  };

  // Dnd Handlers
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const [locId, dIdx, aIdx] = (active.id as string).split('|');
    const assignment = allSchedules[parseInt(dIdx)]?.locations[locId]?.[parseInt(aIdx)];
    if (!assignment) return;
    setActiveId(active.id as string);
    setActiveAssignment(assignment);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      const [fromLoc, fromDayIdx, fromAssIdx] = (active.id as string).split('|');
      const [toLoc, toDayIdx] = (over.id as string).split('|');
      
      if (fromDayIdx === toDayIdx) {
        const dIdx = parseInt(fromDayIdx);
        const aIdx = parseInt(fromAssIdx);
        const newAllSchedules = [...allSchedules];
        const daySchedule = cloneDaySchedule(newAllSchedules[dIdx]);
        
        if (!daySchedule.locations[fromLoc]?.[aIdx]) {
          setActiveId(null);
          setActiveAssignment(null);
          return;
        }

        const [assignment] = daySchedule.locations[fromLoc].splice(aIdx, 1);
        assignment.location = toLoc;
        if (!daySchedule.locations[toLoc]) daySchedule.locations[toLoc] = [];
        daySchedule.locations[toLoc].push(assignment);
        
        newAllSchedules[dIdx] = daySchedule;
        setAllSchedules(newAllSchedules);
        if (dIdx === selectedDayIdx) setSchedule(daySchedule);
        
        await persistDaySchedule(daySchedule);
        await addLog('DRAG_DROP', `Moved ${assignment.person} from ${fromLoc} to ${toLoc} on ${daySchedule.dayName}`);
      }
    }
    
    setActiveId(null);
    setActiveAssignment(null);
  };

  useEffect(() => {
    if (hasAccess && sheetUrl) {
      handleSync();
    }
  }, [hasAccess]);

  useEffect(() => {
    if (!user) return;
    
    const scheduleId = `${selectedWeek.id}_${schedule.dayName}`;
    const unsubscribe = onSnapshot(doc(db, 'schedules', scheduleId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as SheetDaySchedule;
        setSchedule(data);
      }
    }, (err) => {
      console.error(`Failed to load schedule ${scheduleId}:`, err);
    });
    
    return unsubscribe;
  }, [user, selectedWeek.id, schedule.dayName]);

  const handleSync = async () => {
    if (!hasAccess) return;

    if (!sheetUrl) {
      setShowSettings(true);
      return;
    }
    
    setIsSyncing(true);
    setError(null);
    try {
      const gid = weekGids[selectedWeek.id] || selectedWeek.gid;
      const data = await fetchSheetData(sheetUrl, gid);
      if (data.length > 0) {
        const datedData = data;
        setAllSchedules(datedData);
        // Auto-select today if possible
        const today = new Date().getDay(); // 0 is Sunday, 1 is Monday
        const dayIdx = today === 0 ? 0 : today - 1; // Map Sunday to Monday for now or just 0
        setSelectedDayIdx(Math.min(dayIdx, datedData.length - 1));
        setSchedule(datedData[Math.min(dayIdx, datedData.length - 1)]);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to sync with Google Sheet. Ensure it is published to the web as CSV.');
    } finally {
      setTimeout(() => setIsSyncing(false), 1000);
    }
  };

  useEffect(() => {
    if (allSchedules[selectedDayIdx]) {
      setSchedule(allSchedules[selectedDayIdx]);
    }
  }, [selectedDayIdx, allSchedules]);

  useEffect(() => {
    if (!hasAccess) return;
    handleSync();
  }, [hasAccess, selectedWeek]);

  const getStaffingStats = (locationId: string) => {
    const assignments = schedule.locations[locationId] || [];
    const doctors = assignments.filter(a => a.isDoctor).length;
    const techs = assignments.filter(a => !a.isDoctor).length;
    const ratio = doctors > 0 ? (techs / doctors).toFixed(1) : '0';
    const isHealthy = doctors === 0 || parseFloat(ratio) >= 3;
    return { doctors, techs, ratio, isHealthy };
  };

  const saveSettings = () => {
    localStorage.setItem('sheetUrl', sheetUrl);
    localStorage.setItem('weekGids', JSON.stringify(weekGids));
    setShowSettings(false);
    handleSync();
  };

  const updateAssignment = async (updated: SheetAssignment | null) => {
    if (!editingAssignment) return;
    
    const newSchedule = cloneDaySchedule(schedule);
    const locAssignments = [...(newSchedule.locations[editingAssignment.locationId] || [])];
    
    if (updated === null) {
      // Deleting
      locAssignments.splice(editingAssignment.index, 1);
    } else if (editingAssignment.index === -1) {
      // Adding new
      locAssignments.push(updated);
    } else {
      locAssignments[editingAssignment.index] = updated;
    }
    
    newSchedule.locations[editingAssignment.locationId] = locAssignments;
    
    try {
      const newAllSchedules = allSchedules.map((day, idx) => idx === selectedDayIdx ? newSchedule : day);
      setSchedule(newSchedule);
      setAllSchedules(newAllSchedules);
      await persistDaySchedule(newSchedule);
      await addLog(
        updated === null ? 'DELETE_ASSIGNMENT' : editingAssignment.index === -1 ? 'ADD_ASSIGNMENT' : 'UPDATE_ASSIGNMENT',
        `${updated === null ? 'Deleted' : editingAssignment.index === -1 ? 'Added' : 'Updated'} ${updated?.person || editingAssignment.assignment.person} on ${newSchedule.dayName}`,
        { locationId: editingAssignment.locationId, updated }
      );
      setEditingAssignment(null);
    } catch (err) {
      console.error(err);
      setError('Failed to save changes to database.');
    }
  };

  const addStaff = (locationId: string) => {
    const defaultShift = getDefaultShift('NEW', schedule.dayName, locationId);
    const newAssignment: SheetAssignment = {
      person: 'NEW',
      role: 'Technician',
      startTime: defaultShift.startTime,
      endTime: defaultShift.endTime,
      location: locationId,
      isDoctor: false,
      status: ''
    };
    setEditingAssignment({ assignment: newAssignment, locationId, index: -1 });
  };

  const jumpToToday = () => {
    const today = new Date().getDay();
    const dayIdx = today === 0 ? 0 : today - 1;
    setSelectedDayIdx(Math.min(dayIdx, allSchedules.length - 1));
  };

  const filteredAssignments = (locationId: string) => {
    const assignments = schedule.locations[locationId] || [];
    if (!searchQuery) return assignments;
    return assignments.filter(a => 
      a.person.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.status && a.status.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  };

  const getValidationIssues = (assignment: SheetAssignment, locationId: string) => {
    const issues: string[] = [];
    const loc = LOCATIONS.find(l => l.id === locationId);
    const locCode = loc?.code || '';
    const id = assignment.person;
    const dayName = schedule.dayName;

    if (assignment.isDoctor) {
      const doc = doctors[id];
      if (doc) {
        // Prohibited Locations
        if (doc.prohibitedLocations?.includes(locCode)) {
          issues.push(`${id} is prohibited from ${locationId}`);
        }
        // Fixed Schedule
        if (doc.fixedSchedule && (doc.fixedSchedule.day !== dayName || doc.fixedSchedule.location !== locCode)) {
          issues.push(`${id} fixed schedule is ${doc.fixedSchedule.day} in ${doc.fixedSchedule.location}`);
        }
        // Paired With
        if (doc.pairedWith) {
          const pairedTechs = doc.pairedWith;
          const currentStaff = (schedule.locations[locationId] || []).filter(a => !a.isDoctor);
          const currentTechsAndAliases = currentStaff.flatMap(a => {
            const t = technicians[a.person] || Object.values(technicians).find(tech => tech.aliases?.includes(a.person));
            return [a.person, ...(t?.aliases || [])];
          });
          const missing = pairedTechs.filter(p => !currentTechsAndAliases.includes(p));
          if (missing.length > 0) {
            issues.push(`Missing paired tech(s): ${missing.join(', ')}`);
          }
        }
      }
    } else {
      // Technician logic
      const tech = technicians[id] || Object.values(technicians).find(t => t.aliases?.includes(id));
      if (tech) {
        const currentDoctors = (schedule.locations[locationId] || []).filter(a => a.isDoctor).map(a => a.person);
        
        // Paired With
        if (tech.pairedWith) {
          const pairs = Array.isArray(tech.pairedWith) ? tech.pairedWith : [tech.pairedWith];
          const hasPair = pairs.some(p => currentDoctors.includes(p));
          if (!hasPair) {
            issues.push(`Should be paired with ${pairs.join(' or ')}`);
          }
        }

        // Conditional Pairing
        if (tech.conditionalPairing) {
          const condition = tech.conditionalPairing.find(c => c.day === dayName && c.location === locCode);
          if (condition && !currentDoctors.includes(condition.doctor)) {
            issues.push(`Should be with ${condition.doctor} on ${dayName} in ${locationId}`);
          }
        }

        // Soft Constraints
        if (tech.softConstraints) {
          tech.softConstraints.forEach(sc => {
            if (sc.type === 'avoid_doctor_location' && currentDoctors.includes(sc.doctor)) {
              issues.push(sc.message);
            }
          });
        }

        const preferenceRank = getPreferenceRank(id, locationId);
        if (preferenceRank && preferenceRank >= 4) {
          issues.push(`${locationId} is ${id}'s #${preferenceRank} office preference`);
        }
      }
    }
    return issues;
  };

  const isFullRefracting = (id: string) => {
    const canonicalId = canonicalizeTechnicianInitials(id);
    const tech = technicians[canonicalId];
    return tech?.fullRefracting || false;
  };

  const getRefractingNote = (id: string) => {
    const canonicalId = canonicalizeTechnicianInitials(id);
    const tech = technicians[canonicalId];
    return tech && !tech.fullRefracting ? tech.refractingNote || 'Does not refract yet' : '';
  };

  const selectedProfile = selectedTech ? technicianProfiles[selectedTech] : undefined;

  const getPreferenceRank = (techId: string, locationId: string) => {
    const profile = technicianProfiles[techId];
    const rank = profile?.officeRanking?.indexOf(locationId) ?? -1;
    return rank >= 0 ? rank + 1 : null;
  };

  const saveSelectedProfile = async (profile: TechnicianProfile) => {
    setTechnicianProfiles(current => ({ ...current, [profile.initials]: profile }));
    if (!user) return;
    try {
      await saveTechnicianProfile(profile);
      setTechnicianProfiles(current => ({ ...current, [profile.initials]: profile }));
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `technicianProfiles/${profile.initials}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="relative">
          <RefreshCw className="w-12 h-12 text-[var(--text)] animate-spin opacity-20" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-2 h-2 bg-[var(--text)] rounded-full animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-[#f0f2f7] flex flex-col items-center justify-center p-4 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(36,48,120,0.12)_0%,transparent_60%)]" />
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white border border-[#dce1eb] p-10 rounded-3xl text-center relative z-10 shadow-[0_24px_70px_rgba(36,48,120,0.14)]"
        >
          <div className="w-full flex justify-center mb-8">
            <img
              src={SPINDEL_LOGO_URL}
              alt="Spindel Eye Associates"
              className="h-16 w-auto max-w-full rounded-2xl bg-white object-contain shadow-lg"
            />
          </div>
          <h1 className="text-3xl font-bold text-[var(--text)] mb-3 tracking-tight">Spindel Eye Associates Scheduler</h1>
          <p className="text-[var(--text-muted)] mb-8 text-sm leading-relaxed">Choose the right workspace for today.</p>
          <a
            href={LIVE_SPREADSHEET_URL}
            target="_blank"
            rel="noreferrer"
            className="mb-6 inline-flex items-center justify-center gap-2 text-xs font-bold text-[#243078] hover:text-[#258c3b] transition-colors"
          >
            <LinkIcon className="w-3.5 h-3.5" />
            Live Spreadsheet
          </a>
          <div className="space-y-4">
            <button
              type="button"
              onClick={handleTechnicianLogin}
              className="w-full bg-[#243078] text-white font-bold py-4 rounded-full hover:bg-[#258c3b] transition-all active:scale-[0.98] flex items-center justify-center gap-3 shadow-lg"
            >
              <Users className="w-5 h-5" />
              Technician Login
            </button>
          </div>
          <form onSubmit={handlePasswordSubmit} className="space-y-4 mt-8 pt-8 border-t border-[#dce1eb]">
            <input
              type="password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              placeholder="Admin password"
              className="w-full border border-[#dce1eb] rounded-full px-5 py-4 text-[#243078] text-sm font-semibold outline-none focus:border-[#258c3b] focus:ring-4 focus:ring-[#258c3b]/10"
            />
            <button
              type="submit"
              className="w-full bg-[#258c3b] text-white font-bold py-4 rounded-full hover:bg-[#243078] transition-all active:scale-[0.98] flex items-center justify-center gap-3 shadow-lg"
            >
              <LayoutDashboard className="w-5 h-5" />
              Admin Login
            </button>
          </form>
          {authError && (
            <div className="mt-5 bg-red-500/10 border border-red-500/20 p-4 rounded-2xl text-left text-red-300 text-xs leading-relaxed">
              {authError}
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  const recentTechnicianRoster = {
    ...buildRecentTechnicianRoster(allSchedules, technicians, {
      today: currentTime,
      doctorIds: Object.keys(DOCTORS),
    }),
    ...Object.fromEntries(
      manualTechnicianIds
        .filter(initials => technicians[initials])
        .map(initials => [initials, technicians[initials]])
    ),
  };
  const allTechNames = Object.keys(recentTechnicianRoster).sort();
  const myDaySchedule = allSchedules[selectedDayIdx] || schedule;
  const myDaySummary = selectedTech ? getMyDaySummary(myDaySchedule, selectedTech) : null;
  const doctorImportPreview = doctorScheduleImport?.entries.slice(0, 4) || [];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans selection:bg-white/20">
      {/* Immersive Background */}
      <div className="fixed inset-0 pointer-events-none z-[-1] bg-[#e9edf5]" />
      
      {/* Navigation Rail */}
      <nav className="brand-nav fixed left-0 right-0 top-0 h-16 md:h-20 bg-[#243078] text-white flex items-center px-3 md:px-8 gap-2 md:gap-8 z-50 shadow-[0_6px_24px_rgba(36,48,120,0.18)]">
        <motion.div 
          whileHover={{ scale: 1.05 }}
          className="nav-logo-lockup hidden md:flex h-[4.2rem] w-[15.4rem] bg-white rounded-2xl items-center justify-center shadow-lg cursor-pointer shrink-0 px-1.5"
        >
          <img src={SPINDEL_LOGO_URL} alt="Spindel Eye Associates" className="max-h-[3.75rem] w-full object-contain" />
        </motion.div>
        
        <div className="flex-1 flex items-center gap-3">
          {isAdmin && (
            <button 
              onClick={() => setViewMode('admin')}
              aria-label="Schedule workspace"
              className={`p-2 md:p-3 rounded-full transition-all group relative ${viewMode === 'admin' ? 'text-[#243078] bg-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
            >
              <LayoutDashboard className="w-5 h-5 md:w-6 md:h-6" />
              <div className="hidden md:block absolute top-full mt-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-white text-[#243078] text-[0.6rem] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
                Schedule workspace
              </div>
            </button>
          )}

          <button 
            onClick={() => setViewMode('myday')}
            aria-label="My day"
            className={`p-2 md:p-3 rounded-full transition-all group relative ${viewMode === 'myday' ? 'text-[#243078] bg-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
          >
            <Clock className="w-5 h-5 md:w-6 md:h-6" />
            <div className="hidden md:block absolute top-full mt-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-white text-[#243078] text-[0.6rem] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
              My day
            </div>
          </button>

          <button 
            onClick={() => setViewMode('technician')}
            aria-label="My weekly schedule"
            className={`p-2 md:p-3 rounded-full transition-all group relative ${viewMode === 'technician' ? 'text-[#243078] bg-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
          >
            <Calendar className="w-5 h-5 md:w-6 md:h-6" />
            <div className="hidden md:block absolute top-full mt-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-white text-[#243078] text-[0.6rem] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
              My weekly schedule
            </div>
          </button>

          {isAdmin && (
            <button 
              onClick={() => setShowSettings(true)}
              aria-label="Settings"
              className="p-2 md:p-3 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all group relative"
            >
              <Settings className="w-5 h-5 md:w-6 md:h-6" />
              <div className="hidden md:block absolute top-full mt-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-white text-[#243078] text-[0.6rem] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
                Settings
              </div>
            </button>
          )}

          <button 
            onClick={() => setShowGemini(true)}
            aria-label="Schedule assistant"
              className={`p-2 md:p-3 rounded-full transition-all group relative ${showGemini ? 'text-[#243078] bg-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
          >
            <Sparkles className="w-5 h-5 md:w-6 md:h-6" />
            <div className="hidden md:block absolute top-full mt-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-white text-[#243078] text-[0.6rem] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
              Schedule assistant
            </div>
          </button>

          {isAdmin && (
            <button 
              onClick={() => setShowLogs(true)}
              aria-label="Change history"
              className={`p-2 md:p-3 rounded-full transition-all group relative ${showLogs ? 'text-[#243078] bg-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
            >
              <History className="w-5 h-5 md:w-6 md:h-6" />
              <div className="hidden md:block absolute top-full mt-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-white text-[#243078] text-[0.6rem] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
                Change history
              </div>
            </button>
          )}
        </div>

        <button 
          onClick={handleSignOut}
          aria-label="Sign out"
          className="p-2 md:p-3 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all"
        >
          <LogOut className="w-5 h-5 md:w-6 md:h-6" />
        </button>
      </nav>

      {/* Main Viewport */}
      <main className="brand-main pt-20 md:pt-28 px-4 md:px-8 pb-10 max-w-[2400px] mx-auto min-h-screen flex flex-col text-[#243078]">
        <header className="mobile-hero flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-6 bg-white border border-[#dce1eb] rounded-3xl p-7 shadow-[0_8px_24px_rgba(36,48,120,0.06)]">
          <div className="space-y-3">
            <img
              src={SPINDEL_LOGO_URL}
              alt="Spindel Eye Associates"
              className="h-12 w-auto max-w-full rounded-xl object-contain"
            />
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 bg-[var(--accent-muted)] text-[var(--accent)] text-[0.5rem] font-bold rounded border border-[var(--accent-muted)] tracking-widest uppercase">
                {viewMode === 'admin' ? 'Admin Access' : viewMode === 'myday' ? 'My Day' : 'Technician View'}
              </span>
              <span className="text-[0.65rem] text-[var(--text-muted)] tracking-[0.08em]">Thoughtful scheduling for every team</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight flex flex-wrap items-baseline gap-3 text-[#243078]">
              {viewMode === 'admin' ? 'Spindel Eye Associates Scheduler' : viewMode === 'myday' ? 'My Day' : 'My Weekly Schedule'}
              <span className="text-[#258c3b] text-xl font-medium">{selectedWeek.label}</span>
            </h1>
            <div className="flex items-center gap-4 text-[var(--text-muted)] font-mono text-xs">
              <button
                onClick={() => window.open(LIVE_SPREADSHEET_URL, '_blank')}
                className="flex items-center gap-2 hover:text-[var(--text)] transition-colors"
              >
                <LinkIcon className="w-3 h-3" /> Live Spreadsheet
              </button>
              <span className="w-1 h-1 bg-[var(--border)] rounded-full" />
              <span className="flex items-center gap-2 tracking-widest">{currentTime.toLocaleTimeString([], { hour12: false })}</span>
            </div>
          </div>
          
          <div className="mobile-controls flex flex-col items-end gap-6 w-full md:w-auto">
            <div className="flex flex-wrap items-center gap-3 md:gap-4 w-full md:w-auto">
              {viewMode === 'technician' || viewMode === 'myday' ? (
                <div className="relative flex-1 md:w-64">
                  <select 
                    value={selectedTech}
                    onChange={(e) => setSelectedTech(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-4 pr-10 text-xs font-mono focus:outline-none focus:border-white/30 transition-all appearance-none"
                  >
                    <option value="" className="bg-white">Select your name...</option>
                    {allTechNames.map(t => (
                      <option key={t} value={t} className="bg-white">{t}</option>
                    ))}
                  </select>
                  <Users className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 pointer-events-none" />
                </div>
              ) : (
                <div className="relative flex-1 md:w-64">
                  <input 
                    type="text"
                    placeholder="SEARCH_STAFF..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-4 pr-10 text-xs font-mono focus:outline-none focus:border-white/30 transition-all"
                  />
                  <Users className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                </div>
              )}

              {(viewMode === 'technician' || viewMode === 'myday') && selectedTech && (
                <button onClick={() => setShowTechProfile(true)} className="flex items-center gap-2 px-4 py-2.5 bg-pink-500/10 text-pink-300 border border-pink-500/20 rounded-xl text-[0.6rem] font-black tracking-widest hover:bg-pink-500/20 transition-all">
                  <Heart className="w-3.5 h-3.5" /> My preferences
                </button>
              )}
              
              <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 shadow-inner">
                <select 
                  value={selectedWeek.id}
                  onChange={(e) => {
                    const week = WEEKS.find(w => w.id === e.target.value);
                    if (week) setSelectedWeek(week);
                  }}
                  className="bg-transparent text-[0.6rem] font-bold px-3 py-1 focus:outline-none"
                >
                  {WEEKS.map(w => (
                    <option key={w.id} value={w.id} className="bg-white">{w.label}</option>
                  ))}
                </select>
              </div>

              <button 
                onClick={handleSync}
                disabled={isSyncing}
                className="brand-primary group flex items-center gap-3 px-6 py-2.5 rounded-full text-sm font-bold transition-all hover:brightness-90 active:scale-[0.98] disabled:opacity-50 shadow-md"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                {isSyncing ? 'Syncing schedule…' : 'Sync schedule'}
              </button>
            </div>
          </div>
        </header>

        <section className="mb-8 bg-white border border-[#dce1eb] rounded-2xl p-5 shadow-sm">
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-6">
            <form onSubmit={handleScheduleRequestSubmit} className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#243078]/10 text-[#243078] flex items-center justify-center">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-[#243078]">Schedule change request</h2>
                    <p className="text-xs text-[#667085]">Requests save on this preview and stay visible below.</p>
                  </div>
                </div>
                <span className="text-[0.65rem] font-bold text-[#667085] uppercase tracking-widest">
                  {allSchedules[selectedDayIdx]?.dayName || schedule.dayName}
                </span>
              </div>

              <div className="flex flex-col md:flex-row gap-3">
                <input
                  value={scheduleRequestText}
                  onChange={(event) => setScheduleRequestText(event.target.value)}
                  placeholder="Example: move LT later on Wednesday"
                  className="flex-1 border border-[#dce1eb] rounded-xl px-4 py-3 text-sm text-[#243078] outline-none focus:border-[#258c3b] focus:ring-4 focus:ring-[#258c3b]/10"
                />
                <button
                  type="submit"
                  className="brand-primary px-5 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
                >
                  <MessageSquare className="w-4 h-4" />
                  Submit
                </button>
              </div>

              {scheduleRequests.length > 0 && (
                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {scheduleRequests.slice(0, 4).map(request => (
                    <div key={request.id} className="flex items-start gap-3 rounded-xl border border-[#dce1eb] bg-[#f7f8fb] p-3">
                      <div className={`mt-0.5 w-2 h-2 rounded-full ${request.status === 'open' ? 'bg-[#258c3b]' : 'bg-[#98a2b3]'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[0.65rem] font-bold text-[#667085] uppercase tracking-widest">
                          <span>{request.requester}</span>
                          <span>{request.dayName}</span>
                          <span>{request.status}</span>
                        </div>
                        <p className="text-sm text-[#243078] mt-1 break-words">{request.details}</p>
                      </div>
                      {isAdmin && request.status === 'open' && (
                        <button
                          type="button"
                          onClick={() => handleResolveScheduleRequest(request.id)}
                          className="p-2 rounded-lg text-[#258c3b] hover:bg-green-50"
                          aria-label="Mark request done"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </form>

            {isAdmin && (
              <div className="space-y-4">
                <form onSubmit={handleAddTechnician} className="grid grid-cols-1 md:grid-cols-[120px_170px_1fr_auto] gap-3">
                  <input
                    value={newTechInitials}
                    onChange={(event) => setNewTechInitials(event.target.value)}
                    placeholder="Initials"
                    className="border border-[#dce1eb] rounded-xl px-4 py-3 text-sm font-bold uppercase text-[#243078] outline-none focus:border-[#258c3b] focus:ring-4 focus:ring-[#258c3b]/10"
                  />
                  <label className="flex items-center gap-3 border border-[#dce1eb] rounded-xl px-4 py-3 text-xs font-bold text-[#243078]">
                    <input
                      type="checkbox"
                      checked={newTechCanRefract}
                      onChange={(event) => setNewTechCanRefract(event.target.checked)}
                      className="h-4 w-4 accent-[#258c3b]"
                    />
                    Can refract
                  </label>
                  <input
                    value={newTechNote}
                    onChange={(event) => setNewTechNote(event.target.value)}
                    placeholder="Note if they do not refract yet"
                    disabled={newTechCanRefract}
                    className="border border-[#dce1eb] rounded-xl px-4 py-3 text-sm text-[#243078] outline-none focus:border-[#258c3b] focus:ring-4 focus:ring-[#258c3b]/10 disabled:bg-[#f2f4f7] disabled:text-[#98a2b3]"
                  />
                  <button type="submit" className="brand-primary px-5 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                    <UserPlus className="w-4 h-4" />
                    Save
                  </button>
                </form>

                <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto pr-1">
                  {Object.entries(recentTechnicianRoster).sort(([a], [b]) => a.localeCompare(b)).map(([initials, tech]) => (
                    <div key={initials} className="flex items-center gap-2 rounded-xl border border-[#dce1eb] bg-[#f7f8fb] px-3 py-2">
                      <span className="text-sm font-bold text-[#243078]">{initials}</span>
                      {!tech.fullRefracting && (
                        <span className="text-[0.6rem] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          {tech.refractingNote || 'Does not refract yet'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveTechnician(initials)}
                        className="p-1.5 rounded-lg text-[#667085] hover:text-red-600 hover:bg-red-50"
                        aria-label={`Remove ${initials}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-[#dce1eb] bg-[#f7f8fb] p-4 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-[#243078]">Doctor Schedule Automation</h3>
                      <p className="text-xs text-[#667085] mt-1">Upload the doctor schedule CSV, confirm the preview, then apply it to this week.</p>
                    </div>
                    <label className="brand-primary cursor-pointer px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2">
                      <Upload className="w-4 h-4" />
                      Upload CSV
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={handleDoctorScheduleUpload}
                        className="sr-only"
                      />
                    </label>
                  </div>

                  {doctorImportMessage && (
                    <div className="text-xs font-semibold text-[#243078] bg-white border border-[#dce1eb] rounded-xl px-3 py-2">
                      {doctorImportMessage}
                    </div>
                  )}

                  {doctorScheduleImport?.warnings.length ? (
                    <div className="space-y-1">
                      {doctorScheduleImport.warnings.slice(0, 3).map(warning => (
                        <div key={warning} className="flex items-start gap-2 text-xs text-amber-700">
                          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {doctorImportPreview.length > 0 && (
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {doctorImportPreview.map(entry => {
                        const doctorCount = Object.values(entry.locations).reduce((sum, assignments) => sum + assignments.length, 0);
                        const summary = Object.entries(entry.locations)
                          .filter(([, assignments]) => assignments.length > 0)
                          .map(([location, assignments]) => `${location}: ${assignments.map(assignment => assignment.status ? `${assignment.person}(${assignment.status})` : assignment.person).join(' ')}`)
                          .join(' • ');

                        return (
                          <div key={`${entry.date}-${entry.dayName}`} className="bg-white border border-[#dce1eb] rounded-xl p-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-black text-[#243078]">{entry.dayName || 'Schedule day'} {entry.date}</span>
                              <span className="text-[0.6rem] font-black text-[#258c3b] uppercase tracking-widest">{doctorCount} doctors</span>
                            </div>
                            <p className="mt-1 text-xs text-[#667085] break-words">{summary || 'No doctors listed for office coverage.'}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={applyDoctorScheduleImport}
                    disabled={!doctorScheduleImport?.entries.length}
                    className="w-full bg-[#243078] text-white px-4 py-3 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#258c3b] transition-colors"
                  >
                    Apply Doctors To Main Schedule
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {viewMode === 'myday' ? (
          <div className="flex-1 space-y-6">
            <div className="mobile-myday-picker flex flex-wrap gap-2">
              {allSchedules.map((day, dIdx) => (
                <button
                  key={`${day.dayName}-${day.date}`}
                  type="button"
                  onClick={() => setSelectedDayIdx(dIdx)}
                  className={`px-4 py-3 rounded-2xl border text-left transition-all ${selectedDayIdx === dIdx ? 'my-day-date-tab-active bg-[#243078] border-[#243078] text-white shadow-md' : 'bg-white border-[#dce1eb] text-[#243078] hover:border-[#258c3b]'}`}
                >
                  <div className="text-[0.55rem] font-black uppercase tracking-widest opacity-75">{day.dayName}</div>
                  <div className="text-sm font-bold">{day.date}</div>
                </button>
              ))}
            </div>

            {!selectedTech ? (
              <div className="bg-white border border-[#dce1eb] rounded-3xl p-10 text-center shadow-sm">
                <div className="w-16 h-16 bg-[#243078]/10 rounded-full flex items-center justify-center mx-auto mb-5">
                  <Clock className="w-7 h-7 text-[#243078]" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-[#243078]">Choose your initials</h2>
                <p className="mt-2 text-sm text-[#667085]">Select your name above to see where you work, your hours, and your team.</p>
              </div>
            ) : myDaySummary ? (
              (() => {
                const office = OFFICE_LOCATIONS.find(item => item.id === myDaySummary.locationId);
                return (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6"
                  >
                    <section className="bg-white border border-[#dce1eb] rounded-3xl p-7 md:p-9 shadow-[0_8px_24px_rgba(36,48,120,0.06)]">
                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5">
                        <div>
                          <div className="flex items-center gap-2 text-[0.6rem] font-black uppercase tracking-widest text-[#667085]">
                            <Calendar className="w-3.5 h-3.5" />
                            {myDaySummary.day.dayName} {myDaySummary.day.date}
                          </div>
                          <h2 className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight text-[#243078]">{myDaySummary.locationId}</h2>
                          <div className="mt-4 flex flex-wrap gap-3">
                            <span className="inline-flex items-center gap-2 rounded-full bg-[#258c3b]/10 px-4 py-2 text-sm font-bold text-[#258c3b]">
                              <Clock className="w-4 h-4" />
                              {myDaySummary.hours}
                            </span>
                            {office && (
                              <span className="inline-flex items-center gap-2 rounded-full bg-[#243078]/10 px-4 py-2 text-sm font-bold text-[#243078]">
                                <MapPin className="w-4 h-4" />
                                {selectedProfile?.commuteMiles?.[office.id] ? `${selectedProfile.commuteMiles[office.id]} mi each way` : 'Commute not set'}
                              </span>
                            )}
                          </div>
                        </div>
                        {office && (
                          <a
                            target="_blank"
                            rel="noreferrer"
                            href={googleMapsDirectionsUrl(office.mapQuery, selectedProfile?.homeAddress)}
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#243078] px-5 py-3 text-sm font-bold text-white hover:bg-[#258c3b] transition-all"
                          >
                            <Navigation className="w-4 h-4" />
                            Directions
                          </a>
                        )}
                      </div>

                      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-2xl border border-[#dce1eb] bg-[#f8fafc] p-5">
                          <div className="text-[0.6rem] font-black uppercase tracking-widest text-[#667085]">Doctors</div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {myDaySummary.doctors.length ? myDaySummary.doctors.map(person => (
                              <span key={`${person.person}-${person.startTime}`} className={`px-3 py-2 rounded-xl text-sm font-black ${person.person === 'JC' ? 'bg-white border border-red-500 text-red-600' : 'my-day-doctor-badge'}`}>
                                {person.person}
                              </span>
                            )) : (
                              <span className="text-sm text-[#667085]">No doctors listed yet.</span>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-[#dce1eb] bg-[#f8fafc] p-5">
                          <div className="text-[0.6rem] font-black uppercase tracking-widest text-[#667085]">Technicians With You</div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {myDaySummary.technicians.length ? myDaySummary.technicians.map(person => (
                              <span key={`${person.person}-${person.startTime}`} className="px-3 py-2 rounded-xl bg-white border border-[#dce1eb] text-sm font-black text-black">
                                {canonicalizeTechnicianInitials(person.person)}
                              </span>
                            )) : (
                              <span className="text-sm text-[#667085]">No other technicians listed at this office.</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {(myDaySummary.assignment.status || myDaySummary.day.notes) && (
                        <div className="mt-5 rounded-2xl border border-[#dce1eb] bg-[#fffdf5] p-5">
                          <div className="text-[0.6rem] font-black uppercase tracking-widest text-[#667085]">Notes</div>
                          {myDaySummary.assignment.status && <p className="mt-3 text-sm font-semibold text-[#243078]">{myDaySummary.assignment.status}</p>}
                          {myDaySummary.day.notes && <p className="mt-2 text-sm text-[#667085]">{myDaySummary.day.notes}</p>}
                        </div>
                      )}
                    </section>

                    <aside className="bg-white border border-[#dce1eb] rounded-3xl p-7 shadow-sm space-y-5">
                      <div>
                        <div className="text-[0.6rem] font-black uppercase tracking-widest text-[#667085]">Your Setup</div>
                        <h3 className="mt-2 text-2xl font-bold text-[#243078]">{selectedTech}</h3>
                        <p className="mt-2 text-sm text-[#667085]">Home location and favorite office ranking help admin make better changes.</p>
                      </div>
                      <button onClick={() => setShowTechProfile(true)} className="w-full flex items-center justify-center gap-2 rounded-full bg-pink-500/10 px-5 py-3 text-sm font-bold text-pink-700 hover:bg-pink-500/20 transition-all">
                        <Heart className="w-4 h-4" />
                        Edit preferences
                      </button>
                      <button onClick={() => setViewMode('technician')} className="w-full flex items-center justify-center gap-2 rounded-full bg-[#243078]/10 px-5 py-3 text-sm font-bold text-[#243078] hover:bg-[#243078]/15 transition-all">
                        <Calendar className="w-4 h-4" />
                        Weekly schedule
                      </button>
                    </aside>
                  </motion.div>
                );
              })()
            ) : (
              <div className="bg-white border border-[#dce1eb] rounded-3xl p-10 text-center shadow-sm">
                <div className="w-16 h-16 bg-[#243078]/10 rounded-full flex items-center justify-center mx-auto mb-5">
                  <MapPin className="w-7 h-7 text-[#243078]" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-[#243078]">No shift listed</h2>
                <p className="mt-2 text-sm text-[#667085]">{selectedTech} is not scheduled on {myDaySchedule.dayName} {myDaySchedule.date}.</p>
                <button onClick={() => setViewMode('technician')} className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#243078] px-5 py-3 text-sm font-bold text-white hover:bg-[#258c3b] transition-all">
                  <Calendar className="w-4 h-4" />
                  Check the week
                </button>
              </div>
            )}
          </div>
        ) : viewMode === 'technician' ? (
          <div className="flex-1">
            {!selectedTech ? (
              <div className="flex flex-col items-center justify-center py-32 text-center space-y-6">
                <div className="w-20 h-20 bg-white/5 rounded-[2.5rem] flex items-center justify-center border border-white/10">
                  <Users className="w-8 h-8 text-white/20" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-bold tracking-tight">Identify Yourself</h2>
                  <p className="text-sm text-white/30 font-mono">Select your name from the dropdown above to view your weekly schedule.</p>
                </div>
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="p-5 bg-pink-500/[.06] border border-pink-500/15 rounded-2xl">
                    <div className="text-[0.55rem] text-pink-300/60 uppercase tracking-widest font-black">Preference fit</div>
                    <div className="text-2xl font-bold mt-2">{(() => {
                      const ranks = allSchedules.flatMap(day => Object.entries(day.locations).flatMap(([location, assignments]) => (assignments as SheetAssignment[]).some(a => !a.isDoctor && canonicalizeTechnicianInitials(a.person) === selectedTech) && OFFICE_LOCATIONS.some(o => o.id === location) ? [getPreferenceRank(selectedTech, location)] : [])).filter((rank): rank is number => rank !== null);
                      return ranks.length ? `${Math.round(ranks.reduce((sum, rank) => sum + (6 - rank) * 20, 0) / ranks.length)}%` : '--';
                    })()}</div>
                    <div className="text-[0.6rem] text-white/30 mt-1">Based on your office ranking</div>
                  </div>
                  <div className="p-5 bg-white/[.03] border border-white/10 rounded-2xl">
                    <div className="text-[0.55rem] text-white/30 uppercase tracking-widest font-black">Weekly round trip</div>
                    <div className="text-2xl font-bold mt-2">{(() => {
                      const oneWay = allSchedules.reduce((total, day) => {
                        const office = Object.entries(day.locations).find(([, assignments]) => (assignments as SheetAssignment[]).some(a => !a.isDoctor && canonicalizeTechnicianInitials(a.person) === selectedTech))?.[0];
                        return total + (office ? (selectedProfile?.commuteMiles?.[office] || 0) : 0);
                      }, 0);
                      return oneWay ? `${(oneWay * 2).toFixed(1)} mi` : '--';
                    })()}</div>
                    <div className="text-[0.6rem] text-white/30 mt-1">Estimated from saved drives</div>
                  </div>
                  <button onClick={() => setShowTechProfile(true)} className="p-5 text-left bg-white/[.03] border border-white/10 rounded-2xl hover:bg-white/[.06] transition-all">
                    <div className="flex justify-between"><div className="text-[0.55rem] text-white/30 uppercase tracking-widest font-black">Favorite office</div><Heart className="w-4 h-4 text-pink-400" /></div>
                    <div className="text-2xl font-bold mt-2">{selectedProfile?.officeRanking?.[0] || 'Set yours'}</div>
                    <div className="text-[0.6rem] text-white/30 mt-1">Open your happy schedule profile</div>
                  </button>
                </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
                {allSchedules.map((day, dIdx) => {
                  // Find tech in any location for this day
                  let techAssignment: SheetAssignment | null = null;
                  let techLoc = '';
                  
                  Object.entries(day.locations).forEach(([locId, assignments]) => {
                    const found = (assignments as SheetAssignment[]).find(a => canonicalizeTechnicianInitials(a.person) === selectedTech);
                    if (found) {
                      techAssignment = found;
                      techLoc = locId;
                    }
                  });

                  return (
                    <motion.div 
                      key={dIdx}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: dIdx * 0.05 }}
                      className={`bg-white/[0.02] backdrop-blur-3xl border border-white/5 rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden ${techAssignment ? 'ring-1 ring-white/10' : 'opacity-40'}`}
                    >
                      <div className="flex justify-between items-start mb-8">
                        <div>
                          <span className="text-[0.5rem] font-black uppercase tracking-[0.3em] text-white/20 block mb-1">{day.dayName}</span>
                          <h3 className="text-2xl font-mono font-bold tracking-tighter">{day.date}</h3>
                        </div>
                        {techAssignment && (
                          <div 
                            className="px-3 py-1 rounded-full text-[0.5rem] font-black uppercase tracking-widest"
                            style={{ backgroundColor: `${LOCATIONS.find(l => l.id === techLoc)?.color}20`, color: LOCATIONS.find(l => l.id === techLoc)?.color, border: `1px solid ${LOCATIONS.find(l => l.id === techLoc)?.color}40` }}
                          >
                            {techLoc}
                          </div>
                        )}
                      </div>

                      {techAssignment ? (
                        <div className="space-y-6">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10">
                              <Calendar className="w-5 h-5 text-white/40" />
                            </div>
                            <div>
                              <div className="text-[0.5rem] font-black uppercase tracking-widest text-white/20 mb-0.5 flex items-center gap-2">
                                Shift Time
                                {isFullRefracting(techAssignment.person) && (
                                  <span className="flex items-center gap-1 text-[0.4rem] text-emerald-400/60 font-black tracking-widest">
                                    <div className="w-1 h-1 rounded-full bg-emerald-400" />
                                    FULL_REFRACTING
                                  </span>
                                )}
                              </div>
                              <div className="text-lg font-mono font-bold tracking-tight">
                                {techAssignment.startTime || '--'} <span className="text-white/20 mx-1">→</span> {techAssignment.endTime || '--'}
                              </div>
                            </div>
                          </div>

                          {OFFICE_LOCATIONS.some(office => office.id === techLoc) && (
                            <div className="p-4 bg-white/[.03] border border-white/10 rounded-2xl space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2 text-[0.5rem] font-black uppercase tracking-widest text-white/30"><MapPin className="w-3 h-3" /> Commute</span>
                                {getPreferenceRank(selectedTech, techLoc) && <span className="text-[0.55rem] font-bold text-pink-300">#{getPreferenceRank(selectedTech, techLoc)} choice</span>}
                              </div>
                              <div className="font-mono font-bold">{selectedProfile?.commuteMiles?.[techLoc] ? `${selectedProfile.commuteMiles[techLoc]} mi each way` : 'Distance not set'}</div>
                              <a target="_blank" rel="noreferrer" href={googleMapsDirectionsUrl(OFFICE_LOCATIONS.find(office => office.id === techLoc)?.mapQuery || `${techLoc}, NH`, selectedProfile?.homeAddress)} className="flex items-center gap-2 text-[0.55rem] font-black text-blue-300 hover:text-blue-200"><Navigation className="w-3 h-3" /> OPEN DIRECTIONS</a>
                            </div>
                          )}

                          {techAssignment.status && (
                            <div className="p-4 bg-white/5 border border-white/10 rounded-2xl">
                              <div className="text-[0.5rem] font-black uppercase tracking-widest text-white/20 mb-2">Status / Notes</div>
                              <div className="text-xs font-mono text-white/60">{techAssignment.status}</div>
                            </div>
                          )}

                          {day.notes && (
                            <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl">
                              <div className="text-[0.5rem] font-black uppercase tracking-widest text-emerald-500/40 mb-2">Clinic Notes</div>
                              <div className="text-[0.65rem] font-mono text-emerald-500/60 leading-relaxed">{day.notes}</div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <div className="text-[0.5rem] font-black uppercase tracking-widest text-white/10">Not Scheduled</div>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {error && (
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="mb-10 bg-red-500/10 border border-red-500/20 p-5 rounded-2xl flex items-center gap-4 text-red-400 text-sm backdrop-blur-xl"
              >
                <AlertCircle className="w-6 h-6" />
                <div className="flex-1">
                  <p className="font-bold uppercase text-[0.6rem] tracking-widest mb-1">Sync Error</p>
                  <p className="opacity-80">{error}</p>
                </div>
                <button onClick={() => setError(null)} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* Weekly Matrix Grid */}
            {isAdmin && (
              <div className="mobile-command mb-8 flex items-center gap-4 bg-white border border-[#dce1eb] p-4 rounded-2xl shadow-sm">
                <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center border border-emerald-500/30">
                  <Terminal className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="flex-1 relative">
                  <input 
                    type="text"
                    value={commandInput}
                    onChange={(e) => setCommandInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && executeCommand()}
                    placeholder="Ask for a schedule change, e.g. “Move LT to Windham on Monday”"
                    className="w-full bg-transparent border-none text-xs font-mono focus:outline-none placeholder:text-white/10"
                    disabled={isProcessingCommand}
                  />
                  {isProcessingCommand && (
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      <RefreshCw className="w-3 h-3 text-emerald-400 animate-spin" />
                      <span className="text-[0.5rem] font-mono text-emerald-400 uppercase tracking-widest animate-pulse">Processing...</span>
                    </div>
                  )}
                </div>
                <button 
                  onClick={executeCommand}
                  disabled={!commandInput.trim() || isProcessingCommand}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[0.6rem] font-black uppercase tracking-widest transition-all disabled:opacity-30"
                >
                  Review change
                </button>
              </div>
            )}
            
            <DndContext 
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              {/* Mobile day-focused schedule */}
              <div className="md:hidden space-y-5">
                <div className="mobile-day-picker flex gap-2 overflow-x-auto pb-2 snap-x">
                  {allSchedules.map((day, index) => (
                    <button
                      key={`${day.dayName}-${index}`}
                      onClick={() => setSelectedDayIdx(index)}
                      className={`snap-start shrink-0 px-4 py-3 rounded-2xl border text-left transition-all ${selectedDayIdx === index ? 'brand-primary border-[#258c3b] shadow-md' : 'bg-white border-[#dce1eb] text-[#243078]'}`}
                    >
                      <span className="block text-xs font-bold">{day.dayName}</span>
                      <span className={`block text-[0.65rem] mt-0.5 ${selectedDayIdx === index ? 'text-white/80' : 'text-[#667085]'}`}>{day.date}</span>
                    </button>
                  ))}
                </div>

                {(() => {
                  const mobileDay = allSchedules[selectedDayIdx];
                  if (!mobileDay) return null;
                  return (
                    <div className="space-y-4">
                      <div className="mobile-day-heading flex items-end justify-between px-1">
                        <div>
                          <p className="text-xs text-[#667085]">Daily schedule</p>
                          <h2 className="text-2xl font-semibold text-[#243078]">{mobileDay.dayName}, {mobileDay.date}</h2>
                        </div>
                        <span className="text-xs text-[#667085]">Tap a name to edit</span>
                      </div>

                      {LOCATIONS.map(loc => {
                        const mobileAssignments = mobileDay.locations[loc.id] || [];
                        if (mobileAssignments.length === 0 && loc.targetTechs === 0) return null;
                        const mobileDoctors = mobileAssignments.filter(item => item.isDoctor);
                        const mobileTechs = mobileAssignments.filter(item => !item.isDoctor);
                        const shortage = Math.max(0, loc.targetTechs - mobileTechs.length);
                        const suggestion = shortage > 0 ? rankMoveCandidates(mobileDay, loc.id, technicianProfiles)[0] : undefined;

                        return (
                          <section key={loc.id} className="schedule-card rounded-2xl p-4">
                            <div className="flex items-center justify-between gap-3 mb-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: `${loc.color}20`, color: loc.color }}>{loc.code}</div>
                                <div>
                                  <h3 className="font-semibold text-[#243078]">{loc.id}</h3>
                                  <p className="text-xs text-[#667085]">{mobileDoctors.length} doctor{mobileDoctors.length === 1 ? '' : 's'} · {mobileTechs.length} technician{mobileTechs.length === 1 ? '' : 's'}</p>
                                </div>
                              </div>
                              {shortage > 0 ? <span className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-xs font-bold">Needs {shortage}</span> : loc.targetTechs > 0 ? <span className="px-2.5 py-1 bg-green-50 text-[#258c3b] border border-green-200 rounded-full text-xs font-bold">Covered</span> : null}
                            </div>

                            {mobileAssignments.length > 0 ? (
                              <div className="mobile-assignment-grid grid grid-cols-2 gap-2">
                                {mobileAssignments.map((assignment, assignmentIndex) => (
                                  <button
                                    key={`${assignment.person}-${assignmentIndex}`}
                                    onClick={() => setEditingAssignment({ assignment, locationId: loc.id, index: assignmentIndex })}
                                    className={`min-h-12 px-3 py-2 rounded-xl border text-left ${assignment.isDoctor ? assignment.person === 'JC' ? 'bg-white text-red-600 border-red-500' : 'brand-doctor border-[#243078]' : 'bg-[#f7f8fb] text-[#3f3f3f] border-[#dce1eb]'}`}
                                  >
                                    <span className="block font-bold text-sm">{assignment.person}</span>
                                    <span className={`block text-[0.65rem] mt-0.5 ${assignment.isDoctor ? 'text-white/70' : 'text-[#667085]'}`}>{assignment.isDoctor ? 'Doctor' : `${assignment.startTime || '--'} – ${assignment.endTime || '--'}`}</span>
                                  </button>
                                ))}
                              </div>
                            ) : <p className="text-sm text-[#667085] py-2">No one assigned yet.</p>}

                            {suggestion && (
                              <button onClick={() => setCommandInput(`Move ${suggestion.technician} from ${suggestion.fromLocation} to ${loc.id} on ${mobileDay.dayName}`)} className="mt-4 w-full flex items-center justify-between gap-3 p-3 bg-green-50 border border-green-200 rounded-xl text-left">
                                <div><span className="block text-[0.65rem] font-bold text-[#258c3b]">Suggested coverage</span><span className="block text-sm font-medium text-[#243078]">{suggestion.technician} from {suggestion.fromLocation}</span></div>
                                <ArrowRight className="w-4 h-4 text-[#258c3b] shrink-0" />
                              </button>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              <div className="hidden md:block flex-1 overflow-x-auto pb-8">
                <div className="min-w-[1600px] flex flex-col gap-6">
            {/* Days Header */}
            <div className="grid grid-cols-[180px_repeat(6,1fr)] gap-4 sticky top-20 z-20 bg-[#f0f2f7]/95 backdrop-blur-xl py-4 border-b border-[#dce1eb]">
              <div className="flex items-center justify-center">
                <span className="text-[0.6rem] font-black uppercase tracking-[0.4em] text-white/20">Locations</span>
              </div>
              {['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].map((day, i) => (
                <div key={day} className="flex flex-col items-center justify-center gap-1">
                  <span className={`text-xs font-black tracking-widest ${selectedDayIdx === i ? 'text-white' : 'text-white/40'}`}>
                    {day}
                  </span>
                  <span className="text-[0.5rem] font-mono text-white/20">
                    {allSchedules[i]?.date || '--/--'}
                  </span>
                </div>
              ))}
            </div>

            {/* Locations Rows */}
            <div className="space-y-4">
              {LOCATIONS.map((loc, lIdx) => {
                const hasAssignmentsAnywhere = allSchedules.some(day => (day.locations[loc.id] || []).length > 0);
                if (loc.id === 'Floating' && !hasAssignmentsAnywhere) return null;

                return (
                  <div key={loc.id} className="grid grid-cols-[180px_repeat(6,1fr)] gap-4 min-h-[120px]">
                    {/* Location Label */}
                    <div className="schedule-card flex flex-col items-center justify-center rounded-2xl p-4 gap-3">
                    <div 
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black shadow-lg"
                      style={{ backgroundColor: loc.color, color: '#000' }}
                    >
                      {loc.code || loc.id[0]}
                    </div>
                    <div className="text-center">
                      <h3 className="text-[0.7rem] font-bold tracking-tight">{loc.id.toUpperCase()}</h3>
                      {viewMode === 'admin' && (
                        <button 
                          onClick={() => addStaff(loc.id)}
                          className="mt-2 text-[0.5rem] font-black text-white/20 hover:text-white transition-colors uppercase tracking-widest"
                        >
                          + ADD_STAFF
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Day Cells */}
                  {Array.from({ length: 6 }).map((_, dIdx) => {
                    const daySchedule = allSchedules[dIdx];
                    const assignments = daySchedule?.locations[loc.id] || [];
                    const cellId = `${loc.id}|${dIdx}`;
                    
                    if (loc.id === 'Floating') {
                      // Calculate overstaffed locations
                      const overstaffed = LOCATIONS
                        .filter(l => l.id !== 'Floating' && l.targetTechs > 0)
                        .map(l => {
                          const lAssignments = daySchedule?.locations[l.id] || [];
                          const techCount = lAssignments.filter(a => !a.isDoctor).length;
                          const surplus = techCount - l.targetTechs;
                          return { ...l, surplus };
                        })
                        .filter(l => l.surplus > 0);

                      const activeFloating = assignments.filter(a => {
                        const status = a.status?.toUpperCase();
                        return status !== 'OUT' && status !== 'VF' && status !== 'BIO';
                      });

                      return (
                        <DroppableLocation 
                          key={cellId}
                          id={cellId}
                          className={`schedule-card rounded-2xl p-3 flex flex-col gap-3 transition-all hover:-translate-y-0.5 ${overstaffed.length === 0 && activeFloating.length === 0 ? 'opacity-50' : ''}`}
                        >
                          {overstaffed.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-[0.5rem] font-black text-emerald-400 uppercase tracking-widest mb-1">Available to Borrow</div>
                              <div className="flex flex-wrap gap-1.5">
                                {overstaffed.map(l => (
                                  <div 
                                    key={l.id}
                                    className="px-2 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-lg flex items-center gap-2"
                                  >
                                    <span className="text-[0.6rem] font-bold text-emerald-400">{l.id}</span>
                                    <span className="px-1.5 py-0.5 bg-emerald-500 text-black text-[0.5rem] font-black rounded-md">+{l.surplus}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {activeFloating.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-[0.5rem] font-black text-white/20 uppercase tracking-widest mb-1">Floating Assignments</div>
                              <div className="flex flex-wrap gap-1.5">
                                <SortableContext items={activeFloating.map((a, i) => `${loc.id}|${dIdx}|${assignments.indexOf(a)}`)} strategy={verticalListSortingStrategy}>
                                  {activeFloating.map((a, aIdx) => (
                                    <SortableTechnician
                                      key={`${loc.id}|${dIdx}|${assignments.indexOf(a)}`}
                                      id={`${loc.id}|${dIdx}|${assignments.indexOf(a)}`}
                                      assignment={a}
                                      refractingNote={getRefractingNote(a.person)}
                                      isAdmin={isAdmin}
                                      isDragging={activeId === `${loc.id}|${dIdx}|${assignments.indexOf(a)}`}
                                      onClick={() => viewMode === 'admin' && setEditingAssignment({ assignment: a, locationId: loc.id, index: assignments.indexOf(a) })}
                                    />
                                  ))}
                                </SortableContext>
                              </div>
                            </div>
                          )}

                          {overstaffed.length === 0 && activeFloating.length === 0 && (
                            <div className="flex items-center justify-center h-full">
                              <span className="text-[0.5rem] font-bold text-white/10 uppercase tracking-widest">No Activity</span>
                            </div>
                          )}
                        </DroppableLocation>
                      );
                    }
                    
                    const filtered = assignments.filter(a => 
                      !searchQuery || 
                      a.person.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      (a.status && a.status.toLowerCase().includes(searchQuery.toLowerCase()))
                    );
                    const doctors = filtered.filter(a => a.isDoctor);
                    const techs = filtered.filter(a => !a.isDoctor);
                    const actualTechCount = assignments.filter(a => !a.isDoctor).length;
                    const moveRecommendation = loc.targetTechs > 0 && actualTechCount < loc.targetTechs && daySchedule
                      ? rankMoveCandidates(daySchedule, loc.id, technicianProfiles)[0]
                      : undefined;

                    return (
                      <DroppableLocation 
                        key={cellId}
                        id={cellId}
                        className={`schedule-card rounded-2xl p-3 flex flex-col gap-3 transition-all hover:-translate-y-0.5 ${assignments.length === 0 ? 'opacity-50' : ''}`}
                      >
                        {/* Doctors */}
                        {doctors.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {doctors.map((a, aIdx) => (
                              <button
                                key={`${a.person}-${aIdx}`}
                                onClick={() => viewMode === 'admin' && setEditingAssignment({ assignment: a, locationId: loc.id, index: assignments.indexOf(a) })}
                                className={`${a.person === 'JC' ? 'bg-white border border-red-500 text-red-600' : 'brand-doctor'} px-2 py-1 rounded-lg text-[0.6rem] font-black tracking-tighter transition-transform ${viewMode === 'admin' ? 'hover:scale-105' : 'cursor-default'}`}
                                title={`${a.person} (${a.startTime}-${a.endTime}) ${a.status || ''}`}
                              >
                                {a.person}
                              </button>
                            ))}
                          </div>
                        )}
                        
                        {/* Divider if both exist */}
                        {doctors.length > 0 && techs.length > 0 && <div className="h-px bg-white/5 w-full" />}

                        {/* Techs */}
                        {techs.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            <SortableContext items={techs.map((a, i) => `${loc.id}|${dIdx}|${assignments.indexOf(a)}`)} strategy={verticalListSortingStrategy}>
                              {techs.map((a, aIdx) => (
                                <SortableTechnician
                                  key={`${loc.id}|${dIdx}|${assignments.indexOf(a)}`}
                                  id={`${loc.id}|${dIdx}|${assignments.indexOf(a)}`}
                                  assignment={a}
                                  refractingNote={getRefractingNote(a.person)}
                                  isAdmin={isAdmin}
                                  isDragging={activeId === `${loc.id}|${dIdx}|${assignments.indexOf(a)}`}
                                  onClick={() => viewMode === 'admin' && setEditingAssignment({ assignment: a, locationId: loc.id, index: assignments.indexOf(a) })}
                                />
                              ))}
                            </SortableContext>
                          </div>
                        )}
                        {moveRecommendation && (
                          <button
                            onClick={() => setCommandInput(`Move ${moveRecommendation.technician} from ${moveRecommendation.fromLocation} to ${loc.id} on ${daySchedule.dayName}`)}
                            className="mt-auto p-2 text-left bg-pink-500/[.08] border border-pink-500/20 rounded-xl hover:bg-pink-500/[.14] transition-all"
                            title={moveRecommendation.reason}
                          >
                            <div className="flex items-center justify-between gap-2 text-[0.48rem] uppercase tracking-widest font-black text-pink-300/70">
                              <span>Best move</span><Heart className="w-2.5 h-2.5" />
                            </div>
                            <div className="text-[0.6rem] font-bold mt-1">{moveRecommendation.technician} from {moveRecommendation.fromLocation}</div>
                            <div className="text-[0.48rem] text-white/30 mt-1 truncate">{moveRecommendation.reason}</div>
                          </button>
                        )}
                      </DroppableLocation>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <DragOverlay>
        {activeAssignment ? (
          <div className="px-3 py-1 bg-white text-black rounded-lg text-[0.6rem] font-black shadow-2xl ring-4 ring-blue-500/20">
            {activeAssignment.person}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  </>
        )}

        {/* Daily Notes Matrix */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
          {allSchedules.map((day, i) => day.notes && (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/[0.02] backdrop-blur-3xl border border-white/5 rounded-[2rem] p-6 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-1 h-full bg-white/10" />
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[0.5rem] font-black uppercase tracking-[0.3em] text-white/20">{day.dayName} NOTES</span>
              </div>
              <p className="text-[0.7rem] font-medium text-white/60 leading-relaxed font-mono">
                {day.notes}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Dynamic Status Bar */}
        <footer className="mobile-footer mt-16 flex justify-between items-center text-[0.6rem] font-mono text-white/20 tracking-[0.2em] uppercase border-t border-white/5 pt-8">
          <div className="flex gap-8">
            <span>Schedule sync: {isSyncing ? 'In progress' : 'Up to date'}</span>
            <span>Team planning ready</span>
          </div>
          <div className="flex gap-8">
            <span className="flex items-center gap-2">
              <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse" />
              Connected
            </span>
            <span>© 2026 Spindel Eye Associates</span>
          </div>
        </footer>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showTechProfile && selectedTech && (
          <TechnicianProfilePanel
            initials={selectedTech}
            ownerUid={technicianProfiles[selectedTech]?.ownerUid || user?.uid || 'local-preview'}
            profile={technicianProfiles[selectedTech]}
            onClose={() => setShowTechProfile(false)}
            onSave={saveSelectedProfile}
          />
        )}
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="brand-surface mobile-modal relative w-full max-w-xl bg-white border border-[#dce1eb] rounded-3xl p-10 shadow-[0_30px_60px_rgba(36,48,120,0.16)] overflow-y-auto max-h-[calc(100dvh-2rem)]"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              
              <div className="flex justify-between items-center mb-10">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight mb-1">Settings</h2>
                  <p className="text-xs text-white/40">Schedule preferences and integrations</p>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-3 hover:bg-white/5 rounded-2xl transition-all">
                  <X className="w-6 h-6 text-white/40" />
                </button>
              </div>

              <div className="space-y-10">
                <div className="space-y-4">
                  <label className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40 font-bold block ml-1">Google_Sheet_Source</label>
                  <div className="relative group">
                    <div className="absolute inset-0 bg-white/5 rounded-2xl blur-xl group-focus-within:bg-white/10 transition-all" />
                    <div className="relative">
                      <LinkIcon className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20" />
                      <input 
                        type="text" 
                        value={sheetUrl}
                        onChange={(e) => setSheetUrl(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm font-mono focus:outline-none focus:border-white/30 transition-all placeholder:text-white/10"
                      />
                    </div>
                  </div>
                  <div className="flex gap-3 p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                    <AlertCircle className="w-4 h-4 text-white/20 shrink-0" />
                    <p className="text-[0.65rem] text-white/30 leading-relaxed font-mono">
                      Ensure your Google Sheet is <strong className="text-white/50">Published to the web</strong> (File &gt; Share &gt; Publish to web) as a CSV for the mirror to function correctly.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40 font-bold block ml-1">Tab_GIDs (Optional)</label>
                  <div className="grid grid-cols-2 gap-4">
                    {WEEKS.map(w => (
                      <div key={w.id} className="space-y-1">
                        <span className="text-[0.5rem] text-white/20 font-mono">{w.label}</span>
                        <input 
                          type="text"
                          value={weekGids[w.id] || ''}
                          onChange={(e) => setWeekGids({ ...weekGids, [w.id]: e.target.value })}
                          placeholder="GID"
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-[0.6rem] font-mono focus:outline-none focus:border-white/30"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl">
                    <span className="text-[0.5rem] uppercase tracking-widest text-white/30 font-bold block mb-2">Auto_Refresh</span>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono">ENABLED</span>
                      <div className="w-8 h-4 bg-emerald-500/20 rounded-full relative">
                        <div className="absolute right-1 top-1 w-2 h-2 bg-emerald-400 rounded-full" />
                      </div>
                    </div>
                  </div>
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl">
                    <span className="text-[0.5rem] uppercase tracking-widest text-white/30 font-bold block mb-2">Staffing_Alerts</span>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono">ACTIVE</span>
                      <div className="w-8 h-4 bg-emerald-500/20 rounded-full relative">
                        <div className="absolute right-1 top-1 w-2 h-2 bg-emerald-400 rounded-full" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40 font-bold block ml-1">Default_Shift_Rules</label>
                  <form onSubmit={addShiftRule} className="grid grid-cols-2 gap-3">
                    <input
                      value={newShiftRule.technician}
                      onChange={(event) => setNewShiftRule({ ...newShiftRule, technician: event.target.value })}
                      placeholder="Tech initials"
                      className="bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-[0.7rem] font-mono focus:outline-none focus:border-white/30"
                    />
                    <select
                      value={newShiftRule.dayName}
                      onChange={(event) => setNewShiftRule({ ...newShiftRule, dayName: event.target.value })}
                      className="bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-[0.7rem] font-mono focus:outline-none focus:border-white/30"
                    >
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => <option key={day} value={day}>{day}</option>)}
                    </select>
                    <select
                      value={newShiftRule.locationId}
                      onChange={(event) => setNewShiftRule({ ...newShiftRule, locationId: event.target.value })}
                      className="bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-[0.7rem] font-mono focus:outline-none focus:border-white/30"
                    >
                      {OFFICE_LOCATIONS.map(office => <option key={office.id} value={office.id}>{office.id}</option>)}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={newShiftRule.startTime}
                        onChange={(event) => setNewShiftRule({ ...newShiftRule, startTime: event.target.value })}
                        placeholder="7:45a"
                        className="bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-[0.7rem] font-mono focus:outline-none focus:border-white/30"
                      />
                      <input
                        value={newShiftRule.endTime}
                        onChange={(event) => setNewShiftRule({ ...newShiftRule, endTime: event.target.value })}
                        placeholder="4:45p"
                        className="bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-[0.7rem] font-mono focus:outline-none focus:border-white/30"
                      />
                    </div>
                    <button type="submit" className="col-span-2 bg-white text-black font-bold py-3 rounded-xl hover:bg-white/90 transition-all">
                      Add editable rule
                    </button>
                  </form>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {shiftRules.length === 0 ? (
                      <p className="text-[0.65rem] text-white/25 font-mono">Standard office shift is 7:45a-4:45p unless a rule is added here.</p>
                    ) : shiftRules.map(rule => (
                      <div key={rule.id} className="flex items-center justify-between gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                        <span className="text-[0.65rem] font-mono">{rule.technician} {rule.dayName} {rule.locationId} {rule.startTime}-{rule.endTime}</span>
                        <button onClick={() => removeShiftRule(rule.id)} className="text-[0.6rem] font-bold text-red-300 hover:text-red-200">REMOVE</button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40 font-bold block ml-1">UI_Theme_Selection</label>
                  <div className="grid grid-cols-2 gap-4">
                    {THEMES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setTheme(t.id)}
                        className={`p-4 rounded-2xl border transition-all flex flex-col gap-2 ${theme === t.id ? 'bg-white/10 border-white/30' : 'bg-white/5 border-white/5 hover:border-white/10'}`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-[0.65rem] font-mono uppercase">{t.label}</span>
                          {theme === t.id && <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />}
                        </div>
                        <div className="flex gap-1">
                          <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40 font-bold block ml-1">External_Integration</label>
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[0.5rem] uppercase tracking-widest text-white/30 font-bold">Embed_URL</span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(window.location.origin);
                          alert('Embed URL copied to clipboard!');
                        }}
                        className="text-[0.5rem] px-2 py-1 bg-white/10 hover:bg-white/20 rounded-lg transition-all font-mono"
                      >
                        COPY_LINK
                      </button>
                    </div>
                    <p className="text-[0.6rem] text-white/20 font-mono leading-relaxed">
                      Use this URL in Google Sites "Embed" tool to integrate Spindel Scheduler into your technician website.
                    </p>
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    onClick={saveSettings}
                    className="w-full bg-white text-black font-bold py-5 rounded-2xl hover:bg-white/90 transition-all active:scale-[0.98] shadow-[0_20px_40px_rgba(255,255,255,0.1)]"
                  >
                    Save changes and refresh
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
        {editingAssignment && (
          <EditAssignmentModal 
            assignment={editingAssignment.assignment} 
            onClose={() => setEditingAssignment(null)} 
            onSave={updateAssignment} 
          />
        )}
        {showGemini && (
          <GeminiPanel 
            scheduleData={allSchedules} 
            technicianProfiles={technicianProfiles}
            onClose={() => setShowGemini(false)} 
          />
        )}
        {showLogs && (
          <motion.div
            initial={{ opacity: 0, x: 400 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 400 }}
            className="brand-surface fixed right-0 top-0 bottom-0 w-full md:w-[450px] bg-white border-l border-[#dce1eb] z-[100] flex flex-col shadow-2xl"
          >
            <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center border border-blue-500/30">
                  <History className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-sm font-bold tracking-tight text-white">Change history</h2>
                  <p className="text-[0.6rem] text-white/40">Activity from the last five days</p>
                </div>
              </div>
              <button 
                onClick={() => setShowLogs(false)}
                className="p-2 hover:bg-white/10 rounded-xl transition-all text-white/40 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {logs.map((log) => (
                <div key={log.id} className="p-4 bg-white/5 border border-white/5 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[0.5rem] font-mono text-white/20">{log.timestamp?.toDate ? format(log.timestamp.toDate(), 'MMM d, HH:mm') : 'Syncing...'}</span>
                    <span className="text-[0.5rem] font-black uppercase tracking-widest px-2 py-0.5 bg-white/10 rounded">{log.action}</span>
                  </div>
                  <p className="text-xs font-mono text-white/70">{log.description}</p>
                  <p className="text-[0.5rem] font-mono text-white/20 italic">{log.userEmail}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Crosshair Cursor & Global Styles */}
      <style>{`
        body { cursor: default; }
        button, a, select { cursor: pointer; }
        * {
          scrollbar-width: none;
        }
        *::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
