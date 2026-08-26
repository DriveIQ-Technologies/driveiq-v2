import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import React, {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  InteractionManager,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, {
  Marker,
  Polyline,
  PROVIDER_DEFAULT,
  PROVIDER_GOOGLE,
  type Region,
} from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AirportsPanel } from '@/components/AirportsPanel';
import { AirportPin } from '@/components/AirportPin';
import { AirportFlightsSheet } from '@/components/AirportFlightsSheet';
import { AIRPORTS, type Airport } from '@/services/airports';
import { CategoryFilterBar } from '@/components/CategoryFilterBar';
import { ClusterPin } from '@/components/ClusterPin';
import { ConnectionsPanel } from '@/components/ConnectionsPanel';
import { showDialog } from '@/services/dialog';
import { EventDetailsSheet } from '@/components/EventDetailsSheet';
import { EventPin } from '@/components/EventPin';
import { FilterBar } from '@/components/FilterBar';
import {
  LayerControlPanel,
  type LayerKey,
  type LayerVisibility,
} from '@/components/LayerControlPanel';
import { MapActionStack } from '@/components/MapActionStack';
import { NavigationAppPicker, type NavDestination } from '@/components/NavigationAppPicker';
import { NavigationOverlay } from '@/components/NavigationOverlay';
import { RouteInfoPanel } from '@/components/RouteInfoPanel';
import { RoadsPanel } from '@/components/RoadsPanel';
import { SplashLoading } from '@/components/SplashLoading';
import { TrafficIncidentSheet } from '@/components/TrafficIncidentSheet';
import { TrafficMarker } from '@/components/TrafficMarker';
import { loadCachedEvents, saveCachedEvents } from '@/services/eventCache';
import { reminderDialogMessage } from '@/services/eventReminders';
import { isPlausibleLondonEvent } from '@/services/eventSanity';
import { fetchAllEvents } from '@/services/events';
import {
  fetchRoutes,
  trafficColor,
  type RouteOption,
  type RouteStep,
} from '@/services/routing';
import {
  fetchTrafficIncidents,
  incidentColor,
  incidentIconName,
  isMajorIncident,
  type TrafficIncident,
} from '@/services/tflTraffic';
import { fetchHighwaysIncidents } from '@/services/highwaysTraffic';
import { fetchLineStatuses, type LineStatus } from '@/services/tflLines';
import {
  diffAndNotifyIncidents,
  diffAndNotifyLines,
  diffAndNotifyFlights,
  ensurePermission,
  hasSeenOnboarding,
  loadPrefs,
  scheduleEventReminder,
  startNotificationOpenTracking,
  type NotificationPrefs,
} from '@/services/notifications';
import { fetchAirportFlights } from '@/services/aerodatabox';
import { loadSavedFlights, type SavedFlightMap } from '@/services/savedFlights';
import { setJSON } from '@/services/storage';
import { track, trackScreen } from '@/services/analytics';
import { MAJOR_STATIONS, type MajorStation } from '@/services/stations';
import { StationPin } from '@/components/StationPin';
import { StationHubSheet } from '@/components/StationHubSheet';
import {
  loadSavedEvents,
  saveEvent,
  unsaveEvent,
  type SavedEventMap,
} from '@/services/savedEvents';
import { addEventToCalendar } from '@/services/calendar';
import { ReportSheet } from '@/components/ReportSheet';
import { ReportMarker } from '@/components/ReportMarker';
import {
  addReport,
  loadReports,
  removeReport,
  REPORT_META,
  type ReportCategory,
  type UserReport,
} from '@/services/reports';
import { NotificationOnboarding } from '@/components/NotificationOnboarding';
import { OnboardingTour } from '@/components/OnboardingTour';
import { PremiumInlineBar } from '@/components/PremiumInlineBar';
import {
  markWaitlistTrialEndSeen,
  shouldShowWaitlistTrialEnd,
  WaitlistTrialEndSheet,
} from '@/components/WaitlistTrialEndSheet';
import { NotificationSettingsPanel } from '@/components/NotificationSettingsPanel';
import { SidebarMenu } from '@/components/SidebarMenu';
import { HelpSheet } from '@/components/HelpSheet';
import { FeedbackSheet } from '@/components/FeedbackSheet';
import { AboutSheet } from '@/components/AboutSheet';
import { AISupportSheet } from '@/components/AISupportSheet';
import { AuthSheet } from '@/components/AuthSheet';
import { AccountSheet, type AccountSection } from '@/components/AccountSheet';
import { hasProAccess, showPremiumPaywall } from '@/services/subscription';
import {
  hasSeenSignupInvite,
  markSignupInviteSeen,
} from '@/services/onboarding';
import { colors } from '@/theme/colors';
import type { AppEvent } from '@/types/event';
import {
  buildFilterChips,
  eventOverlapsRange,
  isInRange,
  rangeFor,
  type FilterKey,
} from '@/utils/dateFilters';
import { VenueEventsSheet } from '@/components/VenueEventsSheet';
import {
  CLUSTER_OFF_DELTA,
  clusterEvents,
  type EventCluster,
} from '@/utils/clustering';
import { distanceMeters, type LatLng } from '@/utils/distance';
import {
  isEventBeyondFreeHorizon,
  isPremiumDayFilter,
  formatStaleLabel,
  splitEventsByPremium,
} from '@/utils/premiumHorizon';
import {
  categoryFilterFor,
  type CategoryFilterKey,
} from '@/utils/eventIcons';
import { useAuth } from '@/providers/AuthProvider';

interface Destination {
  /** What kind of pin spawned this route. */
  kind: 'event' | 'incident' | 'airport' | 'station';
  label: string;
  latitude: number;
  longitude: number;
}

const LONDON_REGION: Region = {
  latitude: 51.5074,
  longitude: -0.1278,
  latitudeDelta: 0.18,
  longitudeDelta: 0.18,
};

/**
 * Pick the right map provider for the current runtime.
 *
 * Expo Go on iOS doesn't bundle the AirGoogleMaps native module, so asking for
 * `PROVIDER_GOOGLE` there throws "AirGoogleMaps dir must be added…". Detect
 * Expo Go and fall back to Apple Maps in that case. In a custom dev build /
 * standalone app, `PROVIDER_GOOGLE` works on both platforms.
 */
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const MAP_PROVIDER =
  Platform.OS === 'ios' && isExpoGo ? PROVIDER_DEFAULT : PROVIDER_GOOGLE;

// DriveIQ brand mark for the top pill + sidebar header.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BRAND_LOGO = require('../assets/driveiq-logo.png');

