/**
 * Shared Cross-Cloud Operating System Resolver
 * Maps requested OS strings (e.g. "UBUNTU", "Ubuntu Pro", "LINUX") to candidate OS strings stored in PostgreSQL across AWS, Azure, and GCP.
 */

export function resolveOperatingSystemCandidates(requestedOs?: string | null): string[] {
  if (!requestedOs || !requestedOs.trim()) {
    return [];
  }

  const clean = requestedOs.toUpperCase().trim();

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

  // Red Hat Family mappings (RHEL, RHEL SAP)
  if (clean.includes('RED_HAT') || clean.includes('RHEL')) {
    return ['RED_HAT', 'RHEL_SAP', 'LINUX'];
  }

  // SUSE Family mappings (SLES, SLES SAP)
  if (clean.includes('SUSE') || clean.includes('SLES')) {
    return ['SUSE', 'SLES_SAP', 'LINUX'];
  }

  // Windows SQL Server Family mappings
  if (clean.includes('WINDOWS') && clean.includes('SQL')) {
    return ['WINDOWS_SQL_SERVER', 'WINDOWS'];
  }

  // Windows Standard Family mappings
  if (clean.includes('WINDOWS')) {
    return ['WINDOWS', 'WINDOWS_SQL_SERVER'];
  }

  // Default fallback: exact requested string + generic LINUX fallback
  return [clean, 'LINUX'];
}
