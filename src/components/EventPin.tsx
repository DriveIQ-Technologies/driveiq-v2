import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Marker } from 'react-native-maps';

import { EventMarker } from '@/components/EventMarker';
import type { AppEvent } from '@/types/event';
import { pinDescriptorFor } from '@/utils/eventIcons';

interface EventPinProps {
  event: AppEvent;
  selected: boolean;
  onPress: (event: AppEvent) => void;
  /**
   * Bumped by the map screen after each completed pan/zoom gesture. Any pin
   * whose frozen bitmap came out blank or clipped (the intermittent "pin not
   * showing" bug — e.g. the invisible Wimbledon pin, the broken Luton pins)
   * re-rasterises on the next gesture and heals itself.
   */
  rasterEpoch?: number;
}

/**
 * A single event map pin.
 *
 * ## Why this exists (the flicker fix)
 * react-native-maps re-rasterises a custom marker on EVERY render while
 * `tracksViewChanges` is true — and the parent map re-renders constantly
 * (location, polls, selection). Leaving tracking on = the constant flicker.
 *
 * So each pin manages its own `tracksViewChanges`:
 *   - true for a short beat on mount (so the custom view rasterises once),
 *     then false — the pin becomes a frozen bitmap that never flickers.
 *   - true again briefly whenever `selected` flips, so the grow/shrink
 *     spring animation is captured, then frozen again.
 *
 * Wrapped in React.memo so an unrelated parent re-render (e.g. a traffic
 * poll) doesn't touch any pin whose own props are unchanged.
 */
function EventPinBase({ event, selected, onPress, rasterEpoch = 0 }: EventPinProps) {
  const descriptor = useMemo(() => pinDescriptorFor(event), [event]);

  // Track view changes until the pin's content has painted, THEN freeze to a
  // bitmap so it never flickers. Freezing on a blind timer (the old 400ms) was
  // the bug: a logo image or icon that hadn't decoded yet froze blank and only
  // reappeared when a zoom forced a re-snapshot. Now EventMarker calls onReady
  // once its glyph/image is actually on screen; we freeze shortly after. A
  // safety timeout still freezes in case onReady never fires.
  const [tracks, setTracks] = useState(true);
  const frozenRef = useRef(false);
  const freezeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const freezeSoon = () => {
    if (frozenRef.current) return;
    frozenRef.current = true;
    freezeTimerRef.current = setTimeout(() => setTracks(false), 200);
  };
  useEffect(() => {
    const safety = setTimeout(() => setTracks(false), 2000);
    return () => {
      clearTimeout(safety);
      // Hundreds of pins mount and unmount as filters change; an orphan timer
      // per pin adds up to real work on the JS thread.
      if (freezeTimerRef.current) clearTimeout(freezeTimerRef.current);
    };
  }, []);

  // Self-heal pass: after each completed map gesture, briefly re-enable
  // tracking so a bitmap that froze blank/clipped gets re-captured. Skips the
  // initial mount (the onReady path above covers that).
  const firstEpoch = useRef(true);
  useEffect(() => {
    if (firstEpoch.current) {
      firstEpoch.current = false;
      return;
    }
    setTracks(true);
    const id = setTimeout(() => setTracks(false), 350);
    return () => clearTimeout(id);
  }, [rasterEpoch]);

  // Re-enable tracking ONLY for a real select/deselect after mount — skipping
  // the initial run avoids a second, overlapping track window on every pin as
  // it appears (a key source of the mass flicker). Once selection actually
  // flips we briefly re-rasterise to capture the grow/shrink spring, then
  // freeze the final frame again.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setTracks(true);
    const id = setTimeout(() => setTracks(false), 520);
    return () => clearTimeout(id);
  }, [selected]);

  return (
    <Marker
      coordinate={{ latitude: event.latitude, longitude: event.longitude }}
      onPress={() => onPress(event)}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracks}
      // Featured pins (Wimbledon, Ascot, …) sit above cluster bubbles
      // (zIndex 15) so a count bubble can never cover them; airports (20)
      // stay on top of everything.
      zIndex={event.source === 'featured' ? 18 : 10}
    >
      <EventMarker descriptor={descriptor} selected={selected} onReady={freezeSoon} />
    </Marker>
  );
}

export const EventPin = React.memo(
  EventPinBase,
  (prev, next) =>
    prev.selected === next.selected &&
    prev.event.id === next.event.id &&
    prev.event.latitude === next.event.latitude &&
    prev.event.longitude === next.event.longitude &&
    prev.onPress === next.onPress &&
    prev.rasterEpoch === next.rasterEpoch,
);
