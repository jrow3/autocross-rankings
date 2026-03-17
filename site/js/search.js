// === Global Search ===

let allDrivers = null;

async function initSearch() {
  const input = document.getElementById('global-search');
  const dropdown = document.getElementById('search-results');

  input.addEventListener('input', async () => {
    const query = input.value.trim().toLowerCase();
    if (query.length < 2) {
      dropdown.classList.remove('active');
      return;
    }

    if (!allDrivers) {
      allDrivers = await fetchJSON('rankings.json');
    }

    const matches = allDrivers
      .filter(d => d.displayName.toLowerCase().includes(query))
      .slice(0, 10);

    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="search-item"><span class="name">No results</span></div>';
    } else {
      dropdown.innerHTML = matches.map(d => `
        <div class="search-item" data-driver="${d.driverId}">
          <span class="name">${escapeHtml(d.displayName)}</span>
          <span class="meta">#${d.rank} ${d.primaryClass}</span>
        </div>
      `).join('');
    }

    dropdown.classList.add('active');
  });

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.search-item');
    if (!item) return;
    const driverId = item.dataset.driver;
    if (driverId) {
      window.location.hash = `/driver/${driverId}`;
      dropdown.classList.remove('active');
      input.value = '';
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      dropdown.classList.remove('active');
    }
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.classList.remove('active');
      input.blur();
    }
    if (e.key === 'Enter') {
      const first = dropdown.querySelector('.search-item[data-driver]');
      if (first) {
        window.location.hash = `/driver/${first.dataset.driver}`;
        dropdown.classList.remove('active');
        input.value = '';
      }
    }
  });
}
