import { logger } from '../../../config/logger';

export interface AzureLifecycleLookup {
  previousGenSet: Set<string>;
  retiredSet: Set<string>;
  isCurrentGeneration: (skuName: string) => boolean;
}

// Official Microsoft Learn raw GitHub URL endpoints
const PREVIOUS_GEN_DOC_URLS = [
  'https://raw.githubusercontent.com/MicrosoftDocs/azure-compute-docs/main/articles/virtual-machines/previous-gen-sizes.md',
  'https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/main/articles/virtual-machines/previous-gen-sizes.md',
  'https://raw.githubusercontent.com/MicrosoftDocs/azure-compute-docs/main/articles/virtual-machines/sizes/previous-gen-sizes.md',
];

const RETIRED_DOC_URLS = [
  'https://raw.githubusercontent.com/MicrosoftDocs/azure-compute-docs/main/articles/virtual-machines/retired-vms.md',
  'https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/main/articles/virtual-machines/retired-vms.md',
  'https://raw.githubusercontent.com/MicrosoftDocs/azure-compute-docs/main/articles/virtual-machines/sizes/retired-vms.md',
];

// Baseline official Microsoft Learn previous generation VM sizes & series
const OFFICIAL_PREVIOUS_GEN_BASE = [
  // A-series & Av2-series
  'Standard_A0', 'Standard_A1', 'Standard_A2', 'Standard_A3', 'Standard_A4', 'Standard_A5', 'Standard_A6', 'Standard_A7',
  'Standard_A8', 'Standard_A9', 'Standard_A10', 'Standard_A11',
  'Standard_A1_v2', 'Standard_A2_v2', 'Standard_A4_v2', 'Standard_A8_v2',
  'Standard_A2m_v2', 'Standard_A4m_v2', 'Standard_A8m_v2',
  'Basic_A0', 'Basic_A1', 'Basic_A2', 'Basic_A3', 'Basic_A4',
  // D-series, Dv2-series, Dv3-series (Original non-v4/v5/v6)
  'Standard_D1', 'Standard_D2', 'Standard_D3', 'Standard_D4', 'Standard_D11', 'Standard_D12', 'Standard_D13', 'Standard_D14',
  'Standard_DS1', 'Standard_DS2', 'Standard_DS3', 'Standard_DS4', 'Standard_DS11', 'Standard_DS12', 'Standard_DS13', 'Standard_DS14',
  'Standard_D1_v2', 'Standard_D2_v2', 'Standard_D3_v2', 'Standard_D4_v2', 'Standard_D5_v2', 'Standard_D11_v2', 'Standard_D12_v2', 'Standard_D13_v2', 'Standard_D14_v2', 'Standard_D15_v2',
  'Standard_DS1_v2', 'Standard_DS2_v2', 'Standard_DS3_v2', 'Standard_DS4_v2', 'Standard_DS5_v2', 'Standard_DS11_v2', 'Standard_DS12_v2', 'Standard_DS13_v2', 'Standard_DS14_v2', 'Standard_DS15_v2',
  'Standard_D2_v3', 'Standard_D4_v3', 'Standard_D8_v3', 'Standard_D16_v3', 'Standard_D32_v3', 'Standard_D64_v3',
  'Standard_D2s_v3', 'Standard_D4s_v3', 'Standard_D8s_v3', 'Standard_D16s_v3', 'Standard_D32s_v3', 'Standard_D64s_v3',
  // Ev3-series
  'Standard_E2_v3', 'Standard_E4_v3', 'Standard_E8_v3', 'Standard_E16_v3', 'Standard_E32_v3', 'Standard_E64_v3',
  'Standard_E2s_v3', 'Standard_E4s_v3', 'Standard_E8s_v3', 'Standard_E16s_v3', 'Standard_E32s_v3', 'Standard_E64s_v3',
  // F-series & Fs-series
  'Standard_F1', 'Standard_F2', 'Standard_F4', 'Standard_F8', 'Standard_F16',
  'Standard_F1s', 'Standard_F2s', 'Standard_F4s', 'Standard_F8s', 'Standard_F16s',
  // G-series & GS-series
  'Standard_G1', 'Standard_G2', 'Standard_G3', 'Standard_G4', 'Standard_G5',
  'Standard_GS1', 'Standard_GS2', 'Standard_GS3', 'Standard_GS4', 'Standard_GS5',
  // H-series (Original)
  'Standard_H8', 'Standard_H16', 'Standard_H8m', 'Standard_H16m', 'Standard_H16r', 'Standard_H16mr',
  // NC-series, NV-series, ND-series (v1 & v2)
  'Standard_NC6', 'Standard_NC12', 'Standard_NC24', 'Standard_NC24r',
  'Standard_NC6_v2', 'Standard_NC12_v2', 'Standard_NC24_v2', 'Standard_NC24r_v2',
  'Standard_NV6', 'Standard_NV12', 'Standard_NV24',
  'Standard_NV6_v2', 'Standard_NV12_v2', 'Standard_NV24_v2',
  'Standard_ND6s', 'Standard_ND12s', 'Standard_ND24s', 'Standard_ND24rs',
  // L-series & Ls-series (v1)
  'Standard_L4s', 'Standard_L8s', 'Standard_L16s', 'Standard_L32s',
];

