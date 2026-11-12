import { OFFICE_LOCATIONS } from '../constants/locations';

export interface Coordinates {
  lat: number;
  lng: number;
}

export const OFFICE_COORDINATES: Record<string, Coordinates> = {
  Derry: { lat: 42.8975, lng: -71.32336 },
  Londonderry: { lat: 42.8674, lng: -71.34716 },
  Windham: { lat: 42.80202, lng: -71.3029 },
  Bedford: { lat: 42.95626, lng: -71.47868 },
  Raymond: { lat: 43.02554, lng: -71.16777 },
};

const EARTH_RADIUS_MILES = 3958.8;

const toRadians = (degrees: number) => degrees * Math.PI / 180;

export function distanceMiles(from: Coordinates, to: Coordinates) {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_MILES * c * 10) / 10;
}

export function calculateOfficeCommutes(homePin: Coordinates) {
  return Object.fromEntries(
    OFFICE_LOCATIONS.map(office => [
      office.id,
      distanceMiles(homePin, OFFICE_COORDINATES[office.id]),
    ])
  ) as Record<string, number>;
}

export function rankOfficesByCommute(homePin: Coordinates) {
  const miles = calculateOfficeCommutes(homePin);
  return OFFICE_LOCATIONS
    .map(office => office.id)
    .sort((a, b) => miles[a] - miles[b] || a.localeCompare(b));
}
