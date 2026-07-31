import { PrismaClient, Architecture, ProcessorManufacturer, OperatingSystem, Tenancy, LicenseType } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as seedData from './seed-data.json';

dotenv.config();

const prisma = new PrismaClient();

interface InfracostProduct {
  region: string;
  attributes: {
    instanceType: string;
    vcpu: string;
    memory: string;
    storage: string;
    operatingSystem: string;
    tenancy: string;
    physicalProcessor?: string;
    clockSpeed?: string;
    networkPerformance?: string;
    hasGpu?: string;
    gpuCount?: string;
    gpuModel?: string;
    gpuMemoryGib?: string;
  };
}

interface TranslatedInstance {
  instanceFamilySlug: string;
  instanceType: string;
  instanceSize: string;
  vcpu: number;
  memoryGib: number;
  architecture: Architecture;
  processorManufacturer: ProcessorManufacturer;
  processor: string;
  virtualizationType: string | null;
  description: string;
  operatingSystem: OperatingSystem;
  tenancy: Tenancy;
  licenseType: LicenseType;
  hasGpu: boolean;
  gpuCount: number | null;
  gpuModel: string | null;
  gpuMemoryGib: number | null;
}

interface ProviderConfig {
  id: string;
  name: string;
  serviceSlug: string;
  serviceName: string;
  regions: { code: string; name: string }[];
}

const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    id: 'aws',
    name: 'Amazon Web Services',
    serviceSlug: 'ec2',
    serviceName: 'Amazon Elastic Compute Cloud (EC2)',
    regions: [
      { code: 'us-east-1', name: 'US East (N. Virginia)' },
      { code: 'us-east-2', name: 'US East (Ohio)' },
      { code: 'us-west-1', name: 'US West (N. California)' },
      { code: 'us-west-2', name: 'US West (Oregon)' },
      { code: 'eu-west-1', name: 'Europe (Ireland)' },
      { code: 'ap-southeast-1', name: 'Asia Pacific (Singapore)' },
    ],
  },
  {
    id: 'gcp',
    name: 'Google Cloud Platform',
    serviceSlug: 'gce',
    serviceName: 'Google Compute Engine (GCE)',
    regions: [
      { code: 'us-central1', name: 'US Central (Iowa)' },
      { code: 'us-east1', name: 'US East (South Carolina)' },
      { code: 'us-west1', name: 'US West (Oregon)' },
      { code: 'europe-west1', name: 'Europe (Belgium)' },
      { code: 'asia-east1', name: 'Asia Pacific (Taiwan)' },
    ],
  },
  {
    id: 'azure',
    name: 'Microsoft Azure',
    serviceSlug: 'azure-vm',
    serviceName: 'Azure Virtual Machines',
    regions: [
      { code: 'eastus', name: 'East US' },
      { code: 'eastus2', name: 'East US 2' },
      { code: 'westus2', name: 'West US 2' },
      { code: 'northeurope', name: 'North Europe' },
      { code: 'southeastasia', name: 'Southeast Asia' },
    ],
  },
];

async function getLlmDescription(providerId: string, instanceType: string, vcpu: number, memoryGib: number): Promise<string> {
  return `Optimized for general-purpose workloads on ${providerId.toUpperCase()} with ${vcpu} vCPUs and ${memoryGib} GiB memory using ${instanceType} instances.`;
}

