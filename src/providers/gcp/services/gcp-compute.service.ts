import { GcpRawRegion, GcpRawMachineType } from '../dto/gcp-raw.dto';
import { getGcpProjectId, getGcpAccessToken } from './gcp-auth.service';

export async function fetchGcpRegions(): Promise<GcpRawRegion[]> {
  try {
    const token = await getGcpAccessToken();
    const projectId = getGcpProjectId();
    const res = await fetch(`https://compute.googleapis.com/compute/v1/projects/${projectId}/regions`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`GCP Regions REST API error ${res.status}: ${await res.text()}`);
    }

    const data: any = await res.json();
    const items = data.items || [];

    return items
      .filter((r: any) => !!r.name)
      .map((r: any) => ({
        name: r.name,
        description: r.description ?? undefined,
        status: String(r.status ?? 'UP'),
      }));
  } catch (error) {
    console.error('Error fetching GCP regions:', error);
    throw error;
  }
}

export async function fetchGcpMachineTypes(): Promise<GcpRawMachineType[]> {
  const machineTypes: GcpRawMachineType[] = [];

  try {
    const token = await getGcpAccessToken();
    const projectId = getGcpProjectId();
    let pageToken: string | undefined;

    do {
      const url: string = `https://compute.googleapis.com/compute/v1/projects/${projectId}/aggregated/machineTypes` +
        (pageToken ? `?pageToken=${pageToken}` : '');

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`GCP Machine Types REST API error ${res.status}: ${await res.text()}`);
      }

      const data: any = await res.json();
      pageToken = data.nextPageToken;

      const items = data.items || {};

      for (const [zoneKey, scopedList] of Object.entries<any>(items)) {
        const zone = zoneKey.replace('zones/', '');

        for (const mt of scopedList.machineTypes ?? []) {
          if (!mt.name || mt.guestCpus == null || mt.memoryMb == null) continue;
          // Skip deprecated/obsolete/deleted machine types
          if (mt.deprecated?.state === 'DELETED' || mt.deprecated?.state === 'OBSOLETE') continue;

          machineTypes.push({
            name: mt.name,
            description: mt.description ?? undefined,
            guestCpus: mt.guestCpus,
            memoryMb: mt.memoryMb,
            zone,
            isSharedCpu: mt.isSharedCpu ?? undefined,
            architecture: mt.architecture ? String(mt.architecture) : undefined,
            accelerators: mt.accelerators?.length
              ? mt.accelerators
                  .filter((a: any) => a.guestAcceleratorType && a.guestAcceleratorCount != null)
                  .map((a: any) => ({
                    guestAcceleratorType: a.guestAcceleratorType,
                    guestAcceleratorCount: a.guestAcceleratorCount,
                  }))
              : undefined,
            deprecated: mt.deprecated?.state ? { state: mt.deprecated.state } : undefined,
          });
        }
      }
    } while (pageToken);

    return machineTypes;
  } catch (error) {
    console.error('Error fetching GCP machine types:', error);
    throw error;
  }
}

export async function fetchGcpNodeTypes(): Promise<GcpRawMachineType[]> {
  const nodeTypes: GcpRawMachineType[] = [];

  try {
    const token = await getGcpAccessToken();
    const projectId = getGcpProjectId();
    let pageToken: string | undefined;

    do {
      const url: string = `https://compute.googleapis.com/compute/v1/projects/${projectId}/aggregated/nodeTypes` +
        (pageToken ? `?pageToken=${pageToken}` : '');

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        // If nodeTypes API is disabled or inaccessible for the project, log gracefully and return empty array
        console.warn(`GCP Node Types REST API returned status ${res.status}. Continuing without node types.`);
        return nodeTypes;
      }

      const data: any = await res.json();
      pageToken = data.nextPageToken;

      const items = data.items || {};

      for (const [zoneKey, scopedList] of Object.entries<any>(items)) {
        const zone = zoneKey.replace('zones/', '');

        for (const nt of scopedList.nodeTypes ?? []) {
          if (!nt.name || nt.guestCpus == null || nt.memoryMb == null) continue;
          if (nt.deprecated?.state === 'DELETED' || nt.deprecated?.state === 'OBSOLETE') continue;

          nodeTypes.push({
            name: nt.name,
            description: nt.description ?? undefined,
            guestCpus: nt.guestCpus,
            memoryMb: nt.memoryMb,
            zone,
            isSharedCpu: false,
            architecture: nt.architecture ? String(nt.architecture) : undefined,
            accelerators: nt.accelerators?.length
              ? nt.accelerators
                  .filter((a: any) => a.guestAcceleratorType && a.guestAcceleratorCount != null)
                  .map((a: any) => ({
                    guestAcceleratorType: a.guestAcceleratorType,
                    guestAcceleratorCount: a.guestAcceleratorCount,
                  }))
              : undefined,
            deprecated: nt.deprecated?.state ? { state: nt.deprecated.state } : undefined,
          });
        }
      }
    } while (pageToken);

    return nodeTypes;
  } catch (error) {
    console.warn('Warning fetching GCP node types:', error);
    return nodeTypes;
  }
}
