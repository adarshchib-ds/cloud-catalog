const BACKEND_URL = '';
const API = `${BACKEND_URL}/api/v1/instances/search`;
let allData = [],
  filtered = [],
  expandedRows = new Set();
let recRegionsLoaded = false;

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeIcon();
}

function updateThemeIcon() {
  const isDark = document.documentElement.classList.contains('dark-theme');
  document.getElementById('theme-icon-sun').style.display = isDark ? 'none' : 'block';
  document.getElementById('theme-icon-moon').style.display = isDark ? 'block' : 'none';
}

function restoreTheme() {
  const savedTheme = localStorage.getItem('theme');
  // Default to light theme. If 'dark' is saved, add the class.
  if (savedTheme === 'dark') {
    document.documentElement.classList.add('dark-theme');
  } else {
    document.documentElement.classList.remove('dark-theme');
  }
  updateThemeIcon();
}
restoreTheme();

function saveState() {
  localStorage.setItem(
    'activeTab',
    document.querySelector('.tab-btn.active')?.id.replace('tab-', '') || 'dict',
  );

  // Dictionary filters
  localStorage.setItem('dictSearch', document.getElementById('search').value);
  localStorage.setItem('dictProvider', document.getElementById('sel-provider').value);
  localStorage.setItem('dictArch', document.getElementById('sel-arch').value);
  localStorage.setItem('dictCurrentPage', dictCurrentPage);

  // Calculator inputs
  localStorage.setItem('calcProvider', document.getElementById('calc-provider').value);
  localStorage.setItem('calcRegion', document.getElementById('calc-region').value);
  localStorage.setItem('calcTenancy', document.getElementById('calc-tenancy').value);
  localStorage.setItem('calcVcpu', document.getElementById('calc-vcpu').value);
  localStorage.setItem('calcMemory', document.getElementById('calc-memory').value);
  localStorage.setItem('calcGpu', document.getElementById('calc-gpu').value);

  // Recommendation inputs
  localStorage.setItem('recRegion', document.getElementById('rec-region').value);
  localStorage.setItem('recTenancy', document.getElementById('rec-tenancy').value);
  localStorage.setItem('recVcpu', document.getElementById('rec-vcpu').value);
  localStorage.setItem('recMemory', document.getElementById('rec-memory').value);
  localStorage.setItem('recCurrentPage', recCurrentPage);
}

async function restoreState() {
  restoreTheme();
  // Restore Dictionary filters
  if (localStorage.getItem('dictSearch') !== null) {
    document.getElementById('search').value = localStorage.getItem('dictSearch');
  }
  if (localStorage.getItem('dictProvider') !== null) {
    document.getElementById('sel-provider').value = localStorage.getItem('dictProvider');
  }
  if (localStorage.getItem('dictArch') !== null) {
    document.getElementById('sel-arch').value = localStorage.getItem('dictArch');
  }
  if (localStorage.getItem('dictCurrentPage') !== null) {
    dictCurrentPage = parseInt(localStorage.getItem('dictCurrentPage')) || 1;
  }

  // Restore Calculator inputs
  if (localStorage.getItem('calcProvider') !== null) {
    document.getElementById('calc-provider').value = localStorage.getItem('calcProvider');
  }
  await onCalcProviderChange();
  if (localStorage.getItem('calcRegion') !== null) {
    document.getElementById('calc-region').value = localStorage.getItem('calcRegion');
  }
  if (localStorage.getItem('calcTenancy') !== null) {
    document.getElementById('calc-tenancy').value = localStorage.getItem('calcTenancy');
  }
  if (localStorage.getItem('calcVcpu') !== null) {
    const calcVcpu = document.getElementById('calc-vcpu');
    calcVcpu.value = localStorage.getItem('calcVcpu');
    calcVcpu.dispatchEvent(new Event('change'));
  }
  if (localStorage.getItem('calcMemory') !== null) {
    document.getElementById('calc-memory').value = localStorage.getItem('calcMemory');
  }
  if (localStorage.getItem('calcGpu') !== null) {
    document.getElementById('calc-gpu').value = localStorage.getItem('calcGpu');
  }

  // Restore Recommendation inputs
  await loadRecRegions();
  if (localStorage.getItem('recRegion') !== null) {
    document.getElementById('rec-region').value = localStorage.getItem('recRegion');
  }
  if (localStorage.getItem('recTenancy') !== null) {
    document.getElementById('rec-tenancy').value = localStorage.getItem('recTenancy');
  }
  if (localStorage.getItem('recVcpu') !== null) {
    const recVcpu = document.getElementById('rec-vcpu');
    recVcpu.value = localStorage.getItem('recVcpu');
    recVcpu.dispatchEvent(new Event('change'));
  }
  if (localStorage.getItem('recMemory') !== null) {
    document.getElementById('rec-memory').value = localStorage.getItem('recMemory');
  }
  if (localStorage.getItem('recCurrentPage') !== null) {
    recCurrentPage = parseInt(localStorage.getItem('recCurrentPage')) || 1;
  }

  // Restore Tab
  const activeTab = localStorage.getItem('activeTab') || 'dict';
  switchTab(activeTab);

  // Hook up event listeners to save state automatically on input changes
  const inputsToWatch = [
    'search',
    'sel-provider',
    'sel-arch',
    'calc-provider',
    'calc-region',
    'calc-tenancy',
    'calc-vcpu',
    'calc-memory',
    'calc-gpu',
    'rec-region',
    'rec-tenancy',
    'rec-vcpu',
    'rec-memory',
  ];
  inputsToWatch.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => saveState());
      el.addEventListener('change', e => {
        // Prevent manual event dispatch from triggering another save state cycle
        if (e.isTrusted) {
          saveState();
        }
      });
    }
  });

  // Automatically trigger search/recommend if there was previous criteria
  if (activeTab === 'calc' && document.getElementById('calc-vcpu').value) {
    calculate();
  } else if (activeTab === 'recommend' && document.getElementById('rec-vcpu').value) {
    getSmartRecommendations();
  }
}

function switchTab(t) {
  document.getElementById('tab-dict').classList.toggle('active', t === 'dict');
  document.getElementById('tab-calc').classList.toggle('active', t === 'calc');
  document.getElementById('tab-recommend').classList.toggle('active', t === 'recommend');
  document.getElementById('panel-dict').classList.toggle('active', t === 'dict');
  document.getElementById('panel-calc').classList.toggle('active', t === 'calc');
  document.getElementById('panel-recommend').classList.toggle('active', t === 'recommend');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (t === 'recommend' && !recRegionsLoaded) loadRecRegions();
  saveState();
}

