import { MouseEvent, PointerEvent, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowDown, ArrowUp, Crosshair, Heart, MapPin, Navigation, Save, X } from 'lucide-react';
import { OFFICE_LOCATIONS, appleMapsDirectionsUrl, googleMapsDirectionsUrl } from '../constants/locations';
import { TechnicianProfile } from '../services/technicianProfileService';
import {
  calculateOfficeCommutes,
  Coordinates,
  OFFICE_COORDINATES,
  rankOfficesByCommute,
} from '../services/commuteService';

interface Props {
  initials: string;
  ownerUid: string;
  profile?: TechnicianProfile;
  onClose: () => void;
  onSave: (profile: TechnicianProfile) => Promise<void>;
}

const MAP_BOUNDS = {
  north: 43.08,
  south: 42.18,
  west: -71.82,
  east: -70.98,
};

const AREA_MAP_URL = 'https://www.google.com/maps?q=42.63,-71.36&z=9&output=embed';

const toRadians = (degrees: number) => degrees * Math.PI / 180;

const toDegrees = (radians: number) => radians * 180 / Math.PI;

const latToMercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + toRadians(lat) / 2));

const mercatorToLat = (value: number) => toDegrees(2 * Math.atan(Math.exp(value)) - Math.PI / 2);

function pinToPosition(pin: Coordinates) {
  const north = latToMercator(MAP_BOUNDS.north);
  const south = latToMercator(MAP_BOUNDS.south);
  return {
    left: `${((pin.lng - MAP_BOUNDS.west) / (MAP_BOUNDS.east - MAP_BOUNDS.west)) * 100}%`,
    top: `${((north - latToMercator(pin.lat)) / (north - south)) * 100}%`,
  };
}

function positionToPin(event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>): Coordinates {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  const north = latToMercator(MAP_BOUNDS.north);
  const south = latToMercator(MAP_BOUNDS.south);
  return {
    lat: mercatorToLat(north - (y * (north - south))),
    lng: MAP_BOUNDS.west + (x * (MAP_BOUNDS.east - MAP_BOUNDS.west)),
  };
}