function compileInstanceData(providerId: string, product: InfracostProduct): Omit<TranslatedInstance, 'description'> {
  const type = product.attributes.instanceType;
  let family = 'unknown';
  let size = 'unknown';

  if (providerId === 'aws') {
    const parts = type.split('.');
    family = parts[0];
    size = parts[1] || 'unknown';
  } else if (providerId === 'gcp') {
    const parts = type.split('-');
    if (parts[1] === 'highmem') {
      family = `${parts[0]}-highmem`;
    } else if (parts[1] === 'highcpu') {
      family = `${parts[0]}-highcpu`;
    } else {
      family = parts[0];
    }
    size = parts.slice(1).join('-');
  } else {
    const clean = type.replace('Standard_', '');
    if (clean.startsWith('E')) {
      if (clean.includes('bds_v5')) {
        family = 'ebdsv5';
      } else if (clean.includes('as_v5')) {
        family = 'easv5';
      } else if (clean.includes('_v4')) {
        family = 'ev4';
      } else if (clean.includes('s_v5')) {
        family = 'esv5';
      } else {
        family = 'E-series';
      }
    } else if (clean.startsWith('NC')) {
      family = 'nc';
    } else if (clean.startsWith('ND')) {
      family = 'nd';
    } else if (clean.startsWith('NV')) {
      family = 'nv';
    } else {
      family = clean.charAt(0);
    }
    size = clean;
  }

  const vcpu = parseInt(product.attributes.vcpu) || 2;
  const memoryGib = parseFloat(product.attributes.memory.replace(/[^0-9.]/g, '')) || (vcpu * 4);

  let architecture: Architecture = Architecture.X86_64;
  if (
    type.includes('graviton') ||
    type.includes('Altra') ||
    family.endsWith('g') ||
    family.endsWith('ps') ||
    type.startsWith('t2a')
  ) {
    architecture = Architecture.ARM64;
  }

  let processorManufacturer: ProcessorManufacturer = ProcessorManufacturer.INTEL;
  let processor = product.attributes.physicalProcessor || 'Intel Xeon';

  if (architecture === Architecture.ARM64) {
    if (providerId === 'aws') {
      processorManufacturer = ProcessorManufacturer.AWS_GRAVITON;
      processor = 'AWS Graviton';
    } else {
      processorManufacturer = ProcessorManufacturer.OTHER;
      processor = 'Ampere Altra';
    }
  } else if (type.includes('a') && providerId === 'aws') {
    processorManufacturer = ProcessorManufacturer.AMD;
    processor = 'AMD EPYC';
  } else if (type.includes('c3d') || type.includes('das') || type.includes('as')) {
    processorManufacturer = ProcessorManufacturer.AMD;
    processor = 'AMD EPYC';
  }

  let virtualizationType = null;
  if (providerId === 'aws') virtualizationType = 'NITRO';
  if (providerId === 'gcp') virtualizationType = 'KVM';
  if (providerId === 'azure') virtualizationType = 'HYPER_V';

  const operatingSystem = product.attributes.operatingSystem.toUpperCase().includes('WIN') 
    ? OperatingSystem.WINDOWS 
    : OperatingSystem.LINUX;

  const tenancy = product.attributes.tenancy.toUpperCase().includes('HOST') 
    ? Tenancy.DEDICATED_HOST 
    : Tenancy.SHARED;

  const hasGpu = product.attributes.hasGpu === 'true';
  const gpuCount = product.attributes.gpuCount ? parseInt(product.attributes.gpuCount) : null;
  const gpuModel = product.attributes.gpuModel || null;
  const gpuMemoryGib = product.attributes.gpuMemoryGib ? parseFloat(product.attributes.gpuMemoryGib) : null;

  return {
    instanceFamilySlug: family,
    instanceType: type,
    instanceSize: size,
    vcpu,
    memoryGib,
    architecture,
    processorManufacturer,
    processor,
    virtualizationType,
    operatingSystem,
    tenancy,
    licenseType: LicenseType.INCLUDED,
    hasGpu,
    gpuCount,
    gpuModel,
    gpuMemoryGib,
    storageSummary: product.attributes.storage || 'SSD',
  };
}

function getNormalizedFamilyName(providerId: string, slug: string): string {
  const s = slug.toLowerCase();
  if (providerId === 'aws') {
    if (s.startsWith('t')) {
      if (s.endsWith('g')) return 'T4g';
      if (s.endsWith('a')) return 'T3a';
      return s.toUpperCase();
    }
    return s.toUpperCase();
  }
  if (providerId === 'gcp') {
    if (s === 'n2-highmem') return 'N2 High-Memory';
    if (s === 'n1-highmem') return 'N1 High-Memory';
    return s.toUpperCase();
  }
  if (providerId === 'azure') {
    if (s === 'ebdsv5') return 'Ebdsv5';
    if (s === 'easv5') return 'Easv5';
    if (s === 'ev4') return 'Ev4';
    if (s.startsWith('b')) return 'B-series';
    if (s.startsWith('d')) return 'D-series';
    if (s.startsWith('e')) return 'E-series';
    if (s.startsWith('f')) return 'F-series';
    if (s === 'nc') return 'NC-series';
    if (s === 'nd') return 'ND-series';
    if (s === 'nv') return 'NV-series';
    return s.toUpperCase();
  }
  return slug;
}