// Baseline official Microsoft Learn retired VM sizes
const OFFICIAL_RETIRED_BASE = [
  'Standard_A0', 'Standard_A1', 'Standard_A2', 'Standard_A3', 'Standard_A4', 'Standard_A5', 'Standard_A6', 'Standard_A7',
  'Standard_A8', 'Standard_A9', 'Standard_A10', 'Standard_A11',
  'Basic_A0', 'Basic_A1', 'Basic_A2', 'Basic_A3', 'Basic_A4',
  'Standard_G1', 'Standard_G2', 'Standard_G3', 'Standard_G4', 'Standard_G5',
  'Standard_GS1', 'Standard_GS2', 'Standard_GS3', 'Standard_GS4', 'Standard_GS5',
  'Standard_NC6', 'Standard_NC12', 'Standard_NC24', 'Standard_NC24r',
  'Standard_NV6', 'Standard_NV12', 'Standard_NV24',
  'Standard_ND6s', 'Standard_ND12s', 'Standard_ND24s', 'Standard_ND24rs',
  'Standard_H8', 'Standard_H16', 'Standard_H8m', 'Standard_H16m', 'Standard_H16r', 'Standard_H16mr',
];

async function fetchDocFromUrls(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 50) {
          logger.info(`Successfully fetched Microsoft Learn lifecycle doc from: ${url}`);
          return text;
        }
      }
    } catch (e) {
      // Continue to next candidate URL
    }
  }
  return null;
}

export function parseLifecycleMarkdown(markdown: string): Set<string> {
  const sizes = new Set<string>();

  // Extract code snippets and VM size patterns like Standard_D1_v2 or Basic_A0
  const vmSizeRegex = /\b(Standard_[A-Za-z0-9_]+|Basic_[A-Za-z0-9_]+)\b/gi;
  const matches = markdown.match(vmSizeRegex);
  if (matches) {
    matches.forEach(m => sizes.add(m));
  }

  // Extract series names in markdown tables like Dv2, DSv2, Ev3, Fs, etc.
  const seriesRegex = /\b([A-Z][A-Za-z0-9]+(?:v[1-3]|s_v[1-3]))-series\b/gi;
  const seriesMatches = markdown.match(seriesRegex);
  if (seriesMatches) {
    seriesMatches.forEach(s => sizes.add(s.replace('-series', '')));
  }

  return sizes;
}

export async function fetchAzureLifecycleLookup(): Promise<AzureLifecycleLookup> {
  logger.info('Resolving Microsoft Azure Official VM Lifecycle documentation...');

  const previousGenSet = new Set<string>(OFFICIAL_PREVIOUS_GEN_BASE);
  const retiredSet = new Set<string>(OFFICIAL_RETIRED_BASE);

  const [prevGenMd, retiredMd] = await Promise.all([
    fetchDocFromUrls(PREVIOUS_GEN_DOC_URLS),
    fetchDocFromUrls(RETIRED_DOC_URLS),
  ]);

  if (prevGenMd) {
    const parsedPrev = parseLifecycleMarkdown(prevGenMd);
    parsedPrev.forEach(size => previousGenSet.add(size));
    logger.info(`Parsed ${parsedPrev.size} previous generation entries from Microsoft Learn.`);
  } else {
    logger.warn('Could not fetch online previous-gen-sizes.md; using official Microsoft Learn baseline lookup.');
  }

  if (retiredMd) {
    const parsedRet = parseLifecycleMarkdown(retiredMd);
    parsedRet.forEach(size => retiredSet.add(size));
    logger.info(`Parsed ${parsedRet.size} retired VM entries from Microsoft Learn.`);
  } else {
    logger.warn('Could not fetch online retired-vms.md; using official Microsoft Learn baseline lookup.');
  }

  const isCurrentGeneration = (skuName: string): boolean => {
    const norm = skuName.trim();
    const clean = norm.replace(/^(Standard_|Basic_)/i, '');

    // 1. Check if explicitly in Microsoft Retired VM list
    if (retiredSet.has(norm) || retiredSet.has(clean)) {
      return false;
    }

    // 2. Check if explicitly in Microsoft Previous Generation VM list
    if (previousGenSet.has(norm) || previousGenSet.has(clean)) {
      return false;
    }

    // 3. Match legacy series patterns (v1, v2, v3 for D/E/F/N series unless current)
    if (/_v[1-3]$/i.test(clean) || /_v[1-2]_[a-z0-9]+$/i.test(clean)) {
      // Check if it's an older v1/v2/v3 size
      if (!clean.includes('_v4') && !clean.includes('_v5') && !clean.includes('_v6') && !clean.includes('_v7')) {
        return false;
      }
    }

    return true;
  };

  return {
    previousGenSet,
    retiredSet,
    isCurrentGeneration,
  };
}