async function loadRecRegions() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/instances/regions?provider=aws`);
    const d = await res.json();
    if (!d.success || !d.data) return;
    const sel = document.getElementById('rec-region');
    // Clear old options except the first "Any Region"
    sel.innerHTML = '<option value="">Any Region</option>';
    d.data.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.code;
      opt.textContent = `${r.name} (${r.code})`;
      sel.appendChild(opt);
    });
    recRegionsLoaded = true;
  } catch (e) {
    /* silently fail */
  }
}

/* ═══ DICTIONARY ═══ */
let totalCount = 0;
let debounceTimer;

async function loadAll() {
  try {
    const metaRes = await fetch(`${BACKEND_URL}/api/v1/instances/metadata`);
    const metaData = await metaRes.json();
    if (metaData.success && metaData.data) {
      allData = []; // Not populated as we do server-side filtering
      populateVcpuMemFamilies(metaData.data);
    }

    await restoreState();
    await fetchInstances();
  } catch (e) {
    document.getElementById('content').innerHTML =
      `<div class="empty"><h3>Failed to load</h3><p>${esc(e.message)}</p></div>`;
  }
}

function populateVcpuMemFamilies(data) {
  const families = data.families || [];
  const vcpus = data.vcpus || [];
  const memories = data.memories || [];

  const selFamily = document.getElementById('calc-family');
  if (selFamily) {
    selFamily.innerHTML = '<option value="">All Families</option>';
    families.forEach(f => {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      selFamily.appendChild(o);
    });
  }

  const calcVcpu = document.getElementById('calc-vcpu');
  const calcMemory = document.getElementById('calc-memory');
  const recVcpu = document.getElementById('rec-vcpu');
  const recMemory = document.getElementById('rec-memory');

  const populate = (selectEl, values, defaultVal, isRequired = false) => {
    if (!selectEl) return;
    const placeholder = isRequired ? 'Select...' : 'Any';
    const currentVal = selectEl.value;
    selectEl.innerHTML = `<option value="">${placeholder}</option>`;
    values.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = selectEl.id.includes('vcpu') ? `${v} vCPU` : `${v} GB`;
      if (v === defaultVal || String(v) === currentVal) opt.selected = true;
      selectEl.appendChild(opt);
    });
  };

  populate(calcVcpu, vcpus, 4);
  populate(calcMemory, memories, 16);
  populate(recVcpu, vcpus, 4, true);
  populate(recMemory, memories, 16, true);
}

let dictCurrentPage = 1;
const dictPageSize = 15;

async function fetchInstances() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading instances...</p></div>';

  const q = document.getElementById('search').value;
  const p = document.getElementById('sel-provider').value;
  const a = document.getElementById('sel-arch').value;

  const params = new URLSearchParams({
    page: dictCurrentPage,
    pageSize: dictPageSize,
  });

  if (q) params.set('search', q);
  if (p) params.set('provider', p);
  if (a) params.set('architecture', a);

  try {
    const res = await fetch(`${API}?${params.toString()}`);
    const d = await res.json();
    if (d.success && d.data) {
      filtered = d.data;
      totalCount = d.meta.totalCount;

      if (d.meta.globalStats) {
        const stats = d.meta.globalStats;
        document.getElementById('stat-total').textContent = stats.totalInstances;
        document.getElementById('stat-gpu').textContent = stats.gpuInstances;
        document.getElementById('stat-showing').textContent = d.meta.totalCount;
        document.getElementById('sn-total').textContent = stats.totalInstances;
        document.getElementById('sn-gpu').textContent = stats.gpuInstances;
        document.getElementById('sn-showing').textContent = d.meta.totalCount;
      }

      renderTable();
    } else {
      content.innerHTML = `<div class="empty"><h3>Error</h3><p>${esc(d.error?.message || 'Failed to search')}</p></div>`;
    }
  } catch (e) {
    content.innerHTML = `<div class="empty"><h3>Error</h3><p>${esc(e.message)}</p></div>`;
  }
}

function doSearch(v) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    dictCurrentPage = 1;
    fetchInstances();
  }, 300);
}

function doFilterProvider() {
  dictCurrentPage = 1;
  fetchInstances();
}

function doFilterArch() {
  dictCurrentPage = 1;
  fetchInstances();
}

function changeDictPage(dir) {
  const maxPage = Math.ceil(totalCount / dictPageSize);
  dictCurrentPage += dir;
  if (dictCurrentPage < 1) dictCurrentPage = 1;
  if (dictCurrentPage > maxPage) dictCurrentPage = maxPage;
  fetchInstances();
  saveState();
}

function renderTable() {
  const c = document.getElementById('content');
  if (filtered.length === 0) {
    c.innerHTML =
      '<div class="empty"><h3>No instances match</h3><p>Try adjusting your search or filters.</p></div>';
    return;
  }

  const total = totalCount;
  const maxPage = Math.ceil(total / dictPageSize);
  if (dictCurrentPage > maxPage) dictCurrentPage = maxPage;
  const startIdx = (dictCurrentPage - 1) * dictPageSize;
  const endIdx = Math.min(startIdx + filtered.length, total);
  const pageData = filtered;

  let html =
    '<div class="table-wrap"><div class="table-scroll"><table><thead><tr><th></th><th>Instance Name</th><th>Provider</th><th>vCPUs</th><th>Memory</th><th>Architecture</th><th>Processor</th><th>Family</th><th>Storage</th><th>On-Demand Hourly Cost</th></tr></thead><tbody>';
  pageData.forEach((item, idx) => {
    const inst = item.instance;
    const isOpen = expandedRows.has(inst.id);
    html += `<tr class="${isOpen ? 'expanded-row' : ''}" onclick="toggleRow('${inst.id}')">
      <td><button class="expand-btn ${isOpen ? 'open' : ''}" onclick="event.stopPropagation();toggleRow('${inst.id}')">&#9654;</button></td>
      <td style="font-weight:500;color:var(--text);">${esc(inst.displayName || inst.instanceType)}</td>
      <td><span class="td-badge td-badge-${item.provider.id}">${item.provider.id.toUpperCase()}</span></td>
      <td class="td-mono">${inst.vcpu}</td>
      <td class="td-mono">${inst.memoryGib} GB</td>
      <td>${esc(inst.architecture)}</td>
      <td>${esc(inst.processor || '--')}</td>
      <td>${esc(item.family.name)}</td>
      <td>${esc(inst.storageSummary || inst.storageType || '--')}</td>
      <td class="td-mono">${inst.hourlyCost ? '$' + Number(inst.hourlyCost).toFixed(4) : '--'}</td>
    </tr>`;
    html += `<tr class="detail-row ${isOpen ? 'open' : ''}" id="detail-${inst.id}"><td colspan="10"><div class="detail-grid">
      <div class="detail-item"><span class="detail-label">CPU Frequency</span><span class="detail-value mono">${inst.cpuFrequencyGhz ? inst.cpuFrequencyGhz + ' GHz' : '--'}</span></div>
      <div class="detail-item"><span class="detail-label">Instance Size</span><span class="detail-value">${esc(inst.instanceSize)}</span></div>
      <div class="detail-item"><span class="detail-label">Enhanced NIC</span><span class="detail-value">${inst.enhancedNetworking ? 'Yes' : 'No'}</span></div>
      <div class="detail-item"><span class="detail-label">Live Migration</span><span class="detail-value">${inst.supportsLiveMigration ? 'Yes' : 'No'}</span></div>
      <div class="detail-item"><span class="detail-label">Burstable</span><span class="detail-value">${inst.burstable ? 'Yes' : 'No'}</span></div>
      <div class="detail-item"><span class="detail-label">Current Gen</span><span class="detail-value">${inst.currentGeneration ? 'Yes' : 'No'}</span></div>
      ${inst.hasGpu ? `<div class="detail-item"><span class="detail-label">GPU</span><span class="detail-value mono">${inst.gpuCount}x ${esc(inst.gpuModel || '--')}</span></div><div class="detail-item"><span class="detail-label">GPU Memory</span><span class="detail-value mono">${inst.gpuMemoryGib ? inst.gpuMemoryGib + ' GB' : '--'}</span></div>` : ''}
      ${inst.storageIops ? `<div class="detail-item"><span class="detail-label">Storage IOPS</span><span class="detail-value mono">${inst.storageIops}</span></div>` : ''}
      ${inst.storageSizeGib ? `<div class="detail-item"><span class="detail-label">Storage Size</span><span class="detail-value mono">${inst.storageSizeGib} GB</span></div>` : ''}
    </div></td></tr>`;
  });
  html += '</tbody></table></div>';

  html += `
    <div class="pagination-container">
      <div class="pagination-info">
        Showing <strong>${startIdx + 1}</strong>–<strong>${endIdx}</strong> of <strong>${total}</strong> instances (Page ${dictCurrentPage} of ${maxPage})
      </div>
      <div class="pagination-actions">
        <button class="pagination-btn" onclick="changeDictPage(-1)" ${dictCurrentPage === 1 ? 'disabled' : ''}>Previous</button>
        <button class="pagination-btn" onclick="changeDictPage(1)" ${dictCurrentPage === maxPage ? 'disabled' : ''}>Next</button>
      </div>
    </div>
  </div>`;
  c.innerHTML = html;
}

function toggleRow(id) {
  if (expandedRows.has(id)) expandedRows.delete(id);
  else expandedRows.add(id);
  renderTable();
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

/* ═══ CALCULATOR ═══ */
async function onCalcProviderChange() {
  const p = document.getElementById('calc-provider').value;
  const sel = document.getElementById('calc-region');
  sel.innerHTML = '<option value="">Loading regions...</option>';
  try {
    const url = `${BACKEND_URL}/api/v1/instances/regions` + (p ? `?provider=${p}` : '');
    const res = await fetch(url);
    const data = await res.json();
    sel.innerHTML = '<option value="">Any Region</option>';
    if (data.success && data.data) {
      data.data.forEach(r => {
        const o = document.createElement('option');
        o.value = r.code;
        o.textContent = `${r.name} (${r.code})`;
        sel.appendChild(o);
      });
    }
  } catch (e) {
    console.error('Failed to load regions', e);
    sel.innerHTML = '<option value="">Any Region</option>';
  }
}
onCalcProviderChange();

function clearCalcForm() {
  document.getElementById('calc-provider').value = '';
  document.getElementById('calc-tenancy').value = '';
  document.getElementById('calc-gpu').value = '';
  document.getElementById('calc-vcpu').value = '';
  document.getElementById('calc-memory').value = '';
  onCalcProviderChange();
  document.getElementById('calc-results').innerHTML =
    '<div class="results-empty"><h3>Configure your requirements above</h3><p>Select provider, region, compute specs, and click Find Families.</p></div>';
}

let lastCalcParams = {};

async function calculate() {
  const btn = document.getElementById('btn-calc-search');
  btn.disabled = true;
  btn.innerHTML =
    '<span class="loading-spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></span> Searching...';
  const out = document.getElementById('calc-results');
  out.innerHTML =
    '<div class="loading"><div class="loading-spinner"></div><p>Discovering instance families...</p></div>';

  const params = new URLSearchParams();
  const provider = document.getElementById('calc-provider').value;
  const region = document.getElementById('calc-region').value;
  const tenancy = document.getElementById('calc-tenancy').value;
  const gpu = document.getElementById('calc-gpu').value;
  const vcpu = document.getElementById('calc-vcpu').value;
  const memory = document.getElementById('calc-memory').value;

  if (provider) params.set('provider', provider);
  if (region) params.set('region', region);
  if (tenancy) params.set('tenancy', tenancy);
  if (gpu) params.set('hasGpu', gpu);
  if (vcpu) params.set('vcpu', vcpu);
  if (memory) params.set('memory', memory);

  lastCalcParams = Object.fromEntries(params);

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/instances/families?${params.toString()}`);
    const data = await res.json();

    if (!data.success || !data.data || data.data.length === 0) {
      out.innerHTML =
        '<div class="results-empty"><h3>No matching families found</h3><p>Try broadening your filters.</p></div>';
      return;
    }

    const families = data.data;
    const totalInstances = families.reduce((sum, f) => sum + f.instanceCount, 0);
    const gpuFamilies = families.filter(f => f.hasGpu).length;

    let html = '';

    html += `<div class="insight-box"><div class="insight-title">&#9670; Results Summary</div><div class="insight-list">
      <div class="insight-item"><span class="insight-bullet ib-blue">${families.length}</span><span><strong>${families.length} instance families</strong> match your criteria</span></div>
      <div class="insight-item"><span class="insight-bullet ib-amber">${totalInstances}</span><span><strong>${totalInstances} total instances</strong> across all families</span></div>
      ${gpuFamilies > 0 ? `<div class="insight-item"><span class="insight-bullet ib-green">${gpuFamilies}</span><span><strong>${gpuFamilies} GPU-capable families</strong> available</span></div>` : ''}
    </div></div>`;

    html += '<div class="family-grid">';
    families.forEach(f => {
      const providerBadge = `<span class="td-badge td-badge-${f.provider.slug}">${f.provider.slug.toUpperCase()}</span>`;
      html += `<div class="family-card" onclick="showFamilyInstances('${esc(f.family.name)}','${f.provider.id}')">
        <div class="family-card-header">
          <div class="family-card-name">${esc(f.family.name)}</div>
          ${providerBadge}
        </div>
        <div class="family-card-desc">${esc(f.family.description || '')}</div>
        <div class="family-card-stats">
          <div class="family-card-stat">
            <span class="family-card-stat-label">Instances</span>
            <span class="family-card-stat-value">${f.instanceCount}</span>
          </div>
          <div class="family-card-stat">
            <span class="family-card-stat-label">vCPUs</span>
            <span class="family-card-stat-value">${f.vcpuRange.min === f.vcpuRange.max ? f.vcpuRange.min : f.vcpuRange.min + '–' + f.vcpuRange.max}</span>
          </div>
          <div class="family-card-stat">
            <span class="family-card-stat-label">Memory</span>
            <span class="family-card-stat-value">${f.memoryRange.min === f.memoryRange.max ? f.memoryRange.min + ' GB' : f.memoryRange.min + '–' + f.memoryRange.max + ' GB'}</span>
          </div>
        </div>
        <div class="family-card-tags">
          ${f.hasGpu ? '<span class="family-tag family-tag-gpu">GPU</span>' : ''}
          <span class="family-tag">${f.provider.name}</span>
        </div>
      </div>`;
    });
    html += '</div>';

    out.innerHTML = html;
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    out.innerHTML = `<div class="results-empty"><h3>Search failed</h3><p>${esc(e.message)}</p></div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Find Families &#8594;';
  }
}

async function showFamilyInstances(familyName, providerSlug) {
  const btn = document.getElementById('btn-calc-search');
  btn.disabled = true;
  btn.innerHTML =
    '<span class="loading-spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></span> Loading...';
  const out = document.getElementById('calc-results');
  out.innerHTML =
    '<div class="loading"><div class="loading-spinner"></div><p>Loading instances...</p></div>';

  const params = new URLSearchParams();
  params.set('instanceFamily', familyName);
  params.set('provider', providerSlug);
  params.set('pageSize', '100');

  if (lastCalcParams.region) params.set('region', lastCalcParams.region);
  if (lastCalcParams.tenancy) params.set('tenancy', lastCalcParams.tenancy);
  if (lastCalcParams.hasGpu) params.set('hasGpu', lastCalcParams.hasGpu);
  if (lastCalcParams.vcpu) params.set('minVcpu', lastCalcParams.vcpu);
  if (lastCalcParams.memory) params.set('minMemory', lastCalcParams.memory);

  try {
    const res = await fetch(`${API}?${params.toString()}`);
    const data = await res.json();

    if (!data.success || !data.data || data.data.length === 0) {
      out.innerHTML =
        '<div class="results-empty"><h3>No instances found</h3><p>Try broadening your filters.</p></div>';
      return;
    }

    const items = data.data;
    const gpuCount = items.filter(i => i.instance.hasGpu).length;
    const avgVcpu = Math.round(items.reduce((s, i) => s + i.instance.vcpu, 0) / items.length);
    const avgMem =
      Math.round((items.reduce((s, i) => s + i.instance.memoryGib, 0) / items.length) * 10) / 10;

    let html = '';

    html += `<div class="instance-view-header">
      <button class="back-btn" onclick="calculate()">&#8592; Back to Families</button>
      <div class="instance-view-title">${esc(familyName)}</div>
      <div class="instance-view-subtitle">${providerSlug.toUpperCase()} &middot; ${items.length} instances</div>
    </div>`;

    html += `<div class="instance-summary">
      <div class="instance-summary-card"><div class="instance-summary-num">${items.length}</div><div class="instance-summary-lbl">Instances</div></div>
      <div class="instance-summary-card" style="background:var(--aws-dim);border-color:transparent;"><div class="instance-summary-num">${avgVcpu}</div><div class="instance-summary-lbl">Avg vCPUs</div></div>
      <div class="instance-summary-card"><div class="instance-summary-num">${avgMem}</div><div class="instance-summary-lbl">Avg Memory (GB)</div></div>
      <div class="instance-summary-card" style="background:linear-gradient(135deg,var(--accent),var(--purple));border-color:transparent;"><div class="instance-summary-num" style="color:#fff;">${gpuCount}</div><div class="instance-summary-lbl" style="color:rgba(255,255,255,0.7);">GPU Instances</div></div>
    </div>`;

    html +=
      '<div class="table-wrap equiv-table"><div class="table-scroll"><table><thead><tr><th></th><th>Instance Name</th><th>vCPUs</th><th>Memory</th><th>Architecture</th><th>Processor</th><th>Storage</th></tr></thead><tbody>';

    items.forEach(item => {
      const inst = item.instance;
      const isOpen = expandedRows.has(inst.id);
      html += `<tr class="${isOpen ? 'expanded-row' : ''}" onclick="toggleCalcRow('${inst.id}')">
        <td><button class="expand-btn ${isOpen ? 'open' : ''}" onclick="event.stopPropagation();toggleCalcRow('${inst.id}')">&#9654;</button></td>
        <td style="font-weight:500;color:var(--text);">${esc(inst.displayName || inst.instanceType)}</td>
        <td class="td-mono">${inst.vcpu}</td>
        <td class="td-mono">${inst.memoryGib} GB</td>
        <td>${esc(inst.architecture)}</td>
        <td>${esc(inst.processor || '--')}</td>
        <td>${esc(inst.storageType || '--')}</td>
      </tr>`;
      html += `<tr class="detail-row ${isOpen ? 'open' : ''}" id="detail-${inst.id}"><td colspan="7"><div class="detail-grid">
        <div class="detail-item"><span class="detail-label">CPU Frequency</span><span class="detail-value mono">${inst.cpuFrequencyGhz ? inst.cpuFrequencyGhz + ' GHz' : '--'}</span></div>
        <div class="detail-item"><span class="detail-label">Instance Size</span><span class="detail-value">${esc(inst.instanceSize)}</span></div>
        <div class="detail-item"><span class="detail-label">Enhanced NIC</span><span class="detail-value">${inst.enhancedNetworking ? 'Yes' : 'No'}</span></div>
        <div class="detail-item"><span class="detail-label">Live Migration</span><span class="detail-value">${inst.supportsLiveMigration ? 'Yes' : 'No'}</span></div>
        ${inst.hasGpu ? `<div class="detail-item"><span class="detail-label">GPU</span><span class="detail-value mono">${inst.gpuCount}x ${esc(inst.gpuModel || '--')}</span></div><div class="detail-item"><span class="detail-label">GPU Memory</span><span class="detail-value mono">${inst.gpuMemoryGib ? inst.gpuMemoryGib + ' GB' : '--'}</span></div>` : ''}
        <div class="detail-item"><span class="detail-label">Burstable</span><span class="detail-value">${inst.burstable ? 'Yes' : 'No'}</span></div>
        <div class="detail-item"><span class="detail-label">Current Gen</span><span class="detail-value">${inst.currentGeneration ? 'Yes' : 'No'}</span></div>
        ${inst.storageIops ? `<div class="detail-item"><span class="detail-label">Storage IOPS</span><span class="detail-value mono">${inst.storageIops}</span></div>` : ''}
        ${inst.storageSizeGib ? `<div class="detail-item"><span class="detail-label">Storage Size</span><span class="detail-value mono">${inst.storageSizeGib} GB</span></div>` : ''}
      </div></td></tr>`;
    });

    html += '</tbody></table></div></div>';

    const allProviders = ['aws', 'azure', 'gcp'];
    const orderedProviders = [providerSlug, ...allProviders.filter(p => p !== providerSlug)];
    const otherProviders = allProviders.filter(p => p !== providerSlug);
    if (otherProviders.length > 0) {
      const hasEquivalents = items.some(i => {
        return otherProviders.some(
          p => i.equivalents && i.equivalents[p] && i.equivalents[p].length > 0,
        );
      });

      if (hasEquivalents) {
        html += '<div class="equiv-section">';
        html += '<div class="equiv-section-header">&#9878; Cross-Cloud Equivalents</div>';

        items.forEach(item => {
          const inst = item.instance;
          const equivs = item.equivalents || {};
          const hasAny = otherProviders.some(p => equivs[p] && equivs[p].length > 0);
          if (!hasAny) return;

          html += `<div style="padding:14px 18px;border-bottom:1px solid var(--border-light);">
            <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;">${esc(inst.displayName || inst.instanceType)} <span style="color:var(--text-4);font-weight:400;">(${inst.vcpu} vCPU, ${inst.memoryGib} GB)</span></div>
            <div class="equiv-row">`;

          orderedProviders.forEach(p => {
            html += `<div class="equiv-col">
              <div class="equiv-col-title"><span class="td-badge td-badge-${p}" style="font-size:8px;">${p.toUpperCase()}</span></div>`;

            if (p === providerSlug) {
              const searchedData = {
                ...inst,
                provider: item.provider,
                service: item.service,
                matchScore: 1.0,
              };
              html += `<div class="equiv-instance active-searched" data-instance="${escHtmlAttr(JSON.stringify(searchedData))}" onclick="showInstanceDetails(this)">
                <div>
                  <div class="equiv-name" style="font-weight: 700; color: var(--accent);">${esc(inst.displayName || inst.instanceType)}</div>
                  <div style="font-size:10px;color:var(--text-3);margin-top:2px;font-style:italic;">${esc(item.service ? item.service.name : '')}</div>
                  <div class="equiv-specs" style="margin-top:4px;">${inst.vcpu} vCPU, ${inst.memoryGib} GB</div>
                </div>
                <span class="equiv-score" style="background: var(--accent-dim); color: var(--accent);">SEARCHED</span>
              </div>`;
            } else {
              const equivList = equivs[p] || [];
              if (equivList.length === 0) {
                html += '<div class="equiv-empty">No equivalent found</div>';
              } else {
                equivList.forEach(e => {
                  html += `<div class="equiv-instance" data-instance="${escHtmlAttr(JSON.stringify(e))}" onclick="showInstanceDetails(this)">
                    <div>
                      <div class="equiv-name">${esc(e.displayName || e.instanceType)}</div>
                      <div style="font-size:10px;color:var(--text-3);margin-top:2px;font-style:italic;">${esc(e.service ? e.service.name : '')}</div>
                      <div class="equiv-specs" style="margin-top:4px;">${e.vcpu} vCPU, ${e.memoryGib} GB</div>
                    </div>
                    <span class="equiv-score">${Math.round(e.matchScore * 100)}%</span>
                  </div>`;
                });
              }
            }
            html += '</div>';
          });

          html += '</div></div>';
        });

        html += '</div>';
      }
    }

    out.innerHTML = html;
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    out.innerHTML = `<div class="results-empty"><h3>Failed to load instances</h3><p>${esc(e.message)}</p></div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Find Families &#8594;';
  }
}

