import { RegionsClient, MachineTypesClient } from '@google-cloud/compute';
import { GcpRawRegion, GcpRawMachineType } from '../dto/gcp-raw.dto';
import { getGcpProjectId } from './gcp-auth.service';

const regionsClient = new RegionsClient();
const machineTypesClient = new MachineTypesClient();

export async function fetchGcpRegions(): Promise<GcpRawRegion[]> {
  try {
    const [regions] = await regionsClient.list({ project: getGcpProjectId() });

    return regions
      .filter(r => !!r.name)
      .map(r => ({
        name: r.name!,
        description: r.description ?? undefined,
        status: r.status ?? undefined,
      }));
  } catch (error) {
    console.error('Error fetching GCP regions:', error);
    throw error;
  }
}

export async function fetchGcpMachineTypes(): Promise<GcpRawMachineType[]> {
  const machineTypes: GcpRawMachineType[] = [];

  try {
    const iterable = machineTypesClient.aggregatedListAsync({ project: getGcpProjectId() });

    for await (const [zoneKey, scopedList] of iterable) {
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
          architecture: mt.architecture ?? undefined,
          accelerators: mt.accelerators?.length
            ? mt.accelerators
                .filter(a => a.guestAcceleratorType && a.guestAcceleratorCount != null)
                .map(a => ({
                  guestAcceleratorType: a.guestAcceleratorType!,
                  guestAcceleratorCount: a.guestAcceleratorCount!,
                }))
            : undefined,
        });
      }
    }

    return machineTypes;
  } catch (error) {
    console.error('Error fetching GCP machine types:', error);
    throw error;
  }
}
