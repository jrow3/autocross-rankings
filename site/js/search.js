// === Global Search ===

let allDrivers = null;
let selectedIndex = -1;

function updateSelection(dropdown) {
  const input = document.getElementById('global-search');
  const items = dropdown.querySelectorAll('.search-item[data-driver]');
  items.forEach((item, i) => {
    const isSelected = i === selectedIndex;
    item.classList.toggle('selected', isSelected);
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });
  // Scroll selected item into view and update aria-activedescendant
  if (selectedIndex >= 0 && items[selectedIndex]) {
    items[selectedIndex].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', items[selectedIndex].id);
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

async function initSearch() {
  const input = document.getElementById('global-search');
  const dropdown = document.getElementById('search-results');

  // Set up ARIA attributes
  dropdown.setAttribute('role', 'listbox');
  dropdown.id = dropdown.id || 'search-results';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-owns', dropdown.id);
  input.setAttribute('aria-expanded', 'false');

  input.addEventListener('input', async () => {
    selectedIndex = -1;
    input.removeAttribute('aria-activedescendant');
    const query = input.value.trim().toLowerCase();
    if (query.length < 2) {
      dropdown.classList.remove('active');
      input.setAttribute('aria-expanded', 'false');
      return;
    }

    if (!allDrivers) {
      allDrivers = await fetchJSON('search-index.json');
    }

    const matches = allDrivers
      .filter(d => d.displayName.toLowerCase().includes(query))
      .slice(0, 10);

    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="search-item" role="option" aria-disabled="true"><span class="name">No results</span></div>';
    } else {
      dropdown.innerHTML = matches.map((d, i) => `
        <div class="search-item" id="search-option-${i}" role="option" aria-selected="false" data-driver="${d.driverId}">
          <span class="name">${escapeHtml(d.displayName)}</span>
          <span class="meta">#${d.rank} ${d.primaryClass}</span>
        </div>
      `).join('');
    }

    dropdown.classList.add('active');
    input.setAttribute('aria-expanded', 'true');
  });

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.search-item');
    if (!item) return;
    const driverId = item.dataset.driver;
    if (driverId) {
      window.location.hash = `/driver/${driverId}`;
      dropdown.classList.remove('active');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      input.value = '';
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      dropdown.classList.remove('active');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.search-item[data-driver]');
    const count = items.length;

    if (e.key === 'Escape') {
      dropdown.classList.remove('active');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      selectedIndex = -1;
      input.blur();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!dropdown.classList.contains('active') || count === 0) return;
      selectedIndex = selectedIndex < count - 1 ? selectedIndex + 1 : 0;
      updateSelection(dropdown);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!dropdown.classList.contains('active') || count === 0) return;
      selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : count - 1;
      updateSelection(dropdown);
      return;
    }

    if (e.key === 'Enter') {
      const target = selectedIndex >= 0 && items[selectedIndex]
        ? items[selectedIndex]
        : dropdown.querySelector('.search-item[data-driver]');
      if (target && target.dataset.driver) {
        window.location.hash = `/driver/${target.dataset.driver}`;
        dropdown.classList.remove('active');
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        input.value = '';
        selectedIndex = -1;
      }
    }
  });
}