function toggleCalcRow(id) {
  if (expandedRows.has(id)) expandedRows.delete(id);
  else expandedRows.add(id);
  const row = document.getElementById('detail-' + id);
  if (row) row.classList.toggle('open');
  const btn = row?.previousElementSibling?.querySelector('.expand-btn');
  if (btn) btn.classList.toggle('open');
}

function escHtmlAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showInstanceDetails(element) {
  const data = JSON.parse(element.getAttribute('data-instance'));

  document.getElementById('modal-inst-type').innerText =
    data.displayName || data.instanceType || '--';

  const updateItem = (key, val) => {
    const wrapper = document.getElementById('item-' + key);
    const textNode = document.getElementById('modal-' + key);
    if (!wrapper || !textNode) return;

    if (
      !val ||
      val === '--' ||
      val === 'No GPU' ||
      val === 'No' ||
      val === 'No (Previous Gen)' ||
      val === '0 GB'
    ) {
      wrapper.style.display = 'none';
    } else {
      textNode.innerText = val;
      wrapper.style.display = 'block';
    }
  };

  updateItem('provider', data.provider ? data.provider.name : '');
  updateItem('service', data.service ? data.service.name : '');
  updateItem('vcpu', data.vcpu ? data.vcpu + ' vCPUs' : '');
  updateItem('memory', data.memoryGib ? data.memoryGib + ' GB' : '');
  updateItem('processor', data.processor);
  updateItem('architecture', data.architecture);
  updateItem('storage-type', data.storageType);
  updateItem('storage-size', data.storageSizeGib ? data.storageSizeGib + ' GB' : '');
  updateItem('storage-iops', data.storageIops);
  updateItem('network', data.networkPerformance);

  const gpuVal = data.gpuCount
    ? `${data.gpuCount}x ${data.gpuModel} (${data.gpuMemoryGib} GB)`
    : '';
  updateItem('gpu', gpuVal);

  updateItem('burstable', data.burstable ? 'Yes' : '');
  updateItem(
    'generation',
    data.currentGeneration ? 'Yes (Current Gen)' : 'No (Previous Generation)',
  );

  // Bind monthly/hourly cost estimation with range support
  const hMin = data.onDemandHourlyCostMin || data.onDemandHourlyCost || data.hourlyCost;
  const hMax = data.onDemandHourlyCostMax || data.onDemandHourlyCost || data.hourlyCost;
  const mMin = data.onDemandMonthlyCostMin || (Number(hMin) * 720).toFixed(2);
  const mMax = data.onDemandMonthlyCostMax || (Number(hMax) * 720).toFixed(2);

  let costRangeText = '';
  if (hMin && hMax) {
    if (hMin === hMax) {
      costRangeText = `$${Number(hMin).toFixed(4)}/hr (≈ $${Number(mMin).toFixed(2)}/mo)`;
    } else {
      costRangeText = `$${Number(hMin).toFixed(4)} - $${Number(hMax).toFixed(4)}/hr (≈ $${Number(mMin).toFixed(2)} - $${Number(mMax).toFixed(2)}/mo)`;
    }
  }
  updateItem('monthly-cost', costRangeText);

  // Bind generation-based recommendation upgrade
  const upgradeWrapper = document.getElementById('item-rec-upgrade');
  const upgradeSpan = document.getElementById('modal-rec-upgrade');
  if (!data.currentGeneration && data.recommendation) {
    const recHMin =
      data.recommendation.onDemandHourlyCostMin || data.recommendation.onDemandHourlyCost;
    const recHMax =
      data.recommendation.onDemandHourlyCostMax || data.recommendation.onDemandHourlyCost;
    const recMMin =
      data.recommendation.onDemandMonthlyCostMin || (Number(recHMin) * 720).toFixed(2);
    const recMMax =
      data.recommendation.onDemandMonthlyCostMax || (Number(recHMax) * 720).toFixed(2);

    let recRangeText = '';
    if (recHMin && recHMax) {
      if (recHMin === recHMax) {
        recRangeText = `$${Number(recHMin).toFixed(4)}/hr (≈ $${Number(recMMin).toFixed(2)}/mo)`;
      } else {
        recRangeText = `$${Number(recHMin).toFixed(4)} - $${Number(recHMax).toFixed(4)}/hr (≈ $${Number(recMMin).toFixed(2)} - $${Number(recMMax).toFixed(2)}/mo)`;
      }
    }

    upgradeSpan.innerHTML = `Use <strong style="font-family:monospace; color:var(--text);">${esc(data.recommendation.recommendedInstance)}</strong> (Current Gen)<br>
                             Price Range: ${recRangeText}`;
    upgradeWrapper.style.display = 'block';
  } else {
    upgradeWrapper.style.display = 'none';
  }

  const scoreSpan = document.getElementById('modal-score');
  const scoreWrapper = document.getElementById('item-score');
  if (data.matchScore !== undefined && data.matchScore < 1.0) {
    scoreSpan.innerText = Math.round(data.matchScore * 100) + '% Match';
    scoreSpan.style.color = 'var(--green)';
    scoreWrapper.style.display = 'block';
  } else if (data.matchScore === 1.0) {
    scoreSpan.innerText = 'SEARCHED (Base Baseline)';
    scoreSpan.style.color = 'var(--accent)';
    scoreWrapper.style.display = 'block';
  } else {
    scoreWrapper.style.display = 'none';
  }

  document.getElementById('details-modal').classList.add('open');
}

