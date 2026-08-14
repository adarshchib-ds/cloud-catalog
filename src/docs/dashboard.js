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
  localStorage.setItem('recOs', document.getElementById('rec-os').value);
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
  if (localStorage.getItem('recOs') !== null) {
    document.getElementById('rec-os').value = localStorage.getItem('recOs');
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
    'rec-os',
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
  if (document.getElementById('tab-billing')) document.getElementById('tab-billing').classList.toggle('active', t === 'billing');

  document.getElementById('panel-dict').classList.toggle('active', t === 'dict');
  document.getElementById('panel-calc').classList.toggle('active', t === 'calc');
  document.getElementById('panel-recommend').classList.toggle('active', t === 'recommend');
  if (document.getElementById('panel-billing')) document.getElementById('panel-billing').classList.toggle('active', t === 'billing');

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
      window.cachedMetadata = metaData.data;
      populateVcpuMemFamilies(metaData.data);
      populateTenancies(metaData.data, document.getElementById('calc-provider')?.value);
    }

    await restoreState();
    await fetchInstances();
  } catch (e) {
    document.getElementById('content').innerHTML =
      `<div class="empty"><h3>Failed to load</h3><p>${esc(e.message)}</p></div>`;
  }
}

function formatOsName(os) {
  const map = {
    LINUX: 'Linux (Standard / Amazon Linux)',
    WINDOWS: 'Windows Server',
    UBUNTU: 'Ubuntu / Ubuntu Pro',
    RED_HAT: 'Red Hat Enterprise Linux (RHEL)',
    SUSE: 'SUSE Linux Enterprise (SLES)',
    DEBIAN: 'Debian',
    ALMALINUX: 'AlmaLinux',
    ORACLE_LINUX: 'Oracle Linux',
    FLATCAR: 'Flatcar Linux',
    WINDOWS_SQL_SERVER: 'Windows with SQL Server',
    LINUX_SQL_SERVER: 'Linux with SQL Server',
    RHEL_SAP: 'RHEL for SAP HANA',
    SLES_SAP: 'SLES for SAP HANA',
    MACOS: 'macOS (Apple Silicon / Intel Mac)',
  };
  return map[os] || os.replace(/_/g, ' ');
}

function getOsProviderTag(os, byProvider) {
  if (!byProvider) return '';
  const inAws = Boolean(byProvider.aws?.includes(os));
  const inAzure = Boolean(byProvider.azure?.includes(os));
  const inGcp = Boolean(byProvider.gcp?.includes(os));

  if (inAws && inAzure && inGcp) return ' [AWS, Azure, GCP]';
  if (inAws && inAzure && !inGcp) return ' [AWS, Azure]';
  if (inAws && !inAzure && inGcp) return ' [AWS, GCP]';
  if (!inAws && inAzure && inGcp) return ' [Azure, GCP]';
  if (inAws && !inAzure && !inGcp) return ' [AWS Only]';
  if (!inAws && inAzure && !inGcp) return ' [Azure Only]';
  if (!inAws && !inAzure && inGcp) return ' [GCP Only]';

  return '';
}

function formatTenancyName(t) {
  const map = {
    SHARED: 'Shared (Multi-tenant)',
    DEDICATED: 'Dedicated Instance',
    DEDICATED_INSTANCE: 'Dedicated Instance',
    DEDICATED_HOST: 'Dedicated Host',
    SOLE_TENANT: 'Sole Tenant',
  };
  return map[t] || t.replace(/_/g, ' ');
}

function getTenancyProviderTag(t, tenanciesByProvider) {
  if (!tenanciesByProvider) return '';
  const inAws = Boolean(tenanciesByProvider.aws?.includes(t));
  const inAzure = Boolean(tenanciesByProvider.azure?.includes(t));
  const inGcp = Boolean(tenanciesByProvider.gcp?.includes(t));

  if (inAws && inAzure && inGcp) return ' [AWS, Azure, GCP]';
  if (inAws && inAzure && !inGcp) return ' [AWS, Azure]';
  if (inAws && !inAzure && inGcp) return ' [AWS, GCP]';
  if (!inAws && inAzure && inGcp) return ' [Azure, GCP]';
  if (inAws && !inAzure && !inGcp) return ' [AWS Only]';
  if (!inAws && inAzure && !inGcp) return ' [Azure Only]';
  if (!inAws && !inAzure && inGcp) return ' [GCP Only]';
  return '';
}

