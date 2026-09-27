import { describe, expect, it } from 'vitest';

import {
  classifyAgentIntent,
  wantsCatalogueLookup,
  wantsEventContext,
  wantsFlightContext,
} from './agentIntent.js';

describe('classifyAgentIntent', () => {
  it('treats tube and traffic asks as travel', () => {
    expect(classifyAgentIntent('Any delays on the Central line?')).toBe('travel');
    expect(classifyAgentIntent('How is the M25 looking?')).toBe('travel');
    expect(classifyAgentIntent('Flights into Heathrow this afternoon')).toBe('travel');
  });

  it('treats whats-on asks as events', () => {
    expect(classifyAgentIntent("What's on tonight?")).toBe('events');
    expect(classifyAgentIntent('Arsenal kick off time')).toBe('events');
    expect(classifyAgentIntent('Anything big near me')).toBe('events');
  });

  it('keeps both slices when they ask for travel and events', () => {
    expect(classifyAgentIntent("What's on tonight and how are the roads?")).toBe('mixed');
    expect(classifyAgentIntent('Arsenal tonight, any tube delays?')).toBe('mixed');
  });

  it('does not starve unknown questions', () => {
    expect(classifyAgentIntent('Hello')).toBe('mixed');
  });

  it('honours an events refusal as travel when they also asked about roads', () => {
    expect(classifyAgentIntent("Don't want events, just the traffic")).toBe('travel');
  });
});

describe('context gates', () => {
  it('drops events and catalogue on travel, flights on events-only', () => {
    expect(wantsEventContext('travel')).toBe(false);
    expect(wantsCatalogueLookup('travel')).toBe(false);
    expect(wantsFlightContext('travel')).toBe(true);

    expect(wantsEventContext('events')).toBe(true);
    expect(wantsCatalogueLookup('events')).toBe(true);
    expect(wantsFlightContext('events')).toBe(false);

    expect(wantsEventContext('mixed')).toBe(true);
    expect(wantsFlightContext('mixed')).toBe(true);
  });
});