async function seed() {
  console.log('🚀 Starting Seeding using Production Seed Data Catalog...\n');

  // 1. Seed Categories
  console.log('📦 Seeding Categories...');
  for (const cat of seedData.categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
      },
      create: cat,
    });
  }

  // 2. Seed Providers
  console.log('☁️  Seeding Providers...');
  for (const prov of seedData.providers) {
    await prisma.provider.upsert({
      where: { id: prov.id },
      update: {
        name: prov.name,
        slug: prov.slug,
        websiteUrl: prov.websiteUrl,
        logoUrl: prov.logoUrl,
      },
      create: prov,
    });
  }

  // 3. Seed Services
  console.log('🛠️  Seeding Services...');
  for (const svc of seedData.services) {
    const cat = await prisma.category.findUnique({ where: { slug: svc.categoryId } });
    if (!cat) continue;

    await prisma.service.upsert({
      where: {
        providerId_categoryId_slug: {
          providerId: svc.providerId,
          categoryId: cat.id,
          slug: svc.slug,
        },
      },
      update: {
        name: svc.name,
        description: svc.description,
        isActive: svc.isActive,
      },
      create: {
        providerId: svc.providerId,
        categoryId: cat.id,
        slug: svc.slug,
        name: svc.name,
        description: svc.description,
        isActive: svc.isActive,
      },
    });
  }

  // 4. Seed Regions
  console.log('📍 Seeding Regions...');
  for (const reg of seedData.regions) {
    await prisma.region.upsert({
      where: {
        providerId_code: {
          providerId: reg.providerId,
          code: reg.code,
        },
      },
      update: {
        name: reg.name,
        continent: reg.continent,
        country: reg.country,
        isActive: reg.isActive,
      },
      create: reg,
    });
  }

  // 5. Seed Instance Families
  console.log('🏷️  Seeding Instance Families...');
  for (const fam of seedData.instanceFamilies) {
    await prisma.instanceFamily.upsert({
      where: {
        providerId_name: {
          providerId: fam.providerId,
          name: fam.name,
        },
      },
      update: {
        description: fam.description,
      },
      create: fam,
    });
  }

  // 6. Map and Seed VM Instances and Capability Matrix options
  console.log('\n🧠 Mapping VM Instances & Capability Matrix relationships...');
  for (const config of PROVIDER_CONFIGS) {
    const provider = await prisma.provider.findUnique({ where: { id: config.id } });
    const service = await prisma.service.findFirst({
      where: { providerId: config.id, slug: config.serviceSlug },
    });

    if (!provider || !service) continue;

    const rawCatalog = getProviderRawCatalog(config.id);

    for (const rCfg of config.regions) {
      const region = await prisma.region.findUnique({
        where: {
          providerId_code: {
            providerId: provider.id,
            code: rCfg.code,
          },
        },
      });

      if (!region) continue;

      for (const rawProd of rawCatalog) {
        const compiled = compileInstanceData(config.id, rawProd);
        const description = await getLlmDescription(
          config.id,
          compiled.instanceType,
          compiled.vcpu,
          compiled.memoryGib
        );

        const normalizedFamilyName = getNormalizedFamilyName(config.id, compiled.instanceFamilySlug);

        // Find or upsert family based on what we compiled (or fall back to the catalog definitions)
        const family = await prisma.instanceFamily.upsert({
          where: {
            providerId_name: {
              providerId: provider.id,
              name: normalizedFamilyName,
            },
          },
          update: {
            architecture: compiled.architecture,
            processorManufacturer: compiled.processorManufacturer,
          },
          create: {
            providerId: provider.id,
            name: normalizedFamilyName,
            description: description.substring(0, 500),
            architecture: compiled.architecture,
            processorManufacturer: compiled.processorManufacturer,
          },
        });

        const vmInstance = await prisma.vmInstance.upsert({
          where: {
            serviceId_instanceType: {
              serviceId: service.id,
              instanceType: compiled.instanceType,
            },
          },
          update: {
            instanceSize: compiled.instanceSize,
            vcpu: compiled.vcpu,
            memoryGib: compiled.memoryGib,
            processor: compiled.processor,
            burstable: compiled.instanceFamilySlug.startsWith('t') || compiled.instanceFamilySlug.startsWith('e'),
            storageType: 'SSD',
            storageSummary: compiled.storageSummary,
            hasGpu: compiled.hasGpu,
            gpuCount: compiled.gpuCount,
            gpuModel: compiled.gpuModel,
            gpuMemoryGib: compiled.gpuMemoryGib,
          },
          create: {
            serviceId: service.id,
            instanceFamilyId: family.id,
            instanceType: compiled.instanceType,
            instanceSize: compiled.instanceSize,
            vcpu: compiled.vcpu,
            memoryGib: compiled.memoryGib,
            processor: compiled.processor,
            burstable: compiled.instanceFamilySlug.startsWith('t') || compiled.instanceFamilySlug.startsWith('e'),
            storageType: 'SSD',
            storageSummary: compiled.storageSummary,
            hasGpu: compiled.hasGpu,
            gpuCount: compiled.gpuCount,
            gpuModel: compiled.gpuModel,
            gpuMemoryGib: compiled.gpuMemoryGib,
          },
        });

        const OS_OPTIONS = [
          OperatingSystem.LINUX,
          OperatingSystem.WINDOWS,
          OperatingSystem.UBUNTU,
          OperatingSystem.RED_HAT,
          OperatingSystem.SUSE,
        ];
        const TENANCY_OPTIONS = [Tenancy.SHARED, Tenancy.DEDICATED_INSTANCE];

        for (const os of OS_OPTIONS) {
          for (const tenancy of TENANCY_OPTIONS) {
            await prisma.vmCapabilityMatrix.upsert({
              where: {
                vmInstanceId_regionId_operatingSystem_tenancy_licenseType: {
                  vmInstanceId: vmInstance.id,
                  regionId: region.id,
                  operatingSystem: os,
                  tenancy: tenancy,
                  licenseType: LicenseType.INCLUDED,
                },
              },
              update: {
                isActive: true,
              },
              create: {
                vmInstanceId: vmInstance.id,
                regionId: region.id,
                operatingSystem: os,
                tenancy: tenancy,
                licenseType: LicenseType.INCLUDED,
                isRegionAvailable: true,
                isActive: true,
              },
            });
          }
        }
      }
    }
    console.log(`   ✅ Successfully processed and mapped all configurations for provider: ${config.id}`);
  }

  console.log('\n🎉 Production Seeding Completed Successfully!');
}