function populateTenancies(metaData, selectedProvider) {
  if (!metaData) return;
  const tenancies = metaData.tenancies || ['SHARED', 'DEDICATED_INSTANCE', 'DEDICATED_HOST', 'SOLE_TENANT'];
  const tenanciesByProvider = metaData.tenanciesByProvider;

  const populateSelect = (elementId, providerForSelect) => {
    const el = document.getElementById(elementId);
    if (!el) return;

    const currentVal = el.value;
    el.innerHTML = '<option value="">Any Tenancy</option>';

    let available = tenancies;
    if (providerForSelect && tenanciesByProvider && tenanciesByProvider[providerForSelect]) {
      available = tenanciesByProvider[providerForSelect];
    }

    available.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      const tag = providerForSelect ? '' : getTenancyProviderTag(t, tenanciesByProvider);
      opt.textContent = `${formatTenancyName(t)}${tag}`;
      if (t === currentVal) opt.selected = true;
      el.appendChild(opt);
    });
  };

  populateSelect('calc-tenancy', selectedProvider);
  populateSelect('rec-tenancy', undefined);
}

function populateVcpuMemFamilies(data) {
  const families = data.families || [];
  const vcpus = data.vcpus || [];
  const memories = data.memories || [];
  const operatingSystems = data.operatingSystems || [];

  const recOs = document.getElementById('rec-os');
  if (recOs && operatingSystems.length > 0) {
    const currentOs = recOs.value;
    recOs.innerHTML = '<option value="">Any OS (Default: Linux)</option>';

    const multiCloudOs = [];
    const providerSpecificOs = [];

    operatingSystems.forEach(os => {
      const inAws = data.byProvider?.aws?.includes(os);
      const inAzure = data.byProvider?.azure?.includes(os);
      const inGcp = data.byProvider?.gcp?.includes(os);

      if (inAws && inAzure && inGcp) {
        multiCloudOs.push(os);
      } else {
        providerSpecificOs.push(os);
      }
    });

    if (multiCloudOs.length > 0) {
      const groupMulti = document.createElement('optgroup');
      groupMulti.label = '🌐 Multi-Cloud Supported (AWS, Azure & GCP)';
      multiCloudOs.forEach(os => {
        const opt = document.createElement('option');
        opt.value = os;
        opt.textContent = `${formatOsName(os)} [AWS, Azure, GCP]`;
        if (os === currentOs) opt.selected = true;
        groupMulti.appendChild(opt);
      });
      recOs.appendChild(groupMulti);
    }

    if (providerSpecificOs.length > 0) {
      const groupSpecific = document.createElement('optgroup');
      groupSpecific.label = '🟧 Provider-Specific OS Metadata';
      providerSpecificOs.forEach(os => {
        const opt = document.createElement('option');
        opt.value = os;
        const tag = getOsProviderTag(os, data.byProvider);
        opt.textContent = `${formatOsName(os)}${tag}`;
        if (os === currentOs) opt.selected = true;
        groupSpecific.appendChild(opt);
      });
      recOs.appendChild(groupSpecific);
    }
  }

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
      <td>${esc(inst.storageSummary || inst.storageType || (inst.storageSizeGib ? inst.storageSizeGib + ' GB SSD' : null) || 'SSD')}</td>
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
let calcCurrentPage = 1;
let calcPageSize = 12;

function changeCalcPageSize(newSize) {
  calcPageSize = parseInt(newSize, 10) || 12;
  calcCurrentPage = 1;
  calculate(1);
}

function goToCalcPage(page) {
  const pageNum = parseInt(page, 10) || 1;
  calculate(pageNum);
}

function formatRegionDisplayName(r) {
  if (!r) return '';
  if (r.name && r.name !== r.code) {
    return `${r.name} (${r.code})`;
  }
  return `${r.code}`;
}

async function loadRecRegions() {
  const sel = document.getElementById('rec-region');
  if (!sel) return;
  sel.innerHTML = '<option value="">Loading regions...</option>';
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/instances/regions`);
    const data = await res.json();
    sel.innerHTML = '<option value="">Any Region (Global Search)</option>';
    if (data.success && data.data) {
      data.data.forEach(r => {
        const o = document.createElement('option');
        o.value = r.code;
        o.textContent = formatRegionDisplayName(r);
        sel.appendChild(o);
      });
    }
  } catch (e) {
    console.error('Failed to load recommendation regions', e);
    sel.innerHTML = '<option value="">Any Region (Global Search)</option>';
  }
}

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
        o.textContent = formatRegionDisplayName(r);
        sel.appendChild(o);
      });
    }
  } catch (e) {
    console.error('Failed to load regions', e);
    sel.innerHTML = '<option value="">Any Region</option>';
  }

  if (window.cachedMetadata) {
    populateTenancies(window.cachedMetadata, p);
  }
}
onCalcProviderChange();

function clearCalcForm() {
  calcCurrentPage = 1;
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

function renderCalcPaginationControls(totalFamilies, totalPages) {
  let pageOptions = '';
  for (let i = 1; i <= totalPages; i++) {
    pageOptions += `<option value="${i}" ${i === calcCurrentPage ? 'selected' : ''}>Page ${i} of ${totalPages}</option>`;
  }

  const pageSizeOptions = [12, 24, 48]
    .map(
      size =>
        `<option value="${size}" ${size === calcPageSize ? 'selected' : ''}>${size} per page</option>`,
    )
    .join('');

  const startIdx = (calcCurrentPage - 1) * calcPageSize + 1;
  const endIdx = Math.min(calcCurrentPage * calcPageSize, totalFamilies);

  return `
    <div class="calc-pagination-bar">
      <div class="calc-pagination-left">
        <span class="pagination-info">Showing <strong>${startIdx}–${endIdx}</strong> of <strong>${totalFamilies}</strong> families</span>
      </div>
      <div class="calc-pagination-right">
        <label class="calc-page-label">Show:
          <select class="form-select calc-select-sm" onchange="changeCalcPageSize(this.value)">
            ${pageSizeOptions}
          </select>
        </label>
        <label class="calc-page-label">Jump to:
          <select class="form-select calc-select-sm" onchange="goToCalcPage(this.value)">
            ${pageOptions}
          </select>
        </label>
        <div class="pagination-buttons">
          <button class="pagination-btn" onclick="changeCalcPage(-1)" ${calcCurrentPage <= 1 ? 'disabled' : ''}>&#8592; Prev</button>
          <button class="pagination-btn" onclick="changeCalcPage(1)" ${calcCurrentPage >= totalPages ? 'disabled' : ''}>Next &#8594;</button>
        </div>
      </div>
    </div>
  `;
}

async function calculate(page = 1) {
  calcCurrentPage = page;
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

  params.set('page', calcCurrentPage);
  params.set('pageSize', calcPageSize);

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
    const meta = data.meta || { page: 1, pageSize: calcPageSize, totalCount: families.length, totalPages: 1 };
    const totalFamilies = meta.totalCount || families.length;
    const totalPages = meta.totalPages || Math.ceil(totalFamilies / calcPageSize);
    const totalInstances = families.reduce((sum, f) => sum + f.instanceCount, 0);
    const gpuFamilies = families.filter(f => f.hasGpu).length;

    let html = '';

    html += `<div class="insight-box"><div class="insight-title">&#9670; Results Summary</div><div class="insight-list">
      <div class="insight-item"><span class="insight-bullet ib-blue">${totalFamilies}</span><span><strong>${totalFamilies} instance families</strong> match your criteria</span></div>
      <div class="insight-item"><span class="insight-bullet ib-amber">${totalInstances}</span><span><strong>${totalInstances} total instances</strong> on this page</span></div>
      ${gpuFamilies > 0 ? `<div class="insight-item"><span class="insight-bullet ib-green">${gpuFamilies}</span><span><strong>${gpuFamilies} GPU-capable families</strong> on this page</span></div>` : ''}
    </div></div>`;

    if (totalFamilies > 0) {
      html += renderCalcPaginationControls(totalFamilies, totalPages);
    }

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

    if (totalFamilies > 0) {
      html += renderCalcPaginationControls(totalFamilies, totalPages);
    }

    out.innerHTML = html;
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    out.innerHTML = `<div class="results-empty"><h3>Search failed</h3><p>${esc(e.message)}</p></div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Find Families &#8594;';
  }
}