let recCurrentPage = 1;
const recPageSize = 4;
let currentMatrixRows = [];
let currentAutoSuggestedFamily = '';

function changeRecPage(dir) {
  const maxPage = Math.ceil(currentMatrixRows.length / recPageSize);
  recCurrentPage += dir;
  if (recCurrentPage < 1) recCurrentPage = 1;
  if (recCurrentPage > maxPage) recCurrentPage = maxPage;
  renderRecMatrix();
}

function renderRecMatrix() {
  const out = document.getElementById('rec-results');
  if (currentMatrixRows.length === 0) {
    out.innerHTML =
      '<div class="results-empty"><h3>No recommendations found</h3><p>Try lowering your minimum required resources.</p></div>';
    return;
  }

  const total = currentMatrixRows.length;
  const maxPage = Math.ceil(total / recPageSize);
  if (recCurrentPage > maxPage) recCurrentPage = maxPage;
  const startIdx = (recCurrentPage - 1) * recPageSize;
  const endIdx = Math.min(startIdx + recPageSize, total);
  const pageData = currentMatrixRows.slice(startIdx, endIdx);

  const providerBadge = slug => {
    const colors = { aws: '#FF9900', azure: '#0078D4', gcp: '#4285F4' };
    const labels = { aws: 'AWS', azure: 'Azure', gcp: 'GCP' };
    return `<span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700;background:${colors[slug] || '#888'};color:#fff;letter-spacing:0.4px;">${labels[slug] || slug.toUpperCase()}</span>`;
  };

  // Helper to format a price range string
  const formatPriceRange = (min, max, suffix) => {
    if (!min || Number(min) === 0) return '';
    if (min === max || !max) return `$${min}${suffix}`;
    return `$${min} - $${max}${suffix}`;
  };

  const cloudCell = (inst, isAws, matchScore, reasons) => {
    let reasonsHtml = '';
    if (reasons && reasons.length > 0) {
      reasonsHtml = `
        <div style="margin-top:8px; display:flex; flex-direction:column; gap:3px;">
          ${reasons.map(r => `<span style="color:var(--green); font-size:9px; font-weight:600;">✓ ${esc(r)}</span>`).join('')}
        </div>
      `;
    }

    const metaHtml = `
      <div style="margin-top:6px; display:flex; gap:4px; flex-wrap:wrap;">
        <span style="font-size:8px; background:rgba(255,255,255,0.06); padding:1px 5px; border-radius:3px; color:var(--text-3); text-transform:uppercase;">${esc(inst.category)}</span>
        <span style="font-size:8px; background:rgba(255,255,255,0.06); padding:1px 5px; border-radius:3px; color:var(--text-3); text-transform:uppercase;">${esc(inst.architecture)}</span>
        <span style="font-size:8px; background:rgba(255,255,255,0.06); padding:1px 5px; border-radius:3px; color:var(--text-3); text-transform:uppercase;">Gen ${esc(inst.generation)}</span>
        <span style="font-size:8px; background:${inst.currentGeneration ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'}; padding:1px 5px; border-radius:3px; color:${inst.currentGeneration ? 'var(--green)' : 'var(--red)'}; font-weight:600; text-transform:uppercase;">
          ${inst.currentGeneration ? 'Current Generation' : 'Previous Generation'}
        </span>
      </div>
    `;

    // Hourly price range
    const hourlyRange = formatPriceRange(
      inst.onDemandHourlyCostMin || inst.onDemandHourlyCost,
      inst.onDemandHourlyCostMax || inst.onDemandHourlyCost,
      ' / hour',
    );
    // Monthly price range (720 hours)
    const monthlyMin =
      inst.onDemandMonthlyCostMin ||
      (Number(inst.onDemandHourlyCostMin || inst.onDemandHourlyCost) * 720).toFixed(2);
    const monthlyMax =
      inst.onDemandMonthlyCostMax ||
      (Number(inst.onDemandHourlyCostMax || inst.onDemandHourlyCost) * 720).toFixed(2);
    const monthlyRange = formatPriceRange(monthlyMin, monthlyMax, ' / month');

    return `
      <div style="font-family:monospace;font-weight:700;font-size:13px;color:var(--text);margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(inst.instanceType || inst.recommendedInstance)}</div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:6px;">${inst.vcpu} vCPU &bull; ${inst.memoryGib} GB &bull; <span style="color:var(--text-4);">${esc(inst.storageSummary)}</span></div>
      <div style="margin-bottom:2px;">
        <div style="font-size:9px;color:var(--text-4);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">Hourly Price</div>
        <span style="font-family:monospace;font-size:12px;font-weight:600;color:var(--text-2);">${hourlyRange}</span>
      </div>
      <div style="margin-bottom:4px;">
        <div style="font-size:9px;color:var(--text-4);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">Estimated Monthly</div>
        <span style="font-family:monospace;font-size:11px;font-weight:500;color:var(--green);">≈ ${monthlyRange}</span>
      </div>
      ${matchScore !== undefined ? `<span style="font-size:9px;color:var(--green);font-weight:700;background:rgba(52,199,89,0.12);padding:2px 6px;border-radius:3px;">${matchScore}% match</span>` : ''}
      ${metaHtml}
      ${reasonsHtml}
    `;
  };

  const emptyCell = `<div style="color:var(--text-4);font-size:11px;font-style:italic;">No equivalent found</div>`;

  let html = `
    <div style="background:var(--bg-card);border:1px solid var(--border-light);border-radius:var(--r-md);overflow:hidden;box-shadow:var(--shadow-sm);margin-bottom:16px;">
      <div style="padding:14px 20px;background:var(--bg-input);border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <h4 style="font-size:14px;font-weight:700;color:var(--text);margin:0;">🚀 Cross-Cloud Recommendation Matrix</h4>
          <span class="td-badge td-badge-azure" style="font-size:8px;">Intent Optimized</span>
        </div>
        <div style="background:var(--bg);border:1px solid var(--border-light);padding:5px 12px;border-radius:var(--r-xs);font-size:12px;">
          <span style="color:var(--text-3);font-size:9px;text-transform:uppercase;letter-spacing:0.5px;margin-right:6px;">AWS Family:</span>
          <span style="font-weight:700;color:var(--accent);font-family:monospace;">${esc(currentAutoSuggestedFamily)}</span>
        </div>
      </div>

      <!-- Header row -->
      <div style="display:flex;background:var(--bg-input);border-bottom:2px solid var(--border-light);text-transform:uppercase;font-size:9px;color:var(--text-4);font-weight:700;letter-spacing:0.4px;">
        <div style="flex:1;padding:10px 16px;">${providerBadge('aws')}&nbsp; AWS Instance</div>
        <div style="flex:1;padding:10px 16px;border-left:2px solid var(--border-light);">${providerBadge('azure')}&nbsp; Azure Equivalent</div>
        <div style="flex:1;padding:10px 16px;border-left:2px solid var(--border-light);">${providerBadge('gcp')}&nbsp; GCP Equivalent</div>
      </div>
  `;

  pageData.forEach((row, i) => {
    const rowBg = i % 2 === 1 ? 'background:rgba(255,255,255,0.015);' : '';
    const aws = row.aws;
    const az = row.azure;
    const gc = row.gcp;

    let recommendationAlert = '';
    if (aws.recommendation) {
      const rec = aws.recommendation;
      const recHourly = formatPriceRange(
        rec.onDemandHourlyCostMin || rec.onDemandHourlyCost,
        rec.onDemandHourlyCostMax || rec.onDemandHourlyCost,
        ' / hour',
      );
      const recMonthly = formatPriceRange(
        rec.onDemandMonthlyCostMin || rec.onDemandMonthlyCost,
        rec.onDemandMonthlyCostMax || rec.onDemandMonthlyCost,
        ' / month',
      );
      const curHourly = formatPriceRange(
        aws.onDemandHourlyCostMin || aws.onDemandHourlyCost,
        aws.onDemandHourlyCostMax || aws.onDemandHourlyCost,
        ' / hour',
      );
      const curMonthly = formatPriceRange(
        aws.onDemandMonthlyCostMin || aws.onDemandMonthlyCost,
        aws.onDemandMonthlyCostMax || aws.onDemandMonthlyCost,
        ' / month',
      );

      let savingsHtml = '';
      if (
        rec.monthlySavingsMin &&
        rec.monthlySavingsMax &&
        (Number(rec.monthlySavingsMin) > 0 || Number(rec.monthlySavingsMax) > 0)
      ) {
        const savingsRange = formatPriceRange(
          Math.abs(Number(rec.monthlySavingsMin)).toFixed(2),
          Math.abs(Number(rec.monthlySavingsMax)).toFixed(2),
          ' / month',
        );
        savingsHtml = `
          <div style="margin-top:8px; padding:6px 10px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.25); border-radius:var(--r-xs);">
            <div style="font-size:9px; text-transform:uppercase; letter-spacing:0.3px; color:var(--green); font-weight:700; margin-bottom:2px;">Estimated Monthly Savings</div>
            <div style="font-family:monospace; font-size:12px; font-weight:700; color:var(--green);">≈ ${savingsRange}</div>
          </div>
        `;
      }

      recommendationAlert = `
        <div style="margin-top:12px; padding:12px; background:rgba(255,149,0,0.06); border:1px solid rgba(255,149,0,0.2); border-radius:var(--r-sm); font-size:11px;">
          <div style="font-weight:700; color:var(--aws); margin-bottom:8px; font-size:12px;">💡 Generation Upgrade Available</div>
          <div style="display:flex; gap:8px; align-items:stretch;">
            <div style="flex:1; padding:8px 10px; background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.15); border-radius:var(--r-xs);">
              <div style="font-size:8px; text-transform:uppercase; letter-spacing:0.3px; color:var(--red); font-weight:700; margin-bottom:4px;">Current Instance</div>
              <div style="font-family:monospace; font-weight:700; font-size:11px; color:var(--text); margin-bottom:4px;">${esc(aws.instance)}</div>
              <div style="font-size:9px; color:var(--text-4); margin-bottom:2px;">Hourly: ${curHourly}</div>
              <div style="font-size:9px; color:var(--text-4);">Monthly: ≈ ${curMonthly}</div>
            </div>
            <div style="display:flex; align-items:center; font-size:16px; color:var(--aws); font-weight:700;">→</div>
            <div style="flex:1; padding:8px 10px; background:rgba(16,185,129,0.06); border:1px solid rgba(16,185,129,0.15); border-radius:var(--r-xs);">
              <div style="font-size:8px; text-transform:uppercase; letter-spacing:0.3px; color:var(--green); font-weight:700; margin-bottom:4px;">Recommended Instance</div>
              <div style="font-family:monospace; font-weight:700; font-size:11px; color:var(--text); margin-bottom:4px;">${esc(rec.recommendedInstance)}</div>
              <div style="font-size:9px; color:var(--text-4); margin-bottom:2px;">Hourly: ${recHourly}</div>
              <div style="font-size:9px; color:var(--text-4);">Monthly: ≈ ${recMonthly}</div>
            </div>
          </div>
          ${savingsHtml}
        </div>
      `;
    }

    html += `
      <div style="display:flex;border-bottom:1px solid var(--border-light);${rowBg}">
        <div style="flex:1;padding:14px 16px;min-width:0;display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            ${cloudCell({ instanceType: aws.instance, vcpu: aws.vcpu, memoryGib: aws.memoryGib, storageSummary: aws.storageSummary, onDemandHourlyCost: aws.onDemandHourlyCost, onDemandHourlyCostMin: aws.onDemandHourlyCostMin, onDemandHourlyCostMax: aws.onDemandHourlyCostMax, onDemandMonthlyCost: aws.onDemandMonthlyCost, onDemandMonthlyCostMin: aws.onDemandMonthlyCostMin, onDemandMonthlyCostMax: aws.onDemandMonthlyCostMax, category: aws.category, architecture: aws.architecture, generation: aws.generation, currentGeneration: aws.currentGeneration }, true, 100)}
            ${recommendationAlert}
          </div>
        </div>
        <div style="flex:1;padding:14px 16px;border-left:2px solid var(--border-light);min-width:0;">
          ${az ? cloudCell({ instanceType: az.recommendedInstance, vcpu: az.vcpu, memoryGib: az.memoryGib, storageSummary: az.storageSummary, onDemandHourlyCost: az.onDemandHourlyCost, onDemandHourlyCostMin: az.onDemandHourlyCostMin, onDemandHourlyCostMax: az.onDemandHourlyCostMax, onDemandMonthlyCost: az.onDemandMonthlyCost, onDemandMonthlyCostMin: az.onDemandMonthlyCostMin, onDemandMonthlyCostMax: az.onDemandMonthlyCostMax, category: az.category, architecture: az.architecture, generation: az.generation, currentGeneration: az.currentGeneration }, false, az.matchScore, az.reasons) : emptyCell}
        </div>
        <div style="flex:1;padding:14px 16px;border-left:2px solid var(--border-light);min-width:0;">
          ${gc ? cloudCell({ instanceType: gc.recommendedInstance, vcpu: gc.vcpu, memoryGib: gc.memoryGib, storageSummary: gc.storageSummary, onDemandHourlyCost: gc.onDemandHourlyCost, onDemandHourlyCostMin: gc.onDemandHourlyCostMin, onDemandHourlyCostMax: gc.onDemandHourlyCostMax, onDemandMonthlyCost: gc.onDemandMonthlyCost, onDemandMonthlyCostMin: gc.onDemandMonthlyCostMin, onDemandMonthlyCostMax: gc.onDemandMonthlyCostMax, category: gc.category, architecture: gc.architecture, generation: gc.generation, currentGeneration: gc.currentGeneration }, false, gc.matchScore, gc.reasons) : emptyCell}
        </div>
      </div>
    `;
  });

  html += `
      <div class="pagination-container" style="border-top:1px solid var(--border-light); background:var(--bg-input);">
        <div class="pagination-info">
          Showing <strong>${startIdx + 1}</strong>–<strong>${endIdx}</strong> of <strong>${total}</strong> recommendations (Page ${recCurrentPage} of ${maxPage})
        </div>
        <div class="pagination-actions">
          <button class="pagination-btn" onclick="changeRecPage(-1)" ${recCurrentPage === 1 ? 'disabled' : ''}>Previous</button>
          <button class="pagination-btn" onclick="changeRecPage(1)" ${recCurrentPage === maxPage ? 'disabled' : ''}>Next</button>
        </div>
      </div>
      <div style="padding:10px 18px;background:var(--bg-input);border-top:1px solid var(--border-light);font-size:10px;color:var(--text-4);display:flex;align-items:center;gap:6px;">
        <span>ℹ️</span>
        <span>Azure & GCP equivalents matched by nearest workload category, processor architecture, generation, size and price. Prices reflect selected pricing model hourly rates.</span>
      </div>
    </div>
  `;

  out.innerHTML = html;
}