function getProviderRawCatalog(providerId: string): InfracostProduct[] {
  const products: InfracostProduct[] = [];

  if (providerId === 'aws') {
    const awsFamilies = [
      { name: 't2', processor: 'Intel Xeon', sizes: [
        { size: 'nano', vcpu: 1, mem: 0.5 },
        { size: 'micro', vcpu: 1, mem: 1 },
        { size: 'small', vcpu: 1, mem: 2 },
        { size: 'medium', vcpu: 2, mem: 4 },
        { size: 'large', vcpu: 2, mem: 8 },
        { size: 'xlarge', vcpu: 4, mem: 16 },
        { size: '2xlarge', vcpu: 8, mem: 32 }
      ]},
      { name: 't3', processor: 'Intel Xeon', sizes: [
        { size: 'nano', vcpu: 2, mem: 0.5 },
        { size: 'micro', vcpu: 2, mem: 1 },
        { size: 'small', vcpu: 2, mem: 2 },
        { size: 'medium', vcpu: 2, mem: 4 },
        { size: 'large', vcpu: 2, mem: 8 },
        { size: 'xlarge', vcpu: 4, mem: 16 },
        { size: '2xlarge', vcpu: 8, mem: 32 }
      ]},
      { name: 't3a', processor: 'AMD EPYC', sizes: [
        { size: 'nano', vcpu: 2, mem: 0.5 },
        { size: 'micro', vcpu: 2, mem: 1 },
        { size: 'small', vcpu: 2, mem: 2 },
        { size: 'medium', vcpu: 2, mem: 4 },
        { size: 'large', vcpu: 2, mem: 8 },
        { size: 'xlarge', vcpu: 4, mem: 16 },
        { size: '2xlarge', vcpu: 8, mem: 32 }
      ]},
      { name: 't4g', processor: 'AWS Graviton 2', sizes: [
        { size: 'nano', vcpu: 2, mem: 0.5 },
        { size: 'micro', vcpu: 2, mem: 1 },
        { size: 'small', vcpu: 2, mem: 2 },
        { size: 'medium', vcpu: 2, mem: 4 },
        { size: 'large', vcpu: 2, mem: 8 },
        { size: 'xlarge', vcpu: 4, mem: 16 },
        { size: '2xlarge', vcpu: 8, mem: 32 }
      ]},
      { name: 'm5', processor: 'Intel Xeon', sizes: [
        { size: 'large', vcpu: 2, mem: 8 },
        { size: 'xlarge', vcpu: 4, mem: 16 },
        { size: '2xlarge', vcpu: 8, mem: 32 },
        { size: '4xlarge', vcpu: 16, mem: 64 },
        { size: '8xlarge', vcpu: 32, mem: 128 },
        { size: '12xlarge', vcpu: 48, mem: 192 },
        { size: '16xlarge', vcpu: 64, mem: 256 },
        { size: '24xlarge', vcpu: 96, mem: 384 }
      ]},
      { name: 'm5a', processor: 'AMD EPYC', sizes: [
        { size: 'large', vcpu: 2, mem: 8 },
        { size: 'xlarge', vcpu: 4, mem: 16 },
        { size: '2xlarge', vcpu: 8, mem: 32 },
        { size: '4xlarge', vcpu: 16, mem: 64 },
        { size: '8xlarge', vcpu: 32, mem: 128 },
        { size: '12xlarge', vcpu: 48, mem: 192 },
        { size: '16xlarge', vcpu: 64, mem: 256 },
        { size: '24xlarge', vcpu: 96, mem: 384 }
      ]},
      { name: 'm6g', processor: 'AWS Graviton 2', sizes: [
        { size: 'large', vcpu: 2, mem: 8 },
        { size: 'xlarge', vcpu: 4, mem: 16 },
        { size: '2xlarge', vcpu: 8, mem: 32 },
        { size: '4xlarge', vcpu: 16, mem: 64 },
        { size: '8xlarge', vcpu: 32, mem: 128 },
        { size: '12xlarge', vcpu: 48, mem: 192 },
        { size: '16xlarge', vcpu: 64, mem: 256 },
        { size: '24xlarge', vcpu: 96, mem: 384 }
      ]},
      { name: 'c5', processor: 'Intel Xeon', sizes: [
        { size: 'large', vcpu: 2, mem: 4 },
        { size: 'xlarge', vcpu: 4, mem: 8 },
        { size: '2xlarge', vcpu: 8, mem: 16 },
        { size: '4xlarge', vcpu: 16, mem: 32 },
        { size: '9xlarge', vcpu: 36, mem: 72 },
        { size: '12xlarge', vcpu: 48, mem: 96 },
        { size: '18xlarge', vcpu: 72, mem: 144 },
        { size: '24xlarge', vcpu: 96, mem: 192 }
      ]},
      { name: 'r5', processor: 'Intel Xeon', sizes: [
        { size: 'large', vcpu: 2, mem: 16 },
        { size: 'xlarge', vcpu: 4, mem: 32 },
        { size: '2xlarge', vcpu: 8, mem: 64 },
        { size: '4xlarge', vcpu: 16, mem: 128 },
        { size: '8xlarge', vcpu: 32, mem: 256 },
        { size: '12xlarge', vcpu: 48, mem: 384 },
        { size: '16xlarge', vcpu: 64, mem: 512 },
        { size: '24xlarge', vcpu: 96, mem: 768 }
      ]},
      { name: 'r6i', processor: 'Intel Xeon', sizes: [
        { size: 'large', vcpu: 2, mem: 16 },
        { size: 'xlarge', vcpu: 4, mem: 32 },
        { size: '2xlarge', vcpu: 8, mem: 64 },
        { size: '4xlarge', vcpu: 16, mem: 128 },
        { size: '8xlarge', vcpu: 32, mem: 256 },
        { size: '12xlarge', vcpu: 48, mem: 384 },
        { size: '16xlarge', vcpu: 64, mem: 512 },
        { size: '24xlarge', vcpu: 96, mem: 768 }
      ]},
      { name: 'r6a', processor: 'AMD EPYC', sizes: [
        { size: 'large', vcpu: 2, mem: 16 },
        { size: 'xlarge', vcpu: 4, mem: 32 },
        { size: '2xlarge', vcpu: 8, mem: 64 },
        { size: '4xlarge', vcpu: 16, mem: 128 },
        { size: '8xlarge', vcpu: 32, mem: 256 },
        { size: '12xlarge', vcpu: 48, mem: 384 },
        { size: '16xlarge', vcpu: 64, mem: 512 },
        { size: '24xlarge', vcpu: 96, mem: 768 }
      ]},
      { name: 'r7i', processor: 'Intel Xeon', sizes: [
        { size: 'large', vcpu: 2, mem: 16 },
        { size: 'xlarge', vcpu: 4, mem: 32 },
        { size: '2xlarge', vcpu: 8, mem: 64 },
        { size: '4xlarge', vcpu: 16, mem: 128 },
        { size: '8xlarge', vcpu: 32, mem: 256 },
        { size: '12xlarge', vcpu: 48, mem: 384 },
        { size: '16xlarge', vcpu: 64, mem: 512 },
        { size: '24xlarge', vcpu: 96, mem: 768 }
      ]},
      { name: 'g4dn', processor: 'Intel Xeon', sizes: [
        { size: 'xlarge', vcpu: 4, mem: 16, hasGpu: 'true', gpuCount: '1', gpuModel: 'NVIDIA T4', gpuMemoryGib: '16' },
        { size: '12xlarge', vcpu: 48, mem: 192, hasGpu: 'true', gpuCount: '4', gpuModel: 'NVIDIA T4', gpuMemoryGib: '64' }
      ]},
      { name: 'g5', processor: 'AMD EPYC', sizes: [
        { size: 'xlarge', vcpu: 4, mem: 16, hasGpu: 'true', gpuCount: '1', gpuModel: 'NVIDIA A10G', gpuMemoryGib: '24' }
      ]}
    ];

    awsFamilies.forEach(f => {
      f.sizes.forEach(s => {
        products.push({
          region: 'us-east-1',
          attributes: {
            instanceType: `${f.name}.${s.size}`,
            vcpu: String(s.vcpu),
            memory: `${s.mem} GiB`,
            storage: 'EBS only',
            operatingSystem: 'Linux',
            tenancy: 'Shared',
            physicalProcessor: f.processor,
            hasGpu: (s as any).hasGpu || 'false',
            gpuCount: (s as any).gpuCount || '',
            gpuModel: (s as any).gpuModel || '',
            gpuMemoryGib: (s as any).gpuMemoryGib || ''
          }
        });
      });
    });
  } else if (providerId === 'gcp') {
    const gcpFamilies = [
      { name: 'e2', type: 'shared', processor: 'Intel Xeon / AMD EPYC', sizes: [
        { size: 'micro', vcpu: 2, mem: 1 },
        { size: 'small', vcpu: 2, mem: 2 },
        { size: 'medium', vcpu: 2, mem: 4 }
      ]},
      { name: 'e2', type: 'standard', processor: 'Intel Xeon / AMD EPYC', sizes: [
        { size: 'standard-2', vcpu: 2, mem: 8 },
        { size: 'standard-4', vcpu: 4, mem: 16 },
        { size: 'standard-8', vcpu: 8, mem: 32 },
        { size: 'standard-16', vcpu: 16, mem: 64 }
      ]},
      { name: 'e2', type: 'highmem', processor: 'Intel Xeon / AMD EPYC', sizes: [
        { size: 'highmem-2', vcpu: 2, mem: 16 },
        { size: 'highmem-4', vcpu: 4, mem: 32 },
        { size: 'highmem-8', vcpu: 8, mem: 64 },
        { size: 'highmem-16', vcpu: 16, mem: 128 }
      ]},
      { name: 'n1', type: 'standard', processor: 'Intel Cascade Lake', sizes: [
        { size: 'standard-1', vcpu: 1, mem: 3.75 },
        { size: 'standard-2', vcpu: 2, mem: 7.5 },
        { size: 'standard-4', vcpu: 4, mem: 15 },
        { size: 'standard-8', vcpu: 8, mem: 30 },
        { size: 'standard-16', vcpu: 16, mem: 60 },
        { size: 'standard-32', vcpu: 32, mem: 120 },
        { size: 'standard-64', vcpu: 64, mem: 240 },
        { size: 'standard-96', vcpu: 96, mem: 360 }
      ]},
      { name: 'n1', type: 'highmem', processor: 'Intel Cascade Lake', sizes: [
        { size: 'highmem-2', vcpu: 2, mem: 13 },
        { size: 'highmem-4', vcpu: 4, mem: 26 },
        { size: 'highmem-8', vcpu: 8, mem: 52 },
        { size: 'highmem-16', vcpu: 16, mem: 104 },
        { size: 'highmem-32', vcpu: 32, mem: 208 },
        { size: 'highmem-64', vcpu: 64, mem: 416 },
        { size: 'highmem-96', vcpu: 96, mem: 624 }
      ]},
      { name: 'n2', type: 'standard', processor: 'Intel Ice Lake', sizes: [
        { size: 'standard-2', vcpu: 2, mem: 8 },
        { size: 'standard-4', vcpu: 4, mem: 16 },
        { size: 'standard-8', vcpu: 8, mem: 32 },
        { size: 'standard-16', vcpu: 16, mem: 64 },
        { size: 'standard-32', vcpu: 32, mem: 128 },
        { size: 'standard-48', vcpu: 48, mem: 192 },
        { size: 'standard-64', vcpu: 64, mem: 256 },
        { size: 'standard-80', vcpu: 80, mem: 320 },
        { size: 'standard-96', vcpu: 96, mem: 384 },
        { size: 'standard-128', vcpu: 128, mem: 512 }
      ]},
      { name: 'n2', type: 'highmem', processor: 'Intel Ice Lake', sizes: [
        { size: 'highmem-2', vcpu: 2, mem: 16 },
        { size: 'highmem-4', vcpu: 4, mem: 32 },
        { size: 'highmem-8', vcpu: 8, mem: 64 },
        { size: 'highmem-16', vcpu: 16, mem: 128 },
        { size: 'highmem-32', vcpu: 32, mem: 256 },
        { size: 'highmem-48', vcpu: 48, mem: 384 },
        { size: 'highmem-64', vcpu: 64, mem: 512 },
        { size: 'highmem-80', vcpu: 80, mem: 640 },
        { size: 'highmem-96', vcpu: 96, mem: 768 }
      ]},
      { name: 'n2d', type: 'standard', processor: 'AMD EPYC Milan', sizes: [
        { size: 'standard-2', vcpu: 2, mem: 8 },
        { size: 'standard-4', vcpu: 4, mem: 16 },
        { size: 'standard-8', vcpu: 8, mem: 32 },
        { size: 'standard-16', vcpu: 16, mem: 64 },
        { size: 'standard-32', vcpu: 32, mem: 128 },
        { size: 'standard-48', vcpu: 48, mem: 192 },
        { size: 'standard-64', vcpu: 64, mem: 256 },
        { size: 'standard-80', vcpu: 80, mem: 320 },
        { size: 'standard-96', vcpu: 96, mem: 384 },
        { size: 'standard-128', vcpu: 128, mem: 512 }
      ]},
      { name: 'n2d', type: 'highmem', processor: 'AMD EPYC Milan', sizes: [
        { size: 'highmem-2', vcpu: 2, mem: 16 },
        { size: 'highmem-4', vcpu: 4, mem: 32 },
        { size: 'highmem-8', vcpu: 8, mem: 64 },
        { size: 'highmem-16', vcpu: 16, mem: 128 },
        { size: 'highmem-32', vcpu: 32, mem: 256 },
        { size: 'highmem-48', vcpu: 48, mem: 384 },
        { size: 'highmem-64', vcpu: 64, mem: 512 },
        { size: 'highmem-80', vcpu: 80, mem: 640 },
        { size: 'highmem-96', vcpu: 96, mem: 768 }
      ]},
      { name: 'g2', type: 'standard', processor: 'Intel Cascade Lake', sizes: [
        { size: 'standard-4', vcpu: 4, mem: 16, hasGpu: 'true', gpuCount: '1', gpuModel: 'NVIDIA L4', gpuMemoryGib: '24' }
      ]},
      { name: 'a2', type: 'highgpu', processor: 'Intel Cascade Lake', sizes: [
        { size: 'highgpu-1g', vcpu: 12, mem: 85, hasGpu: 'true', gpuCount: '1', gpuModel: 'NVIDIA A100', gpuMemoryGib: '40' }
      ]}
    ];

    gcpFamilies.forEach(f => {
      f.sizes.forEach(s => {
        products.push({
          region: 'us-central1',
          attributes: {
            instanceType: `${f.name}-${s.size}`,
            vcpu: String(s.vcpu),
            memory: `${s.mem} GiB`,
            storage: 'Persistent Disk',
            operatingSystem: 'Linux',
            tenancy: 'Shared',
            physicalProcessor: f.processor,
            hasGpu: (s as any).hasGpu || 'false',
            gpuCount: (s as any).gpuCount || '',
            gpuModel: (s as any).gpuModel || '',
            gpuMemoryGib: (s as any).gpuMemoryGib || ''
          }
        });
      });
    });
  } else {
    const azureFamilies = [
      { name: 'B', processor: 'Intel Xeon', sizes: [
        { size: '1ls', vcpu: 1, mem: 0.5 },
        { size: '1s', vcpu: 1, mem: 1 },
        { size: '1ms', vcpu: 1, mem: 2 },
        { size: '2s', vcpu: 2, mem: 4 },
        { size: '2ms', vcpu: 2, mem: 8 },
        { size: '4ms', vcpu: 4, mem: 16 },
        { size: '8ms', vcpu: 8, mem: 32 },
        { size: '12ms', vcpu: 12, mem: 48 },
        { size: '16ms', vcpu: 16, mem: 64 },
        { size: '20ms', vcpu: 20, mem: 80 }
      ]},
      { name: 'D', suffix: 's_v5', processor: 'Intel Xeon Platinum 8370C', sizes: [
        { size: '2', vcpu: 2, mem: 8 },
        { size: '4', vcpu: 4, mem: 16 },
        { size: '8', vcpu: 8, mem: 32 },
        { size: '16', vcpu: 16, mem: 64 },
        { size: '32', vcpu: 32, mem: 128 },
        { size: '48', vcpu: 48, mem: 192 },
        { size: '64', vcpu: 64, mem: 256 },
        { size: '96', vcpu: 96, mem: 384 }
      ]},
      { name: 'E', suffix: 's_v5', processor: 'Intel Xeon Platinum 8370C', sizes: [
        { size: '2', vcpu: 2, mem: 16 },
        { size: '4', vcpu: 4, mem: 32 },
        { size: '8', vcpu: 8, mem: 64 },
        { size: '16', vcpu: 16, mem: 128 },
        { size: '32', vcpu: 32, mem: 256 },
        { size: '48', vcpu: 48, mem: 384 },
        { size: '64', vcpu: 64, mem: 512 },
        { size: '96', vcpu: 96, mem: 672 }
      ]},
      { name: 'E', suffix: 'bds_v5', processor: 'Intel Xeon Platinum 8370C', sizes: [
        { size: '2', vcpu: 2, mem: 16 },
        { size: '4', vcpu: 4, mem: 32 },
        { size: '8', vcpu: 8, mem: 64 },
        { size: '16', vcpu: 16, mem: 128 },
        { size: '32', vcpu: 32, mem: 256 },
        { size: '48', vcpu: 48, mem: 384 },
        { size: '64', vcpu: 64, mem: 512 }
      ]},
      { name: 'E', suffix: 'as_v5', processor: 'AMD EPYC', sizes: [
        { size: '2', vcpu: 2, mem: 16 },
        { size: '4', vcpu: 4, mem: 32 },
        { size: '8', vcpu: 8, mem: 64 },
        { size: '16', vcpu: 16, mem: 128 },
        { size: '32', vcpu: 32, mem: 256 },
        { size: '48', vcpu: 48, mem: 384 },
        { size: '64', vcpu: 64, mem: 512 }
      ]},
      { name: 'E', suffix: '_v4', processor: 'Intel Xeon', sizes: [
        { size: '2', vcpu: 2, mem: 16 },
        { size: '4', vcpu: 4, mem: 32 },
        { size: '8', vcpu: 8, mem: 64 },
        { size: '16', vcpu: 16, mem: 128 },
        { size: '32', vcpu: 32, mem: 256 },
        { size: '48', vcpu: 48, mem: 384 },
        { size: '64', vcpu: 64, mem: 508 }
      ]},
      { name: 'F', suffix: 's_v2', processor: 'Intel Xeon Platinum 8168', sizes: [
        { size: '2', vcpu: 2, mem: 4 },
        { size: '4', vcpu: 4, mem: 8 },
        { size: '8', vcpu: 8, mem: 16 },
        { size: '16', vcpu: 16, mem: 32 },
        { size: '32', vcpu: 32, mem: 64 },
        { size: '48', vcpu: 48, mem: 96 },
        { size: '64', vcpu: 64, mem: 128 },
        { size: '72', vcpu: 72, mem: 144 }
      ]},
      { name: 'NC', suffix: 'as_T4_v3', processor: 'AMD EPYC', sizes: [
        { size: '4', vcpu: 4, mem: 28, hasGpu: 'true', gpuCount: '1', gpuModel: 'NVIDIA T4', gpuMemoryGib: '16' }
      ]},
      { name: 'ND', suffix: 'asr_v4', processor: 'Intel Xeon', sizes: [
        { size: '96', vcpu: 96, mem: 900, hasGpu: 'true', gpuCount: '8', gpuModel: 'NVIDIA A100', gpuMemoryGib: '320' }
      ]}
    ];

    azureFamilies.forEach(f => {
      f.sizes.forEach(s => {
        const typeName = f.suffix ? `Standard_${f.name}${s.size}${f.suffix}` : `Standard_${f.name}${s.size}`;
        products.push({
          region: 'eastus',
          attributes: {
            instanceType: typeName,
            vcpu: String(s.vcpu),
            memory: `${s.mem} GiB`,
            storage: 'Premium SSD',
            operatingSystem: 'Linux',
            tenancy: 'Shared',
            physicalProcessor: f.processor,
            hasGpu: (s as any).hasGpu || 'false',
            gpuCount: (s as any).gpuCount || '',
            gpuModel: (s as any).gpuModel || '',
            gpuMemoryGib: (s as any).gpuMemoryGib || ''
          }
        });
      });
    });
  }

  return products;
}

seed()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
