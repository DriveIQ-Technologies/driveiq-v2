const { fetchLineStatuses, fetchLineDetail } = await import('../src/services/tflLines.ts');
const { fetchAirportConnectionStatuses } = await import('../src/services/airports.ts');

const lines = await fetchLineStatuses();
console.log('NON-GOOD LINES');
for (const l of lines.filter((x) => x.severityBucket !== 'good')) {
  console.log(`${l.id} | ${l.name} | ${l.severityBucket} | ${l.statusDescription} | ${(l.reason||'').slice(0,120)}`);
}

console.log('\nAIRPORT CONNECTIONS');
const airports = await fetchAirportConnectionStatuses();
for (const [id, conns] of Object.entries(airports)) {
  for (const c of conns) {
    if (c.severityBucket !== 'good') {
      console.log(`${id} | ${c.lineId} | ${c.label} | ${c.severityBucket} | ${c.statusDescription} | ${(c.reason||'').slice(0,120)}`);
    }
  }
}

console.log('\nDETAIL southern');
const southern = await fetchLineDetail('southern');
console.log(JSON.stringify(southern, null, 2));