async function getSmartRecommendations() {
  const btn = document.getElementById('btn-rec-search');
  btn.disabled = true;
  btn.innerHTML =
    '<span class="loading-spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></span> Loading...';
  const out = document.getElementById('rec-results');
  out.innerHTML =
    '<div class="loading"><div class="loading-spinner"></div><p>Resolving cross-cloud capability matrix...</p></div>';

  const reqVcpu = parseInt(document.getElementById('rec-vcpu').value) || 4;
  const reqMemoryGib = parseFloat(document.getElementById('rec-memory').value) || 16;
  const region = document.getElementById('rec-region').value || undefined;
  const tenancy = document.getElementById('rec-tenancy').value || undefined;
  const operatingSystem = document.getElementById('rec-os').value || undefined;
  const pricingModel = document.getElementById('rec-pricing-model').value || undefined;

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/instances/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reqVcpu,
        reqMemoryGib,
        region,
        tenancy,
        operatingSystem,
        pricingModel,
      }),
    });
    const d = await res.json();
    if (!d.success || !d.data || d.data.matrixRows.length === 0) {
      currentMatrixRows = [];
      renderRecMatrix();
      return;
    }

    currentMatrixRows = d.data.matrixRows;
    currentAutoSuggestedFamily = d.data.autoSuggestedFamily;
    recCurrentPage = 1;
    renderRecMatrix();
  } catch (err) {
    out.innerHTML = `<div class="results-empty"><h3>Failed to query recommendation engine</h3><p>${esc(err.message)}</p></div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Get Sizing Recommendations &#8594;';
  }
}

function closeModal() {
  document.getElementById('details-modal').classList.remove('open');
}

loadAll();
