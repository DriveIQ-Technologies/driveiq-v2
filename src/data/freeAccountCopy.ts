import type { Ionicons } from '@expo/vector-icons';

export type FreeAccountItem = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
  title: string;
  body: string;
};

export const FREE_ACCOUNT_ITEMS: FreeAccountItem[] = [
  {
    icon: 'map',
    tint: '#4CA9FF',
    title: 'The live London map',
    body: 'Events, roads and rail on the map. Browse without paying.',
  },
  {
    icon: 'bookmark',
    tint: '#26C281',
    title: 'Saves and reminders',
    body: 'Pin events and get a ping 1 hour before start, 25 minutes before crowds leave.',
  },
  {
    icon: 'notifications',
    tint: '#FF7E47',
    title: 'Road, rail and flight alerts',
    body: 'Turn on Notifications and we ping disruption as it happens. Same speed as Premium.',
  },
  {
    icon: 'sparkles',
    tint: '#A78BFA',
    title: '10 AI questions a day',
    body: 'Ask what is on tonight, which roads are slow, or when a gig finishes. Resets at midnight London time.',
  },
];

export const FREE_ACCOUNT_LIMITS: FreeAccountItem[] = [
  {
    icon: 'airplane-outline',
    tint: '#4CA9FF',
    title: 'Flights stop at 3 hours',
    body: 'Free shows the next 3 hours at one airport. All-day boards are Premium.',
  },
  {
    icon: 'calendar-outline',
    tint: '#26C281',
    title: 'Tonight and tomorrow',
    body: 'The AI and map cover the next couple of days. Weeks ahead is Premium.',
  },
  {
    icon: 'train-outline',
    tint: '#FF7E47',
    title: 'One station hub for 7 days',
    body: 'Free saves one hub. You can turn alerts off, but switching to another hub waits 7 days — or Premium.',
  },
];

export type AccountReadyInfo = {
  name: string;
  email: string;
  /** true = sent, false = failed, null = not needed (Apple / Google). */
  verificationSent: boolean | null;
};