export function TechnicianProfilePanel({ initials, ownerUid, profile, onClose, onSave }: Props) {
  const [homeAddress, setHomeAddress] = useState(profile?.homeAddress || '');
  const [homePin, setHomePin] = useState<Coordinates | undefined>(profile?.homePin);
  const [ranking, setRanking] = useState<string[]>(profile?.officeRanking?.length
    ? profile.officeRanking
    : OFFICE_LOCATIONS.map(location => location.id));
  const [miles, setMiles] = useState<Record<string, number>>(profile?.commuteMiles || {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHomeAddress(profile?.homeAddress || '');
    setHomePin(profile?.homePin);
    setRanking(profile?.officeRanking?.length ? profile.officeRanking : OFFICE_LOCATIONS.map(location => location.id));
    setMiles(profile?.commuteMiles || {});
  }, [profile, initials]);

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ranking.length) return;
    const next = [...ranking];
    [next[index], next[target]] = [next[target], next[index]];
    setRanking(next);
  };

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({ initials, ownerUid, homeAddress: homeAddress.trim(), homePin, officeRanking: ranking, commuteMiles: miles });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const updateHomePin = (pin: Coordinates) => {
    const roundedPin = { lat: Number(pin.lat.toFixed(5)), lng: Number(pin.lng.toFixed(5)) };
    setHomePin(roundedPin);
    setMiles(calculateOfficeCommutes(roundedPin));
  };

  const useCurrentLocation = () => {
    navigator.geolocation?.getCurrentPosition(position => {
      updateHomePin({ lat: position.coords.latitude, lng: position.coords.longitude });
    });
  };

  const applyCommuteRanking = () => {
    if (!homePin) return;
    setRanking(rankOfficesByCommute(homePin));
    setMiles(calculateOfficeCommutes(homePin));
  };

  const mapUrl = homePin
    ? `https://www.google.com/maps?q=${homePin.lat},${homePin.lng}&z=10&output=embed`
    : AREA_MAP_URL;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button aria-label="Close profile" onClick={onClose} className="absolute inset-0 bg-black/80 backdrop-blur-md" />
      <motion.div initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} className="brand-surface relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white border border-[#dce1eb] rounded-3xl p-8 shadow-2xl">
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 text-pink-400 text-[0.6rem] font-black tracking-[.25em] uppercase mb-2"><Heart className="w-4 h-4" /> Happy schedule profile</div>
            <h2 className="text-2xl font-bold">{initials} office preferences</h2>
            <p className="text-xs text-white/40 mt-2">Rank offices from favorite to least favorite and save your usual one-way drive.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>

        <label className="block mb-8">
          <span className="text-[0.6rem] uppercase tracking-widest text-white/40 font-bold">Starting address (optional)</span>
          <div className="relative mt-2">
            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input value={homeAddress} onChange={event => setHomeAddress(event.target.value)} placeholder="Home address or town" className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:border-white/30" />
          </div>
          <span className="block mt-2 text-[0.6rem] text-white/25">Used only to prefill directions. Leave blank to let your map app use your current location.</span>
        </label>

        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_.85fr] gap-4 mb-8">
          <div
            onClick={event => updateHomePin(positionToPin(event))}
            onPointerMove={event => {
              if (event.buttons === 1) updateHomePin(positionToPin(event));
            }}
            className="relative h-72 overflow-hidden rounded-2xl border border-white/10 bg-[#152033] cursor-crosshair"
          >
            <iframe
              title="Spindel office area map"
              src={mapUrl}
              className="absolute inset-0 h-full w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              style={{ pointerEvents: 'none' }}
            />
            <div className="absolute inset-0 bg-black/5" />
            {OFFICE_LOCATIONS.map(office => {
              const position = pinToPosition(OFFICE_COORDINATES[office.id]);
              return (
                <div key={office.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={position}>
                  <div className="px-2 py-1 rounded-lg text-[0.52rem] font-black shadow-lg border border-white/20" style={{ backgroundColor: office.color, color: '#111827' }}>
                    {office.code}
                  </div>
                </div>
              );
            })}
            {homePin && (
              <div className="absolute -translate-x-1/2 -translate-y-full" style={pinToPosition(homePin)}>
                <div className="flex flex-col items-center">
                  <MapPin className="w-8 h-8 text-white drop-shadow-[0_6px_14px_rgba(0,0,0,.6)]" fill="#ff4d4d" />
                  <span className="mt-1 px-2 py-0.5 rounded bg-black/50 text-[0.5rem] font-bold">HOME</span>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <button onClick={useCurrentLocation} className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl py-3 text-xs font-bold">
              <Crosshair className="w-4 h-4" /> Use current location
            </button>
            <button disabled={!homePin} onClick={applyCommuteRanking} className="w-full flex items-center justify-center gap-2 bg-pink-500/15 hover:bg-pink-500/20 border border-pink-500/25 rounded-xl py-3 text-xs font-bold disabled:opacity-40">
              <Heart className="w-4 h-4" /> Rank by commute
            </button>
            {homePin && (
              <div className="p-4 bg-white/[.03] border border-white/10 rounded-2xl">
                <div className="text-[0.55rem] uppercase tracking-widest text-white/30 font-bold mb-2">Home pin</div>
                <div className="font-mono text-sm">{homePin.lat.toFixed(4)}, {homePin.lng.toFixed(4)}</div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {ranking.map((officeId, index) => {
            const office = OFFICE_LOCATIONS.find(item => item.id === officeId)!;
            return (
              <div key={officeId} className="grid grid-cols-[auto_1fr_auto] md:grid-cols-[auto_1fr_150px_auto] items-center gap-3 p-3 bg-white/[.03] border border-white/10 rounded-2xl">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black" style={{ color: office.color, backgroundColor: `${office.color}20` }}>{index + 1}</div>
                <div>
                  <div className="font-bold">{office.id}</div>
                  <div className="text-[0.55rem] text-white/30 uppercase tracking-widest">{index === 0 ? 'Favorite office' : index === ranking.length - 1 ? 'Least favorite' : `Preference ${index + 1}`}</div>
                </div>
                <label className="col-span-2 md:col-span-1 flex items-center gap-2 bg-black/20 rounded-xl px-3 py-2">
                  <input type="number" min="0" step="0.1" value={miles[officeId] ?? ''} onChange={event => setMiles({ ...miles, [officeId]: Math.max(0, Number(event.target.value)) })} placeholder="--" className="w-full bg-transparent text-right font-mono text-sm focus:outline-none" />
                  <span className="text-[0.6rem] text-white/30">MI</span>
                </label>
                <div className="flex gap-1">
                  <button aria-label={`Move ${officeId} up`} onClick={() => move(index, -1)} disabled={index === 0} className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-20"><ArrowUp className="w-4 h-4" /></button>
                  <button aria-label={`Move ${officeId} down`} onClick={() => move(index, 1)} disabled={index === ranking.length - 1} className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-20"><ArrowDown className="w-4 h-4" /></button>
                </div>
                <div className="col-span-3 md:col-start-2 md:col-span-3 flex gap-2">
                  <a target="_blank" rel="noreferrer" href={googleMapsDirectionsUrl(office.mapQuery!, homeAddress)} className="flex items-center gap-1.5 text-[0.55rem] font-bold px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg"><Navigation className="w-3 h-3" /> GOOGLE MAPS</a>
                  <a target="_blank" rel="noreferrer" href={appleMapsDirectionsUrl(office.mapQuery!, homeAddress)} className="flex items-center gap-1.5 text-[0.55rem] font-bold px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg">APPLE MAPS</a>
                </div>
              </div>
            );
          })}
        </div>

        <button disabled={saving} onClick={submit} className="mt-8 w-full flex items-center justify-center gap-2 bg-white text-black font-bold py-4 rounded-xl disabled:opacity-50"><Save className="w-4 h-4" /> {saving ? 'SAVING...' : 'SAVE PROFILE'}</button>
      </motion.div>
    </div>
  );
}
