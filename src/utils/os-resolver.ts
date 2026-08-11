/**
 * Shared Cross-Cloud Operating System Resolver
 * Maps requested OS strings (e.g. "UBUNTU", "Ubuntu Pro", "LINUX") to candidate OS strings stored in PostgreSQL across AWS, Azure, and GCP.
 */

export function resolveOperatingSystemCandidates(requestedOs?: string | null): string[] {
  if (!requestedOs || !requestedOs.trim()) {
    return [];
  }

  const clean = requestedOs.toUpperCase().trim();

  // Windows SQL Server Family mappings (Strictly Windows only)
  if (clean.includes('WINDOWS') && clean.includes('SQL')) {
    return ['WINDOWS_SQL_SERVER', 'WINDOWS'];
  }

  // Windows Standard Family mappings (Strictly Windows only)
  if (clean.includes('WINDOWS')) {
    return ['WINDOWS', 'WINDOWS_SQL_SERVER'];
  }

  // Red Hat Family mappings (Strictly RHEL only - no generic Linux mix)
  if (clean.includes('RED_HAT') || clean.includes('RHEL')) {
    return ['RED_HAT', 'RHEL_SAP'];
  }

  // SUSE Family mappings (Strictly SUSE only - no generic Linux mix)
  if (clean.includes('SUSE') || clean.includes('SLES')) {
    return ['SUSE', 'SLES_SAP'];
  }

  // Linux Standard Family mappings (Ubuntu, Debian, AlmaLinux, Oracle Linux, Flatcar, Generic Linux)
  if (
    clean.includes('UBUNTU') ||
    clean.includes('DEBIAN') ||
    clean.includes('ALMALINUX') ||
    clean.includes('FLATCAR') ||
    clean.includes('ORACLE_LINUX') ||
    clean === 'LINUX'
  ) {
    return ['LINUX', 'UBUNTU', 'DEBIAN', 'ALMALINUX', 'FLATCAR', 'ORACLE_LINUX'];
  }

  // Default fallback: exact requested string only
  return [clean];
}
