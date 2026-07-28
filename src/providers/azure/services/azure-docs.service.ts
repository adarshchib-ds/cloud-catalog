import { logger } from '../../../config/logger';

export interface GitHubFile {
  path: string;
  category: string;
}

/**
 * Fetches the GitHub repository tree to find all series-specific markdown files.
 */
export async function fetchSeriesFileList(): Promise<GitHubFile[]> {
  logger.info('Fetching repository file list from GitHub to discover VM families...');

  const url =
    'https://api.github.com/repos/MicrosoftDocs/azure-compute-docs/git/trees/main?recursive=1';
  let retries = 3;
  let responseData: any = null;

  while (retries > 0) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Antigravity-Azure-Sync-Agent',
        },
      });
      if (!response.ok) {
        throw new Error(`GitHub API HTTP error! status: ${response.status}`);
      }
      responseData = await response.json();
      break;
    } catch (error) {
      retries--;
      logger.warn(`Failed to fetch repo tree. Retries remaining: ${retries}. Error: ${error}`);
      if (retries === 0) {
        logger.error('Failed to query GitHub API. Using local fallback/mock discovery list.');
        return getFallbackSeriesList();
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const files: GitHubFile[] = [];
  if (responseData && Array.isArray(responseData.tree)) {
    for (const item of responseData.tree) {
      const path = item.path as string;
      // Look for files under articles/virtual-machines/sizes/ ending in -series.md
      if (
        path.startsWith('articles/virtual-machines/sizes/') &&
        path.endsWith('-series.md') &&
        !path.includes('/includes/') &&
        !path.includes('/media/') &&
        !path.includes('/lifecycle/')
      ) {
        const parts = path.split('/');
        // Extract category (e.g. general-purpose, memory-optimized)
        const category = parts[4] || 'general-purpose';
        files.push({ path, category });
      }
    }
  }

  logger.info(`Discovered ${files.length} series markdown files.`);
  return files.length > 0 ? files : getFallbackSeriesList();
}

export async function fetchRawMarkdown(path: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/MicrosoftDocs/azure-compute-docs/main/${path}`;
  let retries = 3;
  let delay = 500;

  while (retries > 0) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error fetching raw file! status: ${response.status}`);
      }
      let content = await response.text();

      // Automatically inline [!INCLUDE [...](./includes/...)] references
      const includeMatches = Array.from(
        content.matchAll(/\[!INCLUDE\s+\[[^\]]*\]\(\.\/includes\/([^)]+)\)\]/gi),
      );
      if (includeMatches.length > 0) {
        const parentDir = path.substring(0, path.lastIndexOf('/'));
        for (const match of includeMatches) {
          const includeFileName = match[1];
          const includePath = `${parentDir}/includes/${includeFileName}`;
          try {
            const includeResponse = await fetch(
              `https://raw.githubusercontent.com/MicrosoftDocs/azure-compute-docs/main/${includePath}`,
            );
            if (includeResponse.ok) {
              const includeText = await includeResponse.text();
              content = content.replace(match[0], `\n${includeText}\n`);
            }
          } catch (e) {
            // Ignore missing include files
          }
        }
      }

      return content;
    } catch (error) {
      retries--;
      if (retries === 0) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  throw new Error(`Failed to fetch raw markdown for: ${path}`);
}

function getFallbackSeriesList(): GitHubFile[] {
  // Safe baseline fallback list of primary families in case GitHub API rate limits us
  return [
    {
      path: 'articles/virtual-machines/sizes/general-purpose/dsv5-series.md',
      category: 'general-purpose',
    },
    {
      path: 'articles/virtual-machines/sizes/general-purpose/dasv5-series.md',
      category: 'general-purpose',
    },
    {
      path: 'articles/virtual-machines/sizes/general-purpose/dadsv5-series.md',
      category: 'general-purpose',
    },
    {
      path: 'articles/virtual-machines/sizes/general-purpose/ddsv5-series.md',
      category: 'general-purpose',
    },
    {
      path: 'articles/virtual-machines/sizes/general-purpose/basv2-series.md',
      category: 'general-purpose',
    },
    {
      path: 'articles/virtual-machines/sizes/memory-optimized/eadsv5-series.md',
      category: 'memory-optimized',
    },
    {
      path: 'articles/virtual-machines/sizes/memory-optimized/easv5-series.md',
      category: 'memory-optimized',
    },
    {
      path: 'articles/virtual-machines/sizes/memory-optimized/edsv5-series.md',
      category: 'memory-optimized',
    },
    {
      path: 'articles/virtual-machines/sizes/compute-optimized/fsv2-series.md',
      category: 'compute-optimized',
    },
  ];
}
