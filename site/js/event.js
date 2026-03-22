// === Event Views ===

async function renderEvents() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">Loading events...</div>';

  let meta;
  try {
    meta = await fetchJSON('meta.json');
  } catch (e) {
    app.innerHTML = '<div class="loading">No event data available yet.</div>';
    return;
  }

  const events = (meta.events || []).sort((a, b) => {
    // Parse year from event dates or code
    const getYear = (e) => {
      const match = (e.eventDates || e.eventCode || '').match(/(\d{4})/);
      return match ? parseInt(match[1]) : 0;
    };
    const yearA = getYear(a);
    const yearB = getYear(b);
    // Sort by year descending
    if (yearB !== yearA) return yearB - yearA;
    // Within same year, nationals first
    if (a.eventType === 'nationals' && b.eventType !== 'nationals') return -1;
    if (b.eventType === 'nationals' && a.eventType !== 'nationals') return 1;
    // Then by date descending
    return (b.eventDates || '').localeCompare(a.eventDates || '');
  });

  // Group by year
  const eventsByYear = new Map();
  for (const e of events) {
    const match = (e.eventDates || e.eventCode || '').match(/(\d{4})/);
    const year = match ? match[1] : 'Unknown';
    if (!eventsByYear.has(year)) eventsByYear.set(year, []);
    eventsByYear.get(year).push(e);
  }

  app.innerHTML = `
    <div class="rankings-header">
      <h2>Events</h2>
      <div class="stats-bar">
        <div><span class="stat-value">${events.length}</span> events tracked</div>
      </div>
    </div>
    ${[...eventsByYear.entries()].map(([year, yearEvents]) => `
      <h3 class="year-header">${year}</h3>
      <div class="events-grid">
        ${yearEvents.map(e => `
          <div class="event-card" data-event="${e.eventCode}">
            <h3>
              ${escapeHtml(e.eventName || e.eventCode)}
              <span class="event-type-badge event-type-${e.eventType}">${e.eventType}</span>
            </h3>
            <div class="dates">${e.eventDates || ''}</div>
            <div class="stats">
              <div><span>${e.totalDrivers || '?'}</span> drivers</div>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('')}
  `;

  document.querySelectorAll('.event-card').forEach(card => {
    card.addEventListener('click', () => {
      window.location.hash = `/event/${card.dataset.event}`;
    });
  });
}

async function renderEventDetail(eventCode) {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">Loading event...</div>';

  let event;
  try {
    event = await fetchJSON(`events/${eventCode}.json`);
  } catch (e) {
    app.innerHTML = '<div class="loading">Event not found.</div>';
    return;
  }

  // Build PAX index table
  const paxTable = (event.paxIndex || []).length > 0 ? `
    <div class="card history-table" style="grid-column: 1 / -1;">
      <h3>PAX Index Overall (Top ${Math.min(event.paxIndex.length, 50)})</h3>
      <table>
        <thead>
          <tr>
            <th>Pos</th>
            <th>Driver</th>
            <th>Class</th>
            <th>Car</th>
            <th>PAX Time</th>
          </tr>
        </thead>
        <tbody>
          ${event.paxIndex.slice(0, 50).map(r => `
            <tr>
              <td><strong>${r.position}</strong></td>
              <td>${r.driverId ? `<a href="#/driver/${r.driverId}">${escapeHtml(r.name)}</a>` : escapeHtml(r.name)}</td>
              <td>${renderClassBadge(r.className)}</td>
              <td class="hide-mobile">${escapeHtml(r.car || '')}</td>
              <td style="font-family:var(--mono)">${r.paxTime?.toFixed(3) || ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '';

  // Build per-class results
  const classCards = Object.entries(event.classResults || {}).map(([cls, results]) => `
    <div class="card">
      <h3>${cls} (${results.length} drivers)</h3>
      <table style="width:100%; font-size:0.85rem;">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Driver</th>
            <th>Car</th>
          </tr>
        </thead>
        <tbody>
          ${results.map(r => `
            <tr>
              <td>${r.trophy ? '<span class="trophy">&#9733;</span>' : ''} ${r.position}</td>
              <td><strong>${escapeHtml(r.name)}</strong></td>
              <td style="font-size:0.8rem">${escapeHtml(r.car || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('');

  app.innerHTML = `
    <a href="#/events" class="back-link">&larr; Back to Events</a>

    <div class="driver-profile">
      <div class="driver-header">
        <div class="driver-info">
          <h2>${escapeHtml(event.eventName || event.eventCode)}</h2>
          <div class="meta">
            ${event.eventDates || ''}
            <span class="event-type-badge event-type-${event.eventType}">${event.eventType}</span>
          </div>
        </div>
        <div class="driver-score">
          <div class="value">${event.totalDrivers || '?'}</div>
          <div class="label">Drivers</div>
        </div>
      </div>

      ${paxTable}
      ${classCards}
    </div>
  `;
}
