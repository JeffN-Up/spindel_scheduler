export interface OfficeLocation {
  id: string;
  code: string;
  color: string;
  targetTechs: number;
  mapQuery?: string;
}

export const OFFICE_LOCATIONS: OfficeLocation[] = [
  { id: 'Derry', code: 'D', color: '#ff4d4d', targetTechs: 8, mapQuery: '6 Tsienneto Road Suite 101, Derry, NH 03038' },
  { id: 'Londonderry', code: 'LD', color: '#4d94ff', targetTechs: 2, mapQuery: '50 Michels Way Suite 104, Londonderry, NH 03053' },
  { id: 'Windham', code: 'W', color: '#4dff88', targetTechs: 4, mapQuery: '7 Indian Rock Road, Suite E, Windham, NH 03087' },
  { id: 'Bedford', code: 'B', color: '#ff4db8', targetTechs: 2, mapQuery: '166 South River Road, Bedford, NH 03110' },
  { id: 'Raymond', code: 'R', color: '#b84dff', targetTechs: 2, mapQuery: '6 Old Fremont Road Suite 1, Raymond, NH 03077' },
];

export const SCHEDULE_LOCATIONS: OfficeLocation[] = [
  ...OFFICE_LOCATIONS,
  { id: 'Surgery', code: 'S', color: '#f59e0b', targetTechs: 0 },
  { id: 'Off', code: 'OFF', color: '#64748b', targetTechs: 0 },
  { id: 'Admin', code: 'ADM', color: '#94a3b8', targetTechs: 0 },
  { id: 'Floating', code: 'FL', color: '#94a3b8', targetTechs: 0 },
];

export function googleMapsDirectionsUrl(destination: string, origin?: string) {
  const params = new URLSearchParams({ api: '1', destination, travelmode: 'driving' });
  if (origin?.trim()) params.set('origin', origin.trim());
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function appleMapsDirectionsUrl(destination: string, origin?: string) {
  const params = new URLSearchParams({ daddr: destination, dirflg: 'd' });
  if (origin?.trim()) params.set('saddr', origin.trim());
  return `https://maps.apple.com/?${params.toString()}`;
}