function changeCalcPage(dir) {
  calcCurrentPage += dir;
  if (calcCurrentPage < 1) calcCurrentPage = 1;
  calculate(calcCurrentPage);
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
        <td>${esc(inst.storageSummary || inst.storageType || (inst.storageSizeGib ? inst.storageSizeGib + ' GB SSD' : null) || 'SSD')}</td>
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
      } else {
        html += '<div class="equiv-section" style="padding: 24px; text-align: center; color: var(--text-3); font-size: 13px;">';
        html += '<div class="equiv-section-header" style="justify-content: center; margin-bottom: 8px;">&#9878; Cross-Cloud Equivalents</div>';
        html += '<div style="color: var(--text-2); font-weight: 500;">No exact cross-cloud equivalent instances are currently available for this family tier across Azure or GCP.</div>';
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

  // Bind monthly/hourly cost estimation directly from backend pre-calculated fields
  const hourlyText = data.formattedHourly || (data.hourlyCost ? `$${Number(data.hourlyCost).toFixed(4)} / hr` : '--');
  const monthlyText = data.formattedMonthly || (data.monthlyCost ? `$${Number(data.monthlyCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / mo` : '--');

  const hourlyEl = document.getElementById('modal-price-hourly');
  const monthlyEl = document.getElementById('modal-price-monthly');
  const costWrapper = document.getElementById('item-monthly-cost');

  if (hourlyEl && monthlyEl && costWrapper) {
    if (hourlyText === '--' && monthlyText === '--') {
      costWrapper.style.display = 'none';
    } else {
      hourlyEl.innerText = hourlyText;
      monthlyEl.innerText = monthlyText;
      costWrapper.style.display = 'block';
    }
  }

  // Bind generation-based recommendation upgrade
  const upgradeWrapper = document.getElementById('item-rec-upgrade');
  const upgradeSpan = document.getElementById('modal-rec-upgrade');
  if (!data.currentGeneration && data.recommendation) {
    const recRangeText =
      data.recommendation.formattedRange ||
      (data.recommendation.onDemandHourlyCost && data.recommendation.onDemandMonthlyCost
        ? `$${Number(data.recommendation.onDemandHourlyCost).toFixed(4)}/hr (≈ $${Number(data.recommendation.onDemandMonthlyCost).toFixed(2)}/mo)`
        : '');

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

    const osBadge = inst.operatingSystem
      ? `<span style="font-size:8px; background:rgba(0,184,107,0.12); padding:1px 5px; border-radius:3px; color:var(--green); font-weight:700; text-transform:uppercase;">${esc(inst.operatingSystem)}</span>`
      : '';

    const tenancyBadge = inst.tenancy
      ? `<span style="font-size:8px; background:rgba(124,58,237,0.12); padding:1px 5px; border-radius:3px; color:#9333ea; font-weight:700; text-transform:uppercase;">${esc(formatTenancyName(inst.tenancy))}</span>`
      : '';

    const licenseBadge = inst.licenseType === 'BYOL'
      ? `<span style="font-size:8px; background:rgba(255,149,0,0.12); padding:1px 5px; border-radius:3px; color:var(--aws); font-weight:700; text-transform:uppercase;">BYOL (No License)</span>`
      : `<span style="font-size:8px; background:rgba(0,120,212,0.12); padding:1px 5px; border-radius:3px; color:var(--accent); font-weight:700; text-transform:uppercase;">License Included</span>`;

    const metaHtml = `
      <div style="margin-top:6px; display:flex; gap:4px; flex-wrap:wrap;">
        ${osBadge}
        ${tenancyBadge}
        ${licenseBadge}
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
          <span style="color:var(--text-3);font-size:9px;text-transform:uppercase;letter-spacing:0.5px;margin-right:6px;">Baseline Family:</span>
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

    const baseInst = aws || az || gc;

    let recommendationAlert = '';
    if (baseInst && baseInst.recommendation) {
      const rec = baseInst.recommendation;
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
        baseInst.onDemandHourlyCostMin || baseInst.onDemandHourlyCost,
        baseInst.onDemandHourlyCostMax || baseInst.onDemandHourlyCost,
        ' / hour',
      );
      const curMonthly = formatPriceRange(
        baseInst.onDemandMonthlyCostMin || baseInst.onDemandMonthlyCost,
        baseInst.onDemandMonthlyCostMax || baseInst.onDemandMonthlyCost,
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
              <div style="font-family:monospace; font-weight:700; font-size:11px; color:var(--text); margin-bottom:4px;">${esc(baseInst.instance || baseInst.instanceType)}</div>
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

    const getEmptyCell = (providerSlug) => {
      const selectedOs = document.getElementById('rec-os')?.value;
      if (selectedOs === 'UBUNTU' || selectedOs === 'RED_HAT' || selectedOs === 'SUSE' || selectedOs === 'MACOS') {
        const osLabel = formatOsName(selectedOs);
        const pName = providerSlug === 'azure' ? 'Azure' : providerSlug === 'aws' ? 'AWS' : 'GCP';
        return `
          <div style="padding:12px; background:rgba(255,149,0,0.05); border:1px dashed rgba(255,149,0,0.25); border-radius:6px;">
            <div style="font-size:11px; font-weight:700; color:var(--aws); margin-bottom:4px;">No direct ${esc(osLabel)} SKU</div>
            <div style="font-size:10px; color:var(--text-3); line-height:1.4;">${pName} stores base compute under generic <strong>Linux</strong> rates. Select <strong>Linux</strong> in the dropdown to compare ${pName} rates.</div>
          </div>
        `;
      }
      return `<div style="color:var(--text-4);font-size:11px;font-style:italic;">No equivalent found</div>`;
    };

    const renderCell = (inst, isAws, slug) => {
      if (!inst) return getEmptyCell(slug);
      return cloudCell(
        {
          instanceType: inst.instance || inst.instanceType || inst.recommendedInstance,
          recommendedInstance: inst.recommendedInstance || inst.instance || inst.instanceType,
          vcpu: inst.vcpu,
          memoryGib: inst.memoryGib,
          storageSummary: inst.storageSummary,
          onDemandHourlyCost: inst.onDemandHourlyCost,
          onDemandHourlyCostMin: inst.onDemandHourlyCostMin,
          onDemandHourlyCostMax: inst.onDemandHourlyCostMax,
          onDemandMonthlyCost: inst.onDemandMonthlyCost,
          onDemandMonthlyCostMin: inst.onDemandMonthlyCostMin,
          onDemandMonthlyCostMax: inst.onDemandMonthlyCostMax,
          category: inst.category,
          architecture: inst.architecture,
          generation: inst.generation,
          currentGeneration: inst.currentGeneration,
          operatingSystem: inst.operatingSystem,
          tenancy: inst.tenancy,
          licenseType: inst.licenseType,
        },
        isAws,
        inst.matchScore,
        inst.reasons,
      );
    };

    html += `
      <div style="display:flex;border-bottom:1px solid var(--border-light);${rowBg}">
        <div style="flex:1;padding:14px 16px;min-width:0;display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            ${renderCell(aws, true, 'aws')}
            ${aws ? recommendationAlert : ''}
          </div>
        </div>
        <div style="flex:1;padding:14px 16px;border-left:2px solid var(--border-light);min-width:0;">
          ${renderCell(az, false, 'azure')}
        </div>
        <div style="flex:1;padding:14px 16px;border-left:2px solid var(--border-light);min-width:0;">
          ${renderCell(gc, false, 'gcp')}
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

  const vcpuVal = document.getElementById('rec-vcpu').value;
  const memoryVal = document.getElementById('rec-memory').value;
  const reqVcpu = vcpuVal ? parseInt(vcpuVal) : undefined;
  const reqMemoryGib = memoryVal ? parseFloat(memoryVal) : undefined;
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

// ═════════════════════════════════════════════════════════════════════
// BILLING MANAGEMENT & MULTI-CLOUD INVOICE FETCHING
// ═════════════════════════════════════════════════════════════════════

const PROVIDER_CONFIG = {
  aws: {
    name: 'Amazon Web Services',
    shortName: 'AWS',
    badgeClass: 'provider-badge-aws',
    serviceProvider: {
      name: 'Amazon Web Services LLC',
      address: '410 Terry Avenue North, Seattle WA 98109-5210'
    },
    labels: {
      accountId: 'AWS Account ID (Optional)',
      accountIdPlaceholder: '12-digit AWS Account ID (e.g. 123456789012)',
      accessKeyId: 'AWS Access Key ID (Optional)',
      secretAccessKey: 'AWS Secret Access Key (Optional)',
      region: 'Target Region'
    }
  },
  azure: {
    name: 'Microsoft Azure',
    shortName: 'Azure',
    badgeClass: 'provider-badge-azure',
    serviceProvider: {
      name: 'Microsoft Corporation (Azure Billing)',
      address: 'One Microsoft Way, Redmond WA 98052-6399'
    },
    labels: {
      accountId: 'Azure Subscription ID (Optional)',
      accountIdPlaceholder: 'Azure Subscription GUID',
      accessKeyId: 'Azure Client ID (Optional)',
      secretAccessKey: 'Azure Client Secret (Optional)',
      region: 'Tenant ID / Region'
    }
  },
  gcp: {
    name: 'Google Cloud Platform',
    shortName: 'GCP',
    badgeClass: 'provider-badge-gcp',
    serviceProvider: {
      name: 'Google LLC (Google Cloud)',
      address: '1600 Amphitheatre Parkway, Mountain View CA 94043'
    },
    labels: {
      accountId: 'GCP Project ID (Optional)',
      accountIdPlaceholder: 'e.g. project-fa402b51',
      accessKeyId: 'Client Email / Service Account (Optional)',
      secretAccessKey: 'Private Key (Optional)',
      region: 'Target Region'
    }
  }
};

function onBillingProviderChange() {
  const providerKey = document.getElementById('billing-provider').value;
  const config = PROVIDER_CONFIG[providerKey] || PROVIDER_CONFIG.aws;

  const lblAccountId = document.getElementById('label-billing-account-id');
  const inputAccountId = document.getElementById('billing-account-id');
  const lblAccessKey = document.getElementById('label-billing-access-key');
  const inputAccessKey = document.getElementById('billing-access-key');
  const lblSecretKey = document.getElementById('label-billing-secret-key');
  const inputSecretKey = document.getElementById('billing-secret-key');
  const groupAccessKey = inputAccessKey ? inputAccessKey.closest('.form-group') : null;
  const groupSecretKey = inputSecretKey ? inputSecretKey.closest('.form-group') : null;
  const lblRegion = document.getElementById('label-billing-region');

  if (lblAccountId) lblAccountId.innerText = config.labels.accountId;
  if (inputAccountId) inputAccountId.placeholder = config.labels.accountIdPlaceholder;
  if (lblAccessKey) lblAccessKey.innerText = config.labels.accessKeyId;
  if (lblSecretKey) lblSecretKey.innerText = config.labels.secretAccessKey;
  if (lblRegion) lblRegion.innerText = config.labels.region;

  // Show/Hide Access Key fields dynamically based on provider
  if (providerKey === 'aws') {
    if (groupAccessKey) groupAccessKey.style.display = 'block';
    if (groupSecretKey) groupSecretKey.style.display = 'block';
    if (inputAccessKey) inputAccessKey.placeholder = 'Optional (or leave blank for 1-Click Connect)';
    if (inputSecretKey) inputSecretKey.placeholder = 'Optional (or leave blank for 1-Click Connect)';
  } else if (providerKey === 'azure') {
    if (groupAccessKey) groupAccessKey.style.display = 'block';
    if (groupSecretKey) groupSecretKey.style.display = 'block';
    if (inputAccessKey) inputAccessKey.placeholder = 'Azure Client ID / Tenant ID';
    if (inputSecretKey) inputSecretKey.placeholder = 'Azure Client Secret';
  } else if (providerKey === 'gcp') {
    if (groupAccessKey) groupAccessKey.style.display = 'block';
    if (groupSecretKey) groupSecretKey.style.display = 'block';
    if (inputAccessKey) inputAccessKey.placeholder = 'Service Account Email';
    if (inputSecretKey) inputSecretKey.placeholder = 'Private Key Path / Credential JSON';
  }
}

function clearBillingForm() {
  if (document.getElementById('billing-account-id')) document.getElementById('billing-account-id').value = '';
  document.getElementById('billing-access-key').value = '';
  document.getElementById('billing-secret-key').value = '';
  document.getElementById('billing-region').value = 'us-east-1';
  document.getElementById('billing-results').innerHTML = `
    <div class="results-empty">
      <h3>No Billing Data Loaded</h3>
      <p>Click "Fetch Billing Statement" above to pull live invoice and service cost data.</p>
    </div>
  `;
}

async function fetchAwsBillingData() {
  const provider = document.getElementById('billing-provider').value;
  const accountId = document.getElementById('billing-account-id') ? document.getElementById('billing-account-id').value.trim() : '';
  const accessKeyId = document.getElementById('billing-access-key').value.trim();
  const secretAccessKey = document.getElementById('billing-secret-key').value.trim();
  const region = document.getElementById('billing-region').value;

  const resultsContainer = document.getElementById('billing-results');
  const btn = document.getElementById('btn-billing-fetch');

  btn.disabled = true;
  btn.innerHTML = `<div class="loading-spinner" style="width:16px;height:16px;display:inline-block;margin-right:8px;"></div> Fetching Live ${provider.toUpperCase()} Invoice...`;

  resultsContainer.innerHTML = `
    <div class="loading">
      <div class="loading-spinner"></div>
      <p>Connecting to ${provider.toUpperCase()} Billing & Cost APIs...</p>
    </div>
  `;

  try {
    // If user selected AWS and entered a 12-digit Account ID WITHOUT custom access keys, route straight to 1-Click CloudFormation Connect
    if (provider === 'aws' && /^\d{12}$/.test(accountId) && !accessKeyId && !secretAccessKey) {
      renderCloudFormationConnectCard(accountId);
      return;
    }

    const payload = {};
    if (accountId) payload.accountId = accountId;
    if (accessKeyId) {
      if (!payload.accountId && /^\d{12}$/.test(accessKeyId)) {
        payload.accountId = accessKeyId;
      } else {
        payload.accessKeyId = accessKeyId;
      }
    }
    if (secretAccessKey) payload.secretAccessKey = secretAccessKey;
    if (region) payload.region = region;

    // Determine backend API endpoint according to selected cloud provider
    let endpoint = `${BACKEND_URL}/api/v1/${provider}/account-billing`;
    
    // Check if provider route exists
    if (provider !== 'aws') {
      resultsContainer.innerHTML = `
        <div class="results-empty" style="border-color: rgba(234, 179, 8, 0.3);">
          <h3 style="color: #eab308;">${provider.toUpperCase()} Billing Integration In Progress</h3>
          <p>Real-time billing statement ingestion for <strong>${provider.toUpperCase()}</strong> is currently under development. Please select <strong>AWS (Amazon Web Services)</strong> to test live billing features.</p>
        </div>
      `;
      return;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (!result.success || !result.data) {
      // If error occurs and provider is AWS, check if user provided a 12-digit account ID to offer 1-Click CloudFormation Connect
      if (provider === 'aws' && /^\d{12}$/.test(accountId)) {
        renderCloudFormationConnectCard(accountId, result.error?.message);
        return;
      }
      throw new Error(result.error?.message || `Failed to fetch billing data from ${provider.toUpperCase()} Cost Explorer`);
    }

    const b = result.data;
    renderCloudCatalogInvoiceCard(b, provider);

  } catch (err) {
    if (provider === 'aws' && /^\d{12}$/.test(accountId)) {
      renderCloudFormationConnectCard(accountId, err.message);
    } else {
      resultsContainer.innerHTML = `
        <div class="results-empty" style="border-color: rgba(239, 68, 68, 0.3);">
          <h3 style="color: var(--red);">Error Fetching ${provider.toUpperCase()} Billing Statement</h3>
          <p>${esc(err.message)}</p>
        </div>
      `;
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Fetch Billing Statement &#8594;';
  }
}

async function renderCloudFormationConnectCard(awsAccountId, errorMsg, existingLinkData) {
  const container = document.getElementById('billing-results');
  if (!existingLinkData) {
    container.innerHTML = `
      <div class="loading">
        <div class="loading-spinner"></div>
        <p>Generating 1-Click CloudFormation Launch Link for Account ${esc(awsAccountId)}...</p>
      </div>
    `;
  }

  try {
    let linkData = existingLinkData;
    if (!linkData) {
      const res = await fetch(`${BACKEND_URL}/api/v1/aws/generate-connect-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aws_account_id: awsAccountId })
      });
      const result = await res.json();

      if (!result.success || !result.data) {
        throw new Error(result.error?.message || 'Failed to generate CloudFormation connect link');
      }
      linkData = result.data;
    }
      window.lastCloudCatalogConnectLink = linkData;
      container.innerHTML = `
        <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 12px; padding: 24px; color: #f8fafc; font-family: sans-serif;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
            <h3 style="margin: 0; color: #818cf8; font-size: 1.25rem;">🚀 Connect AWS Account ${esc(awsAccountId)}</h3>
            <span style="background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600;">
              Zero Secrets • Read-Only IAM • $0 Customer Cost
            </span>
          </div>
          
          <p style="color: #94a3b8; font-size: 0.9rem; line-height: 1.5; margin-bottom: 20px;">
            ${errorMsg ? `<strong style="color: #f87171;">Note:</strong> ${esc(errorMsg)}<br>` : ''}
            To grant Cloud Catalog secure, read-only access to ingest billing & owner profile data for account <strong>${esc(awsAccountId)}</strong>, click the 1-Click Stack button below to create a free IAM role in your AWS Console.
          </p>

          <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px;">
            <a href="${esc(linkData.quick_create_url)}" target="_blank" rel="noopener" style="background: linear-gradient(135deg, #6366f1, #4f46e5); color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; display: inline-flex; align-items: center; gap: 8px;">
              <span>🚀 Launch 1-Click AWS Stack</span> &#8599;
            </a>
            <button onclick="verifyAndFetchAssumedRoleBilling('${esc(awsAccountId)}', window.lastCloudCatalogConnectLink)" style="background: #1e293b; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer;">
              🔄 Verify & Fetch Billing Data
            </button>
          </div>

        <div style="font-size: 0.8rem; color: #64748b; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px;">
          🔒 <strong>Security Guarantee:</strong> Cloud Catalog uses AWS STS ExternalId (<code>${esc(linkData.external_id)}</code>) to prevent confused deputy attacks. Your static credentials are never shared or stored.
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div class="results-empty" style="border-color: rgba(239, 68, 68, 0.3);">
        <h3 style="color: var(--red);">CloudFormation Connect Error</h3>
        <p>${esc(err.message)}</p>
      </div>
    `;
  }
}

async function verifyAndFetchAssumedRoleBilling(awsAccountId, linkData) {
  const container = document.getElementById('billing-results');
  container.innerHTML = `
    <div class="loading">
      <div class="loading-spinner"></div>
      <p>Verifying IAM Cross-Account Role & Ingesting Billing Data for Account ${esc(awsAccountId)}...</p>
    </div>
  `;

  try {
    const bodyPayload = { aws_account_id: awsAccountId, force_refresh: false };
    if (linkData && linkData.external_id) {
      bodyPayload.external_id = linkData.external_id;
    }

    const res = await fetch(`${BACKEND_URL}/api/v1/aws/fetch-billing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    const result = await res.json();

    if (!result.success || !result.data) {
      throw new Error(result.error?.message || 'AccessDenied: CloudFormation stack creation is still in progress in AWS');
    }

    const payload = result.data;
    renderCloudCatalogInvoiceCard(payload.billing, 'aws');
  } catch (err) {
    renderCloudFormationConnectCard(awsAccountId, err.message, linkData);
  }
}

function renderCloudCatalogInvoiceCard(data, providerKey) {
  const container = document.getElementById('billing-results');
  const providerConfig = PROVIDER_CONFIG[providerKey] || PROVIDER_CONFIG.aws;
  const b = (data && data.billing) ? data.billing : (data || {});

  const rowsHtml = (b.servicesBreakdownTable || []).map(s => `
    <tr>
      <td style="padding: 7px 12px;">${esc(s.serviceName)}</td>
      <td style="text-align: right; padding: 7px 12px; font-weight: bold;">${esc(s.amountDueFormatted)}</td>
    </tr>
  `).join('');

  const accountIdStr = String(b.invoiceHeader?.accountID || '');
  const invoiceNo = `INV-${accountIdStr.slice(-6)}-${(b.invoiceHeader?.statementDate || '').replace(/-/g, '')}`;
  const addressDetails = [b.billTo?.addressLine1, b.billTo?.cityStateZip, b.billTo?.country].filter(Boolean).filter(s => s !== 'N/A' && s.trim().length > 0).join('<br>') || 'Default Billing Profile';

  const html = `
    <div class="cc-invoice-card">
      <!-- Top Cloud Catalog Header -->
      <div class="cc-invoice-header">
        <div class="cc-brand-container">
          <div class="cc-brand-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19.5H19a3 3 0 0 0 3-3 3 3 0 0 0-3-3c-.1 0-.2 0-.3.02C18.2 10.4 15.3 8 12 8c-3.1 0-5.8 2.1-6.6 5.1C5.1 13.04 4.6 13 4 13a4 4 0 0 0-4 4 4 4 0 0 0 4 4h13.5z"></path></svg>
          </div>
          <div>
            <div class="cc-brand-title">Cloud Catalog</div>
            <div class="cc-brand-subtitle">Unified Multi-Cloud Billing & Cost Management</div>
          </div>
        </div>
        <div class="provider-badge ${providerConfig.badgeClass}">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:currentColor;"></span>
          ${providerConfig.name}
        </div>
      </div>

      <!-- Formal Greeting & Summary Box from Cloud Catalog -->
      <div class="cc-greeting-box">
        <h4>Greetings from Cloud Catalog,</h4>
        <p>We're writing to provide you with a consolidated electronic invoice statement for your use of <strong>${providerConfig.name}</strong> services. Your account will be charged <strong>${esc(b.summary.totalDueFormatted)}</strong>. Additional information regarding your bill, individual service charge details, and your account history are available on the Account Summary Page.</p>
      </div>

      <!-- Account Summary Header Table -->
      <table class="aws-table">
        <thead>
          <tr>
            <th>Account / Subscription ID</th>
            <th>Invoice No</th>
            <th>Statement Date</th>
            <th>Payment Due Date</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>${esc(b.invoiceHeader.accountID)}</strong></td>
            <td>${esc(invoiceNo)}</td>
            <td>${esc(b.invoiceHeader.statementDate)}</td>
            <td>${esc(b.invoiceHeader.statementDate)}</td>
          </tr>
        </tbody>
      </table>

      <!-- Bill To & Service Provider Info Columns -->
      <div class="aws-two-col">
        <div class="aws-info-block">
          <div class="aws-info-block-title">Bill To</div>
          <div><strong>Attn: ${esc(b.billTo.name)}</strong></div>
          <div>${esc(b.billTo.addressLine1)}</div>
          <div>${esc(b.billTo.cityStateZip)}</div>
          <div>${esc(b.billTo.country)}</div>
        </div>
        <div class="aws-info-block">
          <div class="aws-info-block-title">Service Provider</div>
          <div><strong>${esc(providerConfig.serviceProvider.name)}</strong></div>
          <div>${esc(providerConfig.serviceProvider.address)}</div>
        </div>
      </div>

      <!-- Service Breakdown Invoice Table -->
      <table class="aws-table">
        <thead>
          <tr class="aws-table-header-row">
            <td colspan="2">Billing Period: ${esc(b.invoiceHeader.billingPeriod)} (${providerConfig.shortName})</td>
          </tr>
          <tr>
            <th>Service Name</th>
            <th style="text-align: right;">Amount Due</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr>
            <td style="font-weight: bold; background: #f2f2f2;">Taxes*:</td>
            <td style="text-align: right; font-weight: bold; background: #f2f2f2;">$ 0.00</td>
          </tr>
          <tr class="aws-total-highlight">
            <td style="background: #e8e8e8; font-size: 14px;">Total due in US Dollars</td>
            <td style="text-align: right; background: #e8e8e8; font-size: 14px;">${esc(b.summary.totalDueFormatted)}</td>
          </tr>
        </tbody>
      </table>

      <!-- Official Platform Notes & Legal Footer -->
      <div class="aws-invoice-footer-notes">
        <p><em>*This is an official consolidated electronic billing statement generated by Cloud Catalog Platform.</em></p>
        <p>All cloud web services are billed for use of ${providerConfig.name} (${providerConfig.serviceProvider.name}).</p>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

loadAll();

