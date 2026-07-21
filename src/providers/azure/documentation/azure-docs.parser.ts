import { logger } from '../../../config/logger';

export interface ParsedVmSize {
  name: string;
  vcpu: number;
  memoryGib: number;
  maxDataDisks: number | null;
  maxNics: number | null;
  networkBandwidthMbps: number | null;
  tempStorageGib: number | null;
  tempStorageIops: number | null;
}

export interface ParsedFeatures {
  premiumStorageSupported: boolean | null;
  liveMigrationSupported: boolean | null;
  nestedVirtualizationSupported: boolean | null;
  acceleratedNetworkingSupported: boolean | null;
}

export interface ParsedSeries {
  seriesName: string;
  sizes: ParsedVmSize[];
  features: ParsedFeatures;
  processor: string | null;
  architecture: string | null;
}

/**
 * Parses VM series markdown content and extracts structured specs & capabilities.
 */
export function parseSeriesMarkdown(markdown: string, path: string): ParsedSeries {
  const filename = path.split('/').pop() || '';
  const seriesName = filename.replace('-series.md', '');

  const sizesMap = new Map<string, ParsedVmSize>();
  const features: ParsedFeatures = {
    premiumStorageSupported: null,
    liveMigrationSupported: null,
    nestedVirtualizationSupported: null,
    acceleratedNetworkingSupported: null,
  };

  let processor: string | null = null;
  let architecture: string | null = null;

  try {
    const lines = markdown.split(/\r?\n/);
    // Scan for tables under Tabs or headings
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // If we find a Markdown table header, parse the table
      if (
        line.startsWith('|') &&
        lines[i + 1]?.trim().startsWith('|') &&
        lines[i + 1]?.trim().includes('-')
      ) {
        const tableLines: string[] = [];
        let j = i;
        while (j < lines.length && lines[j].trim().startsWith('|')) {
          tableLines.push(lines[j].trim());
          j++;
        }
        i = j - 1; // Advance main loop index

        parseTable(tableLines, sizesMap, features);
      }

      // Basic processor/architecture extraction heuristics from description text
      if (
        !processor &&
        line.includes('processor') &&
        (line.includes('Xeon') || line.includes('EPYC') || line.includes('Ampere'))
      ) {
        if (line.includes('AMD EPYC')) {
          processor = 'AMD EPYC';
        } else if (line.includes('Intel Xeon')) {
          processor = 'Intel Xeon';
        } else if (line.includes('Ampere Altra')) {
          processor = 'Ampere Altra';
        }
      }

      if (
        !architecture &&
        (line.includes('x64') ||
          line.includes('x86-64') ||
          line.includes('ARM64') ||
          line.includes('Arm64'))
      ) {
        architecture = line.includes('ARM64') || line.includes('Arm64') ? 'ARM64' : 'X86_64';
      }
    }
  } catch (error) {
    logger.warn(`Error parsing markdown series ${seriesName}: ${error}`);
  }

  // Fallbacks if not detected
  if (!architecture) {
    architecture =
      seriesName.startsWith('ps') || seriesName.includes('cobalt') || seriesName.startsWith('as')
        ? 'ARM64'
        : 'X86_64';
  }

  return {
    seriesName,
    sizes: Array.from(sizesMap.values()),
    features,
    processor,
    architecture,
  };
}

function parseTable(
  tableLines: string[],
  sizesMap: Map<string, ParsedVmSize>,
  features: ParsedFeatures,
) {
  if (tableLines.length < 3) return;

  const headers = tableLines[0]
    .split('|')
    .map(h => h.trim().toLowerCase())
    .filter(h => h !== '');

  // Helper to extract a value by header name from row cells
  const getVal = (cells: string[], headerName: string): string => {
    const idx = headers.findIndex(h => h.includes(headerName));
    return idx !== -1 ? cells[idx]?.trim() || '' : '';
  };

  for (let k = 2; k < tableLines.length; k++) {
    const cells = tableLines[k]
      .split('|')
      .map(c => c.trim())
      .filter((_, idx) => idx > 0 && idx <= headers.length);

    if (cells.length === 0) continue;

    // The name of the SKU (e.g. Standard_D2s_v5 or standard_d2s_v5)
    let sizeName = getVal(cells, 'size') || getVal(cells, 'name');
    if (!sizeName || sizeName.startsWith('---') || sizeName.toLowerCase() === 'size') continue;

    // Keep name case standard (usually Standard_D2s_v5)
    if (!sizeName.startsWith('Standard_') && !sizeName.startsWith('Basic_')) {
      // Normalize casing
      sizeName = sizeName.charAt(0).toUpperCase() + sizeName.slice(1);
    }

    let sizeObj = sizesMap.get(sizeName);
    if (!sizeObj) {
      sizeObj = {
        name: sizeName,
        vcpu: 0,
        memoryGib: 0,
        maxDataDisks: null,
        maxNics: null,
        networkBandwidthMbps: null,
        tempStorageGib: null,
        tempStorageIops: null,
      };
      sizesMap.set(sizeName, sizeObj);
    }

    // Populate properties based on tab columns
    const vcpuStr = getVal(cells, 'vcpu');
    if (vcpuStr) {
      sizeObj.vcpu = parseInt(vcpuStr.replace(/[^0-9]/g, ''), 10) || sizeObj.vcpu;
    }

    const memStr = getVal(cells, 'memory');
    if (memStr) {
      // Memory is usually in GiB, e.g. "8" or "8 GiB"
      sizeObj.memoryGib = parseFloat(memStr.replace(/[^0-9.]/g, '')) || sizeObj.memoryGib;
    }

    const nicsStr = getVal(cells, 'nic');
    if (nicsStr) {
      sizeObj.maxNics = parseInt(nicsStr.replace(/[^0-9]/g, ''), 10) || null;
    }

    const disksStr = getVal(cells, 'disk');
    if (
      disksStr &&
      !disksStr.toLowerCase().includes('temp') &&
      !disksStr.toLowerCase().includes('os')
    ) {
      sizeObj.maxDataDisks = parseInt(disksStr.replace(/[^0-9]/g, ''), 10) || null;
    }

    const bandwidthStr = getVal(cells, 'bandwidth') || getVal(cells, 'throughput');
    if (bandwidthStr) {
      // e.g. "12,500" or "12500 Mbps"
      const val = parseInt(bandwidthStr.replace(/[^0-9]/g, ''), 10);
      if (val) sizeObj.networkBandwidthMbps = val;
    }

    const tempStr = getVal(cells, 'temp') || getVal(cells, 'local storage');
    if (tempStr) {
      if (
        tempStr.toLowerCase().includes('none') ||
        tempStr.toLowerCase().includes('not supported')
      ) {
        sizeObj.tempStorageGib = 0;
      } else {
        const val = parseFloat(tempStr.replace(/[^0-9.]/g, ''));
        if (val) sizeObj.tempStorageGib = val;
      }
    }

    // Parse supported features list table
    const featName = getVal(cells, 'feature');
    const statusVal = getVal(cells, 'support') || getVal(cells, 'status');
    if (featName && statusVal) {
      const isSupported =
        statusVal.toLowerCase().includes('yes') ||
        statusVal.toLowerCase().includes('supported') ||
        statusVal.toLowerCase().includes('required');
      if (featName.includes('premium')) features.premiumStorageSupported = isSupported;
      if (featName.includes('nested')) features.nestedVirtualizationSupported = isSupported;
      if (featName.includes('live')) features.liveMigrationSupported = isSupported;
      if (featName.includes('accelerated')) features.acceleratedNetworkingSupported = isSupported;
    }
  }
}