export default function MapScreen() {
  const {
    requireAccount,
    accountPrompt,
    closeAccountPrompt,
    hasAccount,
    initializing,
    registerSheetDismisser,
    completedAction,
    clearCompletedAction,
  } = useAuth();
  const mapRef = useRef<MapView>(null);
  // Default to Today so the map opens on ~100 events, not all ~1,100 — far
  // less congested in central London. "All" is still available as a chip.
  const [filter, setFilter] = useState<FilterKey>('today');
  const [categories, setCategories] = useState<Set<CategoryFilterKey>>(
    () => new Set(),
  );
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [selected, setSelected] = useState<AppEvent | null>(null);

  // Saved / followed events (persisted). Drives the bookmark state on the
  // event sheet and the 1-hour-before reminder.
  const [savedEvents, setSavedEvents] = useState<SavedEventMap>({});

  // Community reports (persisted, device-local). `reportSheetOpen` drives the
  // create-report sheet; `lastRegionRef` tracks the map centre so a new report
  // drops where the user is looking.
  const [reports, setReports] = useState<UserReport[]>([]);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const lastRegionRef = useRef<Region>(LONDON_REGION);

  // Bumped when the zoom level changes materially; passed to pins so any
  // marker whose frozen bitmap rendered blank/clipped re-rasterises and heals
  // itself. `rasterZoomRef` holds the zoom the last heal ran at.
  const [rasterEpoch, setRasterEpoch] = useState(0);
  const rasterZoomRef = useRef(LONDON_REGION.latitudeDelta);

  // Committed viewport (updates when a pan/zoom gesture ENDS, not per frame).
  // Drives re-clustering of the venue pins.
  const [mapRegion, setMapRegion] = useState<Region>(LONDON_REGION);

  // Events at the venue pin the user just tapped (when 2+ events share that
  // location). Drives the venue list sheet.
  const [venueEvents, setVenueEvents] = useState<AppEvent[] | null>(null);
  const [venueLockedEvents, setVenueLockedEvents] = useState<AppEvent[]>([]);
  const [isPremium, setIsPremium] = useState(false);
  const [notifPrimingOpen, setNotifPrimingOpen] = useState(false);
  const [waitlistTrialEndOpen, setWaitlistTrialEndOpen] = useState(false);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<number | null>(null);

  // Traffic incidents (TfL).
  const [incidents, setIncidents] = useState<TrafficIncident[]>([]);
  const [lineStatuses, setLineStatuses] = useState<LineStatus[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<TrafficIncident | null>(null);

  // Map-overlay panels.
  const [layersOpen, setLayersOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [airportsOpen, setAirportsOpen] = useState(false);
  const [roadsOpen, setRoadsOpen] = useState(false);
  // Airport whose live flights board is open (tapped an airport map pin).
  const [flightsAirport, setFlightsAirport] = useState<Airport | null>(null);
  // Station hub sheet opened from a map pin.
  const [stationHub, setStationHub] = useState<MajorStation | null>(null);
  const [notifSettingsOpen, setNotifSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Branded launch / loading screen, shown over everything on first mount.
  const [showSplash, setShowSplash] = useState(true);

  // First-launch product tour gates the notifications ask so they don't
  // stack on top of each other.
  const [tourDone, setTourDone] = useState(false);
  const [signupInvite, setSignupInvite] = useState(false);
  const [signupInviteEligible, setSignupInviteEligible] = useState(false);

  // Support sheets reachable from the sidebar.
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aiSupportOpen, setAiSupportOpen] = useState(false);

  // Auth UI: sign-in / create-account sheet, and the signed-in account
  // management sheet (profile / email / password).
  const [authSheet, setAuthSheet] = useState<{ open: boolean; mode: 'signin' | 'signup' }>({
    open: false,
    mode: 'signin',
  });
  const [accountSheet, setAccountSheet] = useState<{ open: boolean; section: AccountSection }>({
    open: false,
    section: 'profile',
  });

  // Notification preferences — read once on mount, kept in state so the
  // poll loop sees the latest opt-ins/outs. `hasAccountRef` mirrors the auth
  // state so the loop can gate delivery without restarting the interval.
  const prefsRef = useRef<NotificationPrefs | null>(null);
  const hasAccountRef = useRef(false);
  const [layers, setLayers] = useState<LayerVisibility>({
    events: true,
    traffic: false,
    transit: true,
  });

  // Routing state. `destination` drives the polylines + RouteInfoPanel.
  const [destination, setDestination] = useState<Destination | null>(null);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Picker (DriveIQ / Google / Waze / Apple Maps).
  const [pickerDestination, setPickerDestination] = useState<NavDestination | null>(null);

  // Turn-by-turn navigation mode.
  const [isNavigating, setIsNavigating] = useState(false);
  const [userHeading, setUserHeading] = useState(0);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [cameraDetached, setCameraDetached] = useState(false);
  const [offRoute, setOffRoute] = useState(false);
  // The latest user position used for live nav metrics. Decoupled from
  // `userLocation` so the watcher can update at high frequency without
  // making everything else re-render.
  const [navUserPos, setNavUserPos] = useState<LatLng | null>(null);

  // Filter incidents to major-only — Severe/Serious, closures, or collisions.
  const majorIncidents = useMemo(
    () => incidents.filter(isMajorIncident),
    [incidents],
  );

  const toggleLayer = useCallback((key: LayerKey) => {
    track('map_layer_toggled', { layer: key, enabled: !layers[key] });
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, [layers]);

  useEffect(() => {
    trackScreen('map_home');
  }, []);

  // Close every presented sheet *except* the sidebar. The menu must stay
  // reachable from first paint; gated actions only need other RN Modals
  // dismissed so AuthSheet isn't stacked on top of another modal window.
  const closeAllSheets = useCallback(() => {
    setSelected(null);
    setVenueEvents(null);
    setVenueLockedEvents([]);
    setSelectedIncident(null);
    setFlightsAirport(null);
    setStationHub(null);
    setPickerDestination(null);
    setReportSheetOpen(false);
    setLayersOpen(false);
    setConnectionsOpen(false);
    setAirportsOpen(false);
    setRoadsOpen(false);
    setNotifSettingsOpen(false);
    setHelpOpen(false);
    setFeedbackOpen(false);
    setAboutOpen(false);
    setAiSupportOpen(false);
    setAccountSheet((s) => ({ ...s, open: false }));
  }, []);

  useEffect(() => {
    registerSheetDismisser(closeAllSheets);
    return () => registerSheetDismisser(null);
  }, [registerSheetDismisser, closeAllSheets]);

  // Notifications are account-gated, so only ask the OS for permission once
  // there's an account to attach them to, and re-read prefs across sign in /
  // sign out so the poll loop stops or resumes with the right opt-ins.
  useEffect(() => {
    hasAccountRef.current = hasAccount;
    let cancelled = false;
    (async () => {
      const prefs = await loadPrefs();
      if (cancelled) return;
      prefsRef.current = prefs;
      if (hasAccount) await ensurePermission();
    })();
    return () => {
      cancelled = true;
    };
  }, [hasAccount]);

  // The AI sheet is the one surface we dismissed that the user can't get back
  // to on their own, so reopen it once the account exists.
  useEffect(() => {
    if (!completedAction) return;
    const action = completedAction;
    clearCompletedAction();
    if (action !== 'ai_question') return;
    const id = setTimeout(() => setAiSupportOpen(true), 300);
    return () => clearTimeout(id);
  }, [completedAction, clearCompletedAction]);

  // After the walkthrough: Create account, with a quiet skip. Wait until
  // auth has settled so we don't flash this at people who already signed in.
  useEffect(() => {
    if (!tourDone || !signupInviteEligible || initializing || hasAccount || signupInvite) {
      return;
    }
    let cancelled = false;
    (async () => {
      const seen = await hasSeenSignupInvite();
      if (!cancelled && !seen) setSignupInvite(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [tourDone, signupInviteEligible, initializing, hasAccount, signupInvite]);

  // Ask for location permission once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setUserLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      } catch (e) {
        console.warn('[location] failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-read the GPS fix whenever the app returns to the foreground. Location
  // was only read once on mount, so if the user moved while the app was
  // backgrounded/closed, the blue dot stayed at the OLD position until a
  // manual re-centre (client bug report, 7 July 2026). Foreground ("while
  // using") permission fully covers this — no need for the "Allow all the
  // time" background permission, which is only for tracking while closed.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      (async () => {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status !== 'granted') return;
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setUserLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        } catch (e) {
          console.warn('[location] foreground re-read failed', e);
        }
      })();
    });
    return () => sub.remove();
  }, []);

  // Load events AFTER splash/auth. Starting the provider fan-out during splash
  // starved the JS thread and made the menu feel dead until pins finished.
  // Splash covers the map while auth warms; events start once chrome is free.
  useEffect(() => {
    if (showSplash) return;

    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);

    const logCoverage = (list: AppEvent[]) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const buckets: Record<string, number> = {};
      for (const e of list) {
        const d = new Date(e.startsAt);
        const localDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        buckets[localDay] = (buckets[localDay] ?? 0) + 1;
      }
      const next7: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const label = i === 0 ? 'today' : i === 1 ? 'tomorrow' : `+${i}d`;
        next7.push(`${key}(${label})=${buckets[key] ?? 0}`);
      }
      console.log(`[events] ${list.length} total cached; next 7 days: ${next7.join(', ')}`);
    };

    (async () => {
      const cached = await loadCachedEvents();
      if (cancelled) return;
      if (cached?.length) {
        // Low-priority: don't block the menu / chrome while pins paint.
        startTransition(() => {
          setEvents(cached);
          setLoading(false);
        });
        console.log(`[events] painted ${cached.length} from disk cache`);
        track('events_cache_loaded', { count: cached.length });
      }

      try {
        let lastPartialAt = 0;
        const list = await fetchAllEvents(rangeFor('all'), {
          onPartial: (partial) => {
            if (cancelled || partial.length === 0) return;
            const now = Date.now();
            // Partial feeds fire often; applying every burst re-mounts hundreds
            // of map markers and freezes chrome. Cap to ~2 paints / second.
            if (now - lastPartialAt < 450) return;
            lastPartialAt = now;
            startTransition(() => {
              setEvents((prev) => (partial.length >= prev.length ? partial : prev));
              setLoading(false);
            });
            track('events_partial_loaded', { count: partial.length });
          },
        });
        if (cancelled) return;
        // Final paint can wait until the open menu / gesture finishes.
        InteractionManager.runAfterInteractions(() => {
          if (cancelled) return;
          startTransition(() => {
            setEvents(list);
            setLoading(false);
            setLiveUpdatedAt(Date.now());
          });
          logCoverage(list);
          track('events_loaded', { count: list.length });
          void saveCachedEvents(list);
        });
      } catch (e) {
        if (cancelled) return;
        console.warn('[events] fetch failed', e);
        if (!cached?.length) {
          setErrorMsg('Could not load events. Pull to retry.');
        }
        track('events_load_failed');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showSplash]);

  // Pull live road incidents after splash so auth + chrome stay responsive.
  // We merge TfL (London proper) with National Highways (surrounding motorways
  // and major A-roads) so users see the full picture from their location into
  // and out of the city.
  // Last successful payload per source. Both fetchers swallow errors and
  // return [] — without this, one failed/rate-limited poll wiped every
  // incident pin off the map for 5 minutes and they'd "come and go"
  // (the live-traffic flicker Donnie reported on 1 July). An empty result is
  // treated as a failed poll and the previous good data is kept; London's
  // feeds are never genuinely empty.
  const lastGoodIncidentsRef = useRef<{
    tfl: TrafficIncident[];
    nh: TrafficIncident[];
  }>({ tfl: [], nh: [] });

  useEffect(() => {
    if (showSplash) return;

    let cancelled = false;
    // On a slow connection a poll can outlive the 3-minute interval. Without
    // this guard the next tick started anyway, so polls stacked up, hammered
    // TfL / AeroDataBox and churned state — the app got slower the longer it
    // stayed open.
    let inFlight = false;
    const load = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        await runLoad();
      } catch (e) {
        console.warn('[poll] live data refresh failed', e);
      } finally {
        inFlight = false;
      }
    };
    const runLoad = async () => {
      const [tfl, nh, lines] = await Promise.all([
        fetchTrafficIncidents(),
        fetchHighwaysIncidents(),
        fetchLineStatuses(),
      ]);
      if (cancelled) return;
      const last = lastGoodIncidentsRef.current;
      const tflList = tfl.length > 0 ? tfl : last.tfl;
      const nhList = nh.length > 0 ? nh : last.nh;
      lastGoodIncidentsRef.current = { tfl: tflList, nh: nhList };
      const merged = new Map<string, TrafficIncident>();
      for (const i of [...tflList, ...nhList]) merged.set(i.id, i);
      const incidentList = Array.from(merged.values());
      setIncidents(incidentList);
      if (Array.isArray(lines) && lines.length > 0) {
        setLineStatuses(lines as LineStatus[]);
      }
      setLiveUpdatedAt(Date.now());

      // Fire notifications once user prefs are loaded. We snapshot prefs
      // through prefsRef so the loop sees changes from the settings panel.
      // No account means no delivery at all, whatever is left in storage from
      // a previous session — notifications are an account feature.
      const prefs = hasAccountRef.current ? prefsRef.current : null;
      if (prefs) {
        diffAndNotifyIncidents(incidentList, prefs).catch(() => undefined);
        diffAndNotifyLines(lines as LineStatus[], prefs).catch(() => undefined);

        // Watched-flight delay/cancel pings — refresh FIDS only for airports
        // the user is actually watching (keeps AeroDataBox quota sane).
        if (prefs['saved-flights']) {
          const watchedMap = await loadSavedFlights();
          const watched = Object.values(watchedMap);
          if (watched.length > 0) {
            const airportIds = Array.from(
              new Set(watched.map((f) => f.airportId).filter(Boolean)),
            );
            const liveById: Record<string, import('@/services/aerodatabox').AirportFlight> =
              {};
            await Promise.all(
              airportIds.map(async (aid) => {
                const res = await fetchAirportFlights(aid);
                for (const f of res.flights) liveById[f.id] = f;
              }),
            );
            const updated = await diffAndNotifyFlights(liveById, watched, prefs);
            const next: SavedFlightMap = {};
            for (const f of updated) next[f.id] = f;
            await setJSON('driveiq.savedFlights.v1', next);
          }
        }
      }
    };
    // Bootstrap prefs once, then start the poll loop. The OS permission ask is
    // deferred to the account-gated effect below.
    (async () => {
      prefsRef.current = await loadPrefs();
      startNotificationOpenTracking();
      load();
    })();
    // 3-minute cadence: incidents / line closures / watched flights should
    // land close to real time without hammering the upstream feeds.
    const id = setInterval(load, 3 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showSplash]);

  // Apply both filters client-side over the cached week of events.
  // Deferred so opening the menu / tapping chrome stays urgent while a large
  // event list is still arriving — pins catch up a frame later.
  const deferredEvents = useDeferredValue(events);
  const filteredEvents = useMemo(() => {
    const range = rangeFor(filter);
    return deferredEvents.filter((e) => {
      if (!isPlausibleLondonEvent(e)) return false;
      if (!eventOverlapsRange(e.startsAt, e.endsAt, range)) return false;
      if (categories.size === 0) return true;
      return categories.has(categoryFilterFor(e));
    });
  }, [deferredEvents, filter, categories]);

  const { open: visibleEvents, locked: lockedEventsInFilter } = useMemo(
    () => splitEventsByPremium(filteredEvents, isPremium),
    [filteredEvents, isPremium],
  );

  useEffect(() => {
    track('map_filters_changed', {
      date_filter: filter,
      category_count: categories.size,
      visible_events: visibleEvents.length,
    });
  }, [filter, categories, visibleEvents.length]);

  // Two-level congestion handling (client spec, clarified 6 July 2026):
  //
  //  1. SAME LOCATION → one pin per venue. Events sharing coordinates
  //     (~11 m buckets) collapse into a single pin; tapping it lists all
  //     events there. The representative is the soonest-starting one
  //     (list is pre-sorted); featured wins so Wimbledon's gold pin shows.
  //  2. NEARBY VENUES ("10–20 events in a mile") → at city zoom the venue
  //     pins cluster into count bubbles; zooming in expands them to exact
  //     locations. Featured pins never enter a bubble.
  //
  // `venueGroupsRef` mirrors the memo so the press handler can stay
  // referentially stable (keeps the memoized pins from re-rendering).
  const venueGroupsRef = useRef<Map<string, AppEvent[]>>(new Map());
  const { venuePins, eventClusters } = useMemo(() => {
    const allGroups = new Map<string, AppEvent[]>();
    for (const e of filteredEvents) {
      const key = `${e.latitude.toFixed(4)}:${e.longitude.toFixed(4)}`;
      const bucket = allGroups.get(key);
      if (bucket) bucket.push(e);
      else allGroups.set(key, [e]);
    }
    const byRepId = new Map<string, AppEvent[]>();
    for (const members of allGroups.values()) {
      const rep = members.find((m) => m.source === 'featured') ?? members[0];
      byRepId.set(rep.id, members);
    }
    venueGroupsRef.current = byRepId;

    const groups = new Map<string, AppEvent[]>();
    for (const e of visibleEvents) {
      const key = `${e.latitude.toFixed(4)}:${e.longitude.toFixed(4)}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(e);
      else groups.set(key, [e]);
    }
    const featured: AppEvent[] = [];
    const regular: AppEvent[] = [];
    for (const members of groups.values()) {
      const rep = members.find((m) => m.source === 'featured') ?? members[0];
      if (rep.source === 'featured') featured.push(rep);
      else regular.push(rep);
    }

    const { clusters, singles } = clusterEvents(
      regular,
      mapRegion,
      (rep) => byRepId.get(rep.id)?.length ?? 1,
    );
    return { venuePins: [...featured, ...singles], eventClusters: clusters };
  }, [filteredEvents, visibleEvents, mapRegion]);

  // Tap a bubble → zoom into its footprint. If its venues are packed too
  // tight for fitToCoordinates to change anything, jump straight below the
  // clustering threshold so it breaks apart into venue pins.
  const handleClusterPress = useCallback((cluster: EventCluster) => {
    track('event_cluster_opened', { venue_count: cluster.events.length });
    const lats = cluster.events.map((e) => e.latitude);
    const lngs = cluster.events.map((e) => e.longitude);
    const span = Math.max(
      Math.max(...lats) - Math.min(...lats),
      Math.max(...lngs) - Math.min(...lngs),
    );
    if (span < 0.004) {
      mapRef.current?.animateToRegion(
        {
          latitude: cluster.latitude,
          longitude: cluster.longitude,
          latitudeDelta: CLUSTER_OFF_DELTA * 0.8,
          longitudeDelta: CLUSTER_OFF_DELTA * 0.8,
        },
        400,
      );
      return;
    }
    mapRef.current?.fitToCoordinates(
      cluster.events.map((e) => ({ latitude: e.latitude, longitude: e.longitude })),
      {
        edgePadding: { top: 220, right: 80, bottom: 200, left: 80 },
        animated: true,
      },
    );
  }, []);

  // Ordered filter chips: the four presets plus a scrollable strip of
  // individual future days. Built once on mount so the day labels stay stable.
  const filterChips = useMemo(() => buildFilterChips(), []);

  const lockedFilterKeys = useMemo(() => {
    if (isPremium) return [] as FilterKey[];
    return filterChips
      .filter(({ key }) => isPremiumDayFilter(key))
      .map(({ key }) => key);
  }, [filterChips, isPremium]);

  useEffect(() => {
    void hasProAccess().then(setIsPremium);
  }, [hasAccount, completedAction]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void (async () => {
      const { subscribePremiumChanges } = await import('@/services/purchases');
      unsub = subscribePremiumChanges((pro) => {
        if (pro) setIsPremium(true);
        else void hasProAccess().then(setIsPremium);
      });
    })();
    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (showSplash) return;
    void shouldShowWaitlistTrialEnd().then((show) => {
      if (show) setWaitlistTrialEndOpen(true);
    });
  }, [showSplash, hasAccount]);

  // Per-filter event counts for the FilterBar chip badges. Recomputed when
  // events or the category set change; filter chip never recomputes itself.
  const filterCounts = useMemo<Partial<Record<FilterKey, number>>>(() => {
    const out: Partial<Record<FilterKey, number>> = {};
    for (const { key } of filterChips) {
      const range = rangeFor(key);
      let n = 0;
      for (const e of deferredEvents) {
        if (!eventOverlapsRange(e.startsAt, e.endsAt, range)) continue;
        if (categories.size > 0 && !categories.has(categoryFilterFor(e))) continue;
        n++;
      }
      out[key] = n;
    }
    return out;
  }, [deferredEvents, categories, filterChips]);

  // When the date filter OR category set changes and we have visible events,
  // frame them in the viewport so the user doesn't have to play hide-and-seek
  // with a pin at Wembley / Twickenham / etc. Skip the framing when:
  //   - we're navigating or previewing a route (the route owns the camera)
  //   - neither filter has actually changed since last frame
  //   - the filtered list is empty (let the empty state speak for itself)
  const lastFramedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (isNavigating || destination) return;
    const catKey = Array.from(categories).sort().join(',') || 'all';
    const key = `${filter}|${catKey}`;
    if (lastFramedKeyRef.current === key) return;
    lastFramedKeyRef.current = key;
    if (!visibleEvents.length) return;
    if (!mapRef.current) return;

    if (visibleEvents.length === 1) {
      const only = visibleEvents[0];
      mapRef.current.animateToRegion(
        {
          latitude: only.latitude,
          longitude: only.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        },
        450,
      );
      return;
    }

    const coords = visibleEvents.map((e) => ({
      latitude: e.latitude,
      longitude: e.longitude,
    }));
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 200, right: 60, bottom: 180, left: 60 },
      animated: true,
    });
  }, [filter, categories, visibleEvents, isNavigating, destination]);

  const initialRegion = useMemo<Region>(() => {
    if (userLocation) {
      return {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.18,
        longitudeDelta: 0.18,
      };
    }
    return LONDON_REGION;
  }, [userLocation]);

  const toggleCategory = useCallback((key: CategoryFilterKey) => {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const resetCategories = useCallback(() => {
    setCategories(new Set());
  }, []);

  // Stable across renders so the memoized EventPin children don't re-render
  // (and re-rasterise) every time the parent updates. If the tapped pin
  // represents several events at the same location, open the venue list;
  // otherwise open the event details directly.
  const handlePinPress = useCallback((event: AppEvent) => {
    track('event_pin_tapped', { event_id: event.id, category: event.category });
    const group = venueGroupsRef.current.get(event.id);
    if (group && group.length > 1) {
      const split = splitEventsByPremium(group, isPremium);
      setVenueEvents(split.open.length ? split.open : null);
      setVenueLockedEvents(split.locked);
    } else if (!isPremium && isEventBeyondFreeHorizon(event.startsAt)) {
      showPremiumPaywall('Browse events beyond tomorrow', { source: 'event_pin' });
      return;
    } else {
      setSelected(event);
    }
    mapRef.current?.animateToRegion(
      {
        latitude: event.latitude,
        longitude: event.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      },
      350,
    );
  }, [isPremium]);

  // Hydrate saved events once on mount.
  useEffect(() => {
    let cancelled = false;
    loadSavedEvents().then((map) => {
      if (!cancelled) setSavedEvents(map);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Station pin tap always opens the hub. Saving/notifying is gated inside hub.
  const handleStationPress = useCallback((station: MajorStation) => {
    track('station_pin_tapped', { station_id: station.id });
    setStationHub(station);
  }, []);

  // Save / unsave an event. Saving also schedules the 1-hour-before reminder
  // (no-op if notifications aren't granted / available).
  // Doc task 09: first save requires an account.
  const handleToggleSave = useCallback(
    (event: AppEvent) => {
      requireAccount('save', () => {
        setSavedEvents((prev) => {
          const isSaved = event.id in prev;
          track(isSaved ? 'event_unsaved' : 'event_saved', {
            event_id: event.id,
            category: event.category,
          });
          if (isSaved) {
            const next = { ...prev };
            delete next[event.id];
            unsaveEvent(event.id).catch(() => undefined);
            return next;
          }
          saveEvent(event).catch(() => undefined);
          const prefs = prefsRef.current;
          if (prefs) scheduleEventReminder(event, prefs).catch(() => undefined);
          showDialog('Saved and reminding you', reminderDialogMessage(event));
          return { ...prev, [event.id]: event };
        });
      });
    },
    [requireAccount],
  );

  // Export an event to the device calendar (start + end + 1h alarm).
  const handleAddToCalendar = useCallback(
    async (event: AppEvent) => {
      requireAccount('add_to_calendar', () => {
        void (async () => {
          const res = await addEventToCalendar(event);
          track('event_calendar_attempted', {
            event_id: event.id,
            result: res.ok ? 'ok' : res.reason,
          });
          if (res.ok) {
            showDialog('Added to calendar', `“${event.title}” is in your calendar.`);
          } else if (res.reason === 'denied') {
            showDialog(
              'Calendar access needed',
              'Allow calendar access in Settings to add events.',
            );
          } else if (res.reason === 'unavailable') {
            showDialog(
              'Not available yet',
              'Calendar export turns on in the next build. Your event is still saved with a reminder.',
            );
          } else {
            showDialog('Could not add', 'Something went wrong adding to your calendar.');
          }
        })();
      });
    },
    [requireAccount],
  );

  // Hydrate community reports once on mount.
  useEffect(() => {
    let cancelled = false;
    loadReports().then((r) => {
      if (!cancelled) setReports(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Create a report at the current map centre.
  const handleSubmitReport = useCallback(
    (category: ReportCategory, note: string) => {
      const region = lastRegionRef.current;
      addReport({
        category,
        note: note || undefined,
        latitude: region.latitude,
        longitude: region.longitude,
      })
        .then((next) => {
          track('report_submitted', { category, has_note: Boolean(note) });
          setReports(next);
          setReportSheetOpen(false);
          showDialog(
            'Report added',
            `Thanks — your ${REPORT_META[category].label.toLowerCase()} report is on the map.`,
          );
        })
        .catch(() => setReportSheetOpen(false));
    },
    [],
  );

  // Tap an existing report → details + option to remove it.
  const handleReportPress = useCallback((report: UserReport) => {
    track('report_opened', { category: report.category, report_id: report.id });
    const meta = REPORT_META[report.category] ?? REPORT_META.other;
    const when = new Date(report.createdAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    showDialog(
      meta.label,
      `${report.note ? `${report.note}\n\n` : ''}Reported at ${when}`,
      [
        { label: 'Close', style: 'cancel' },
        {
          label: 'Remove',
          style: 'destructive',
          onPress: () =>
            removeReport(report.id).then(setReports).catch(() => undefined),
        },
      ],
    );
  }, []);

  const recenter = () => {
    track('map_recenter_tapped');
    const target = userLocation ?? {
      latitude: LONDON_REGION.latitude,
      longitude: LONDON_REGION.longitude,
    };
    mapRef.current?.animateToRegion(
      {
        ...target,
        latitudeDelta: 0.18,
        longitudeDelta: 0.18,
      },
      400,
    );
  };

  // Pull a fresh location read in case the cached one is stale (the user
  // may have moved between mount and tapping "Get directions").
  const ensureLocation = useCallback(async (): Promise<LatLng | null> => {
    if (userLocation) return userLocation;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const fresh: LatLng = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
      setUserLocation(fresh);
      return fresh;
    } catch (e) {
      console.warn('[location] re-read failed', e);
      return null;
    }
  }, [userLocation]);

  const startRouting = useCallback(
    async (dest: Destination) => {
      track('route_requested', { destination_kind: dest.kind });
      const origin = await ensureLocation();
      if (!origin) {
        showDialog(
          'Location required',
          'We need your location to plan a route. Enable location access in Settings and try again.',
        );
        return;
      }

      setSelected(null);
      setSelectedIncident(null);
      setAirportsOpen(false);
      setDestination(dest);
      setRoutes([]);
      setSelectedRouteIdx(0);
      setRouteError(null);
      setRouteLoading(true);

      const result = await fetchRoutes(origin, {
        latitude: dest.latitude,
        longitude: dest.longitude,
      });

      setRouteLoading(false);
      if (result.error) {
        track('route_failed', { destination_kind: dest.kind });
        setRouteError(result.error);
        setRoutes([]);
        // Still centre on the destination so it's visible.
        mapRef.current?.animateToRegion(
          {
            latitude: dest.latitude,
            longitude: dest.longitude,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
          },
          400,
        );
        return;
      }

      setRoutes(result.routes);
      track('route_loaded', {
        destination_kind: dest.kind,
        route_count: result.routes.length,
      });
      setSelectedRouteIdx(0);

      // Fit both endpoints + the fastest route's polyline into view.
      const fastest = result.routes[0];
      const fitCoords: LatLng[] = [
        origin,
        { latitude: dest.latitude, longitude: dest.longitude },
        ...(fastest?.polyline ?? []),
      ];
      if (fitCoords.length > 0) {
        mapRef.current?.fitToCoordinates(fitCoords, {
          edgePadding: { top: 120, right: 60, bottom: 240, left: 60 },
          animated: true,
        });
      }
    },
    [ensureLocation],
  );

  const handleSelectRoute = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= routes.length) return;
      track('route_alternative_selected', { index: idx + 1 });
      setSelectedRouteIdx(idx);
      const route = routes[idx];
      if (route?.polyline?.length && userLocation && destination) {
        mapRef.current?.fitToCoordinates(
          [
            userLocation,
            { latitude: destination.latitude, longitude: destination.longitude },
            ...route.polyline,
          ],
          {
            edgePadding: { top: 120, right: 60, bottom: 240, left: 60 },
            animated: true,
          },
        );
      }
    },
    [routes, userLocation, destination],
  );

  const clearRoute = useCallback(() => {
    track('route_cleared');
    setDestination(null);
    setRoutes([]);
    setSelectedRouteIdx(0);
    setRouteLoading(false);
    setRouteError(null);
    setIsNavigating(false);
    setNavUserPos(null);
    setCurrentStepIdx(0);
    setCameraDetached(false);
    setOffRoute(false);
  }, []);

  // Currently-active route + step for the navigation overlay.
  const activeRoute = routes[selectedRouteIdx] ?? null;
  const steps = activeRoute?.steps ?? [];
  const currentStep: RouteStep | null = steps[currentStepIdx] ?? null;
  const nextStep: RouteStep | null = steps[currentStepIdx + 1] ?? null;

  /**
   * Distance from the user to the end of the current step. Falls back to
   * the step's full length until we have a live nav position fix.
   */
  const distanceToTurnMeters = useMemo(() => {
    if (!currentStep) return 0;
    const ref = navUserPos ?? userLocation;
    if (!ref) return currentStep.distanceMeters;
    return distanceMeters(ref, currentStep.endLocation);
  }, [currentStep, navUserPos, userLocation]);

  /** Sum of remaining step distances from currentStepIdx onward. */
  const remainingDistanceMeters = useMemo(() => {
    if (!steps.length) return activeRoute?.distanceMeters ?? 0;
    let total = 0;
    for (let i = currentStepIdx; i < steps.length; i++) {
      total += steps[i].distanceMeters;
    }
    // Replace the current step's distance with the user's actual distance
    // to its end so the figure shrinks smoothly as they approach.
    if (currentStep) {
      total = total - currentStep.distanceMeters + distanceToTurnMeters;
    }
    return Math.max(0, total);
  }, [steps, currentStepIdx, currentStep, distanceToTurnMeters, activeRoute]);

  /** Same approach for remaining time, scaled by the route's avg pace. */
  const remainingSeconds = useMemo(() => {
    if (!activeRoute) return 0;
    const totalDist = activeRoute.distanceMeters || 1;
    const totalDur = activeRoute.durationInTrafficSeconds;
    const ratio = remainingDistanceMeters / totalDist;
    return Math.max(0, Math.round(totalDur * ratio));
  }, [activeRoute, remainingDistanceMeters]);

  /**
   * Live location + heading watcher. Only active during navigation.
   * Each location fix advances the current step (when within ~30 m of its
   * endpoint), nudges `setUserLocation` so the user dot stays accurate,
   * and — if the camera is still attached — re-centres the map with the
   * current heading and a ~17 zoom + 50° pitch (Google Maps style).
   */
  useEffect(() => {
    if (!isNavigating) return;

    let cancelled = false;
    let posSub: Location.LocationSubscription | null = null;
    let headSub: Location.LocationSubscription | null = null;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) {
          setIsNavigating(false);
          return;
        }

        posSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 5,
            timeInterval: 1000,
          },
          (pos) => {
            if (cancelled) return;
            const here: LatLng = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            };
            setNavUserPos(here);
            setUserLocation(here);
            // GPS heading (course over ground) is more reliable than the
            // compass at speed; fall back to the compass watcher otherwise.
            const courseHeading = pos.coords.heading;
            if (courseHeading != null && courseHeading >= 0 && pos.coords.speed && pos.coords.speed > 1) {
              setUserHeading(courseHeading);
            }
          },
        );

        // Cleanup may already have run while the await above was pending; in
        // that case remove immediately or the watcher leaks for the rest of
        // the session (battery drain + stale camera moves after exiting nav).
        if (cancelled) {
          posSub.remove();
          posSub = null;
          return;
        }

        headSub = await Location.watchHeadingAsync((h) => {
          if (cancelled) return;
          // trueHeading is preferred; fall back to magHeading.
          const value = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (Number.isFinite(value)) setUserHeading(value);
        });
        if (cancelled) {
          headSub.remove();
          headSub = null;
        }
      } catch (e) {
        console.warn('[nav] watchers failed', e);
      }
    })();

    return () => {
      cancelled = true;
      posSub?.remove();
      headSub?.remove();
      posSub = null;
      headSub = null;
    };
  }, [isNavigating]);

  // Advance step, detect off-route, drive the camera. Runs whenever the
  // live nav position or heading changes.
  useEffect(() => {
    if (!isNavigating || !navUserPos || !activeRoute) return;

    // Step advancement: within 25 m of the current step's end, jump to next.
    if (currentStep) {
      const toEnd = distanceMeters(navUserPos, currentStep.endLocation);
      if (toEnd < 25 && currentStepIdx < steps.length - 1) {
        setCurrentStepIdx((i) => Math.min(i + 1, steps.length - 1));
      }
    }

    // Off-route detection: if user is > 80 m from any point on the route
    // polyline, flag it. Cheap O(N) check — fine for typical routes.
    const points = activeRoute.polyline;
    if (points.length > 0) {
      let minDist = Infinity;
      for (const p of points) {
        const d = distanceMeters(navUserPos, p);
        if (d < minDist) minDist = d;
        if (minDist < 30) break;
      }
      setOffRoute(minDist > 80);
    }

    // Drive the camera while attached.
    if (!cameraDetached && mapRef.current) {
      mapRef.current.animateCamera(
        {
          center: navUserPos,
          heading: userHeading,
          pitch: 50,
          zoom: 17,
        },
        { duration: 600 },
      );
    }
  }, [
    isNavigating,
    navUserPos,
    userHeading,
    activeRoute,
    currentStep,
    currentStepIdx,
    steps.length,
    cameraDetached,
  ]);

  const startNavigation = useCallback(() => {
    if (!activeRoute) return;
    track('navigation_started');
    setCurrentStepIdx(0);
    setCameraDetached(false);
    setOffRoute(false);
    setIsNavigating(true);
    if (userLocation && mapRef.current) {
      mapRef.current.animateCamera(
        {
          center: userLocation,
          heading: userHeading,
          pitch: 50,
          zoom: 17,
        },
        { duration: 600 },
      );
    }
  }, [activeRoute, userLocation, userHeading]);

  const recenterNav = useCallback(() => {
    track('navigation_recenter_tapped');
    setCameraDetached(false);
    const ref = navUserPos ?? userLocation;
    if (ref && mapRef.current) {
      mapRef.current.animateCamera(
        { center: ref, heading: userHeading, pitch: 50, zoom: 17 },
        { duration: 500 },
      );
    }
  }, [navUserPos, userLocation, userHeading]);

  const exitNavigation = useCallback(() => {
    track('navigation_exited');
    setIsNavigating(false);
    clearRoute();
    if (userLocation && mapRef.current) {
      // Reset camera back to flat London view.
      mapRef.current.animateCamera(
        { center: userLocation, heading: 0, pitch: 0, zoom: 14 },
        { duration: 500 },
      );
    }
  }, [clearRoute, userLocation]);

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={MAP_PROVIDER}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        // Live road-flow overlay from the maps API, tied to the Traffic layer
        // toggle (same switch that shows the incident pins).
        showsTraffic={layers.traffic}
        showsUserLocation={userLocation != null}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        showsCompass={!isNavigating}
        rotateEnabled
        pitchEnabled
        // While navigating we want the user's pan to detach the camera so
        // they can peek without the auto-recentre fighting them.
        onPanDrag={() => {
          if (isNavigating) setCameraDetached(true);
        }}
        // Fires once per completed gesture: keep the ref for report drops and
        // commit the region to state so the pins re-cluster for the new zoom.
        onRegionChangeComplete={(r) => {
          lastRegionRef.current = r;
          setMapRegion(r);
          // Re-rasterising every custom marker is expensive (it's a native
          // snapshot per pin), and the blank-bitmap bug it heals only shows up
          // when the zoom changes. Panning at a fixed zoom no longer triggers
          // it, which is what made every gesture feel sluggish.
          const prev = rasterZoomRef.current;
          const changed = Math.abs(r.latitudeDelta - prev) / Math.max(prev, 1e-6);
          if (changed > 0.15) {
            rasterZoomRef.current = r.latitudeDelta;
            setRasterEpoch((n) => n + 1);
          }
        }}
      >
        {/*
         * While a destination is active (preview or live nav), suppress all
         * other markers so the from / to points are the only things visible
         * besides the route polyline.
         */}
        {!destination && layers.events &&
          venuePins.map((event) => (
            <EventPin
              key={event.id}
              event={event}
              selected={selected?.id === event.id}
              onPress={handlePinPress}
              rasterEpoch={rasterEpoch}
            />
          ))}

        {/* Count bubbles over dense areas at city zoom — split into venue
            pins as the user zooms in (or taps a bubble). */}
        {!destination && layers.events &&
          eventClusters.map((cluster) => (
            <ClusterPin key={cluster.id} cluster={cluster} onPress={handleClusterPress} />
          ))}

        {/* Airport pins (LHR/LGW/LTN/STN/LCY) → tap opens the live flights board. */}
        {!destination &&
          AIRPORTS.map((a) => (
            <AirportPin
              key={`airport-${a.id}`}
              airport={a}
              onPress={setFlightsAirport}
              rasterEpoch={rasterEpoch}
            />
          ))}

        {/* Major rail termini → tap opens the live line board (free users get
            one station of their choice; the rest are Pro). */}
        {!destination &&
          MAJOR_STATIONS.map((s) => (
            <StationPin
              key={`station-${s.id}`}
              station={s}
              onPress={handleStationPress}
              rasterEpoch={rasterEpoch}
            />
          ))}

        {!destination &&
          reports.map((report) => (
            <Marker
              key={report.id}
              coordinate={{ latitude: report.latitude, longitude: report.longitude }}
              onPress={() => handleReportPress(report)}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={false}
            >
              <ReportMarker category={report.category} />
            </Marker>
          ))}

        {!destination && layers.traffic &&
          majorIncidents.map((inc) => (
            <Marker
              key={`traffic-${inc.id}`}
              coordinate={{ latitude: inc.latitude, longitude: inc.longitude }}
              onPress={() => setSelectedIncident(inc)}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <TrafficMarker
                color={incidentColor(inc.severity)}
                iconName={incidentIconName(inc.category, inc.hasClosures)}
                selected={selectedIncident?.id === inc.id}
              />
            </Marker>
          ))}

        {/*
         * Route polylines. Render unselected alternatives first (gray) so
         * the selected route paints on top — and the selected route is drawn
         * as traffic-coloured per-step segments to match the live conditions.
         */}
        {routes.map((route, index) => {
          if (index === selectedRouteIdx) return null;
          return (
            <Polyline
              key={`alt-${route.id}`}
              coordinates={route.polyline}
              strokeColor="#9CA3AF"
              strokeWidth={5}
              tappable
              onPress={() => handleSelectRoute(index)}
              lineCap="round"
              lineJoin="round"
              zIndex={50}
            />
          );
        })}
        {routes[selectedRouteIdx]?.stepSegments.length ? (
          <>
            {routes[selectedRouteIdx].stepSegments.map((seg) => (
              <Polyline
                key={`seg-${seg.id}`}
                coordinates={seg.coords}
                strokeColor={trafficColor(seg.trafficLevel)}
                strokeWidth={7}
                lineCap="round"
                lineJoin="round"
                zIndex={100}
              />
            ))}
          </>
        ) : routes[selectedRouteIdx]?.polyline.length ? (
          <Polyline
            coordinates={routes[selectedRouteIdx].polyline}
            strokeColor={colors.primary}
            strokeWidth={7}
            lineCap="round"
            lineJoin="round"
            zIndex={100}
          />
        ) : null}

        {destination ? (
          <Marker
            coordinate={{
              latitude: destination.latitude,
              longitude: destination.longitude,
            }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
          >
            <View style={styles.destinationPin}>
              <View style={styles.destinationPinInner} />
            </View>
          </Marker>
        ) : null}
      </MapView>

      {showSplash ? (
        <SplashLoading
          ready={!initializing}
          onDone={() => setShowSplash(false)}
        />
      ) : null}

      {/* Top chrome sits above splash for hit-testing, but stays invisible
          until splash is done so the brand mark isn't double-shown. */}
      {!destination && !showSplash ? (
        <SafeAreaView edges={['top']} style={styles.topOverlay} pointerEvents="box-none">
          <View style={styles.brandRow}>
            <Pressable
              onPress={() => {
                track('sidebar_opened');
                setSidebarOpen(true);
              }}
              style={({ pressed }) => [
                styles.menuBtn,
                pressed && styles.menuBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open menu"
              hitSlop={8}
            >
              <Ionicons name="menu" size={22} color={colors.textOnPrimary} />
            </Pressable>
            <View style={styles.brandPill}>
              <View style={styles.brandLogoBadge}>
                <Image
                  source={BRAND_LOGO}
                  resizeMode="contain"
                  style={styles.brandLogo}
                  accessibilityIgnoresInvertColors
                />
              </View>
              <Text style={styles.brandText}>DriveIQ</Text>
            </View>
          </View>
          <FilterBar
            active={filter}
            onChange={(next) => {
              track('date_filter_selected', { filter: next });
              setFilter(next);
            }}
            chips={filterChips}
            counts={filterCounts}
            lockedKeys={lockedFilterKeys}
          />
          <CategoryFilterBar
            selected={categories}
            onToggle={(key) => {
              track('category_filter_toggled', { category: key });
              toggleCategory(key);
            }}
            onReset={() => {
              track('category_filters_reset');
              resetCategories();
            }}
          />
        </SafeAreaView>
      ) : null}

      {!destination ? (
        <SafeAreaView edges={['bottom']} style={styles.bottomOverlay} pointerEvents="box-none">
          {loading && (
            <View style={styles.loadingPill}>
              <ActivityIndicator color={colors.textOnPrimary} />
              <Text style={styles.loadingText}>Loading events…</Text>
            </View>
          )}
          {!loading && liveUpdatedAt ? (
            <View style={styles.stalePill}>
              <Text style={styles.staleText}>{formatStaleLabel(liveUpdatedAt)}</Text>
            </View>
          ) : null}
          {!loading &&
          !visibleEvents.length &&
          lockedEventsInFilter.length > 0 &&
          !isPremium ? (
            <View style={styles.quietEmptyPill}>
              <Text style={styles.quietEmptyText}>
                Nothing free to show on this day. {lockedEventsInFilter.length} event
                {lockedEventsInFilter.length === 1 ? '' : 's'} need Premium.
              </Text>
            </View>
          ) : null}
          {!isPremium && lockedEventsInFilter.length > 0 && !loading ? (
            <View style={styles.upgradeWrap}>
              <PremiumInlineBar
                feature="Browse events beyond tomorrow"
                source="map_filter"
                message={`${lockedEventsInFilter.length} event${lockedEventsInFilter.length === 1 ? '' : 's'} on this day need DriveIQ Premium. Today and tomorrow stay free.`}
              />
            </View>
          ) : null}
          {errorMsg && !loading && (
            <View style={styles.errorPill}>
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}
        </SafeAreaView>
      ) : null}

      {!destination && (
      <MapActionStack
        bottomOffset={90}
        primaryAction={{
          key: 'recenter',
          label: 'Re-centre map',
          icon: 'locate',
          onPress: recenter,
        }}
        actions={[
          {
            key: 'report',
            label: 'Report something',
            icon: 'add-circle',
            onPress: () => {
              track('report_sheet_opened');
              setReportSheetOpen(true);
            },
            active: reportSheetOpen,
          },
          {
            key: 'connections',
            label: 'Live transit connections',
            icon: 'train',
            onPress: () => {
              track('connections_panel_opened');
              setConnectionsOpen(true);
            },
            active: connectionsOpen,
          },
          {
            key: 'airports',
            label: 'London airports',
            icon: 'airplane',
            onPress: () => {
              track('airports_panel_opened');
              setAirportsOpen(true);
            },
            active: airportsOpen,
          },
          {
            key: 'roads',
            label: 'Road corridors',
            icon: 'car-sport',
            onPress: () => {
              track('roads_panel_opened');
              setRoadsOpen(true);
            },
            active: roadsOpen,
            badge: majorIncidents.length,
          },
          {
            key: 'traffic',
            label: layers.traffic ? 'Live traffic on' : 'Live traffic',
            icon: layers.traffic ? 'car' : 'car-outline',
            onPress: () => toggleLayer('traffic'),
            active: layers.traffic,
            badge: layers.traffic ? majorIncidents.length : 0,
          },
          {
            key: 'layers',
            label: 'Map layers',
            icon: 'layers',
            onPress: () => {
              track('layers_panel_opened');
              setLayersOpen(true);
            },
            active: layersOpen,
          },
          {
            key: 'notifications',
            label: 'Notifications',
            icon: 'notifications',
            onPress: () => {
              track('notification_settings_opened');
              setNotifSettingsOpen(true);
            },
            active: notifSettingsOpen,
          },
        ]}
      />
      )}

      <VenueEventsSheet
        events={venueEvents}
        lockedEvents={venueLockedEvents}
        onClose={() => {
          setVenueEvents(null);
          setVenueLockedEvents([]);
        }}
        onPickEvent={(event) => {
          track('venue_event_selected', { event_id: event.id, category: event.category });
          setVenueEvents(null);
          setVenueLockedEvents([]);
          setSelected(event);
        }}
      />

      <EventDetailsSheet
        event={selected}
        userLocation={userLocation}
        saved={selected ? selected.id in savedEvents : false}
        onToggleSave={handleToggleSave}
        onAddToCalendar={handleAddToCalendar}
        onClose={() => setSelected(null)}
        onNavigate={(event) => {
          track('event_navigate_tapped', { event_id: event.id, category: event.category });
          setSelected(null);
          setPickerDestination({
            label: event.title,
            latitude: event.latitude,
            longitude: event.longitude,
          });
        }}
      />

      <ReportSheet
        visible={reportSheetOpen}
        onClose={() => setReportSheetOpen(false)}
        onSubmit={handleSubmitReport}
      />

      <TrafficIncidentSheet
        incident={selectedIncident}
        onClose={() => setSelectedIncident(null)}
        onNavigate={(inc) => {
          track('traffic_navigate_tapped', { incident_id: inc.id, severity: inc.severity });
          setSelectedIncident(null);
          setPickerDestination({
            label: inc.location ?? `${inc.severity} incident`,
            latitude: inc.latitude,
            longitude: inc.longitude,
          });
        }}
      />

      <RoadsPanel
        visible={roadsOpen}
        incidents={majorIncidents}
        onClose={() => setRoadsOpen(false)}
        onNavigate={(inc) => {
          setRoadsOpen(false);
          setPickerDestination({
            label: inc.location ?? `${inc.severity} incident`,
            latitude: inc.latitude,
            longitude: inc.longitude,
          });
        }}
      />

      <LayerControlPanel
        visible={layersOpen}
        onClose={() => setLayersOpen(false)}
        layers={layers}
        onToggle={toggleLayer}
      />

      <ConnectionsPanel
        visible={connectionsOpen}
        onClose={() => setConnectionsOpen(false)}
        onOpenStation={(station) => {
          setStationHub(station);
        }}
      />

      {/* First-launch onboarding popup. Renders nothing once the user has
          made their initial choice; can still be opened anytime via the
          Notifications panel in the action stack. */}
      <OnboardingTour
        onDone={(reason) => {
          setTourDone(true);
          if (reason === 'completed') setSignupInviteEligible(true);
          else void markSignupInviteSeen();
        }}
      />

      <NotificationOnboarding
        open={notifPrimingOpen}
        onDone={async () => {
          setNotifPrimingOpen(false);
          prefsRef.current = await loadPrefs();
        }}
      />

      <WaitlistTrialEndSheet
        visible={waitlistTrialEndOpen}
        onClose={() => {
          void markWaitlistTrialEndSeen();
          setWaitlistTrialEndOpen(false);
        }}
      />

      <SidebarMenu
        visible={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenNotifications={() => {
          track('notification_settings_opened', { source: 'sidebar' });
          setNotifSettingsOpen(true);
        }}
        onOpenAuth={(mode) => {
          track('auth_sheet_opened', { mode, source: 'sidebar' });
          setAuthSheet({ open: true, mode });
        }}
        onOpenAccount={(section) => {
          track('account_sheet_opened', { section, source: 'sidebar' });
          setAccountSheet({ open: true, section });
        }}
        onOpenHelp={() => {
          track('help_opened');
          setHelpOpen(true);
        }}
        onOpenFeedback={() => {
          track('feedback_opened');
          setFeedbackOpen(true);
        }}
        onOpenAbout={() => {
          track('about_opened');
          setAboutOpen(true);
        }}
        onOpenAISupport={() => {
          track('ai_support_opened', { source: 'sidebar' });
          setAiSupportOpen(true);
        }}
      />

      <HelpSheet
        visible={helpOpen}
        onClose={() => setHelpOpen(false)}
        onOpenAISupport={() => {
          setHelpOpen(false);
          setTimeout(() => setAiSupportOpen(true), 250);
        }}
      />
      <FeedbackSheet visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <AboutSheet visible={aboutOpen} onClose={() => setAboutOpen(false)} />
      <AISupportSheet
        visible={aiSupportOpen}
        onClose={() => setAiSupportOpen(false)}
        events={events}
        incidents={majorIncidents}
        lines={lineStatuses}
        onSaveEvent={(event) => {
          if (!(event.id in savedEvents)) handleToggleSave(event);
        }}
        onAddToCalendar={handleAddToCalendar}
      />

      <AccountSheet
        visible={accountSheet.open}
        section={accountSheet.section}
        onClose={() => setAccountSheet((s) => ({ ...s, open: false }))}
      />

      <NotificationSettingsPanel
        visible={notifSettingsOpen}
        onClose={async () => {
          setNotifSettingsOpen(false);
          // Re-read prefs so the next poll picks up the user's changes.
          prefsRef.current = await loadPrefs();
        }}
      />

      <StationHubSheet
        station={stationHub}
        onClose={() => setStationHub(null)}
        onFirstStationSaved={() => {
          void (async () => {
            const seen = await hasSeenOnboarding();
            if (!seen) setNotifPrimingOpen(true);
          })();
        }}
        onNavigate={(station) => {
          track('station_hub_navigate', { station_id: station.id });
          setStationHub(null);
          setConnectionsOpen(false);
          mapRef.current?.animateToRegion(
            {
              latitude: station.latitude,
              longitude: station.longitude,
              latitudeDelta: 0.04,
              longitudeDelta: 0.04,
            },
            500,
          );
          setDestination({
            kind: 'station',
            label: station.name,
            latitude: station.latitude,
            longitude: station.longitude,
          });
        }}
      />

      <AirportFlightsSheet
        airport={flightsAirport}
        onClose={() => setFlightsAirport(null)}
        onNavigate={(airport) => {
          track('airport_navigate_tapped', { airport_id: airport.id, source: 'sheet' });
          setFlightsAirport(null);
          setPickerDestination({
            label: airport.name,
            latitude: airport.latitude,
            longitude: airport.longitude,
          });
        }}
      />

      <AirportsPanel
        visible={airportsOpen}
        onClose={() => setAirportsOpen(false)}
        onPickAirport={(latitude, longitude) => {
          mapRef.current?.animateToRegion(
            { latitude, longitude, latitudeDelta: 0.06, longitudeDelta: 0.06 },
            450,
          );
        }}
        onNavigate={(airport) => {
          track('airport_navigate_tapped', { airport_id: airport.id, source: 'panel' });
          setAirportsOpen(false);
          setPickerDestination({
            label: airport.name,
            latitude: airport.latitude,
            longitude: airport.longitude,
          });
        }}
      />

      {/* Route preview card (fastest + alternatives, then "Start") */}
      {!isNavigating ? (
        <RouteInfoPanel
          visible={destination != null}
          loading={routeLoading}
          error={routeError}
          routes={routes}
          selectedIndex={selectedRouteIdx}
          destinationLabel={destination?.label ?? null}
          onSelect={handleSelectRoute}
          onClose={clearRoute}
          onStart={startNavigation}
        />
      ) : null}

      {/* Turn-by-turn HUD once the user hits "Start" */}
      {isNavigating ? (
        <NavigationOverlay
          currentStep={currentStep}
          nextStep={nextStep}
          distanceToTurnMeters={distanceToTurnMeters}
          remainingDistanceMeters={remainingDistanceMeters}
          remainingSeconds={remainingSeconds}
          cameraDetached={cameraDetached}
          offRoute={offRoute}
          onRecenter={recenterNav}
          onExit={exitNavigation}
        />
      ) : null}

      {/* App picker — DriveIQ / Google Maps / Waze / Apple Maps */}
      <NavigationAppPicker
        destination={pickerDestination}
        onClose={() => setPickerDestination(null)}
        onPickDriveIQ={(dest) => {
          startRouting({
            kind: 'event',
            label: dest.label,
            latitude: dest.latitude,
            longitude: dest.longitude,
          });
        }}
      />

      {/* Keep auth sheet last so it always appears above other modals. */}
      <AuthSheet
        visible={authSheet.open || accountPrompt.open || signupInvite}
        initialMode={
          accountPrompt.open
            ? accountPrompt.mode
            : signupInvite
              ? 'signup'
              : authSheet.mode
        }
        reason={accountPrompt.open ? accountPrompt.reason : null}
        quietSkip={signupInvite && !accountPrompt.open && !authSheet.open}
        onSkip={() => {
          void markSignupInviteSeen();
          setSignupInvite(false);
        }}
        onClose={() => {
          if (accountPrompt.open) closeAccountPrompt();
          setAuthSheet((s) => ({ ...s, open: false }));
          if (signupInvite) {
            void markSignupInviteSeen();
            setSignupInvite(false);
          }
        }}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 8,
    gap: 6,
    // Above splash (50) so the menu is always hit-testable.
    zIndex: 200,
    elevation: 200,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 16,
    marginBottom: 4,
    gap: 8,
  },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  menuBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 12,
    paddingRight: 16,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.primary,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  // White disc behind the logo so the brand mark reads cleanly on the blue pill.
  brandLogoBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLogo: {
    width: 15,
    height: 18,
  },
  brandText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 16,
  },
  loadingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.primary,
    marginBottom: 10,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  loadingText: {
    color: colors.textOnPrimary,
    fontWeight: '600',
  },
  stalePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  staleText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  upgradeWrap: {
    width: '92%',
    marginBottom: 8,
  },
  quietEmptyPill: {
    width: '92%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quietEmptyText: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  errorPill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.accent,
    marginBottom: 10,
  },
  errorText: {
    color: colors.textOnPrimary,
    fontWeight: '600',
  },
  destinationPin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surface,
    borderWidth: 4,
    borderColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  destinationPinInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
});
