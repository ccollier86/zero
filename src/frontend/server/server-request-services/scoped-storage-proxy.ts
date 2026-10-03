import type { StorageService } from '../../../storage/storage-service';
import type { ScopedStorageStudioApi } from '../../../storage/storage-studio-scoped-api';
import type {
  ScopedStorageDriveApi,
  ScopedStorageMethods,
  ScopedStorageObjectApi,
  ScopedStoragePermissionApi,
  ScopedStorageService,
  ScopedStorageUploadGrantApi,
} from './scoped-storage-contracts';

interface ScopedStorageProxyOptions {
  readonly service: StorageService;
  readonly methods: ScopedStorageMethods;
  readonly drives: ScopedStorageDriveApi;
  readonly objects: ScopedStorageObjectApi;
  readonly permissions: ScopedStoragePermissionApi;
  readonly uploads: ScopedStorageUploadGrantApi;
  readonly studio: ScopedStorageStudioApi | null;
}

const GROUPED_MEMBERS = new Set(['drives', 'objects', 'permissions', 'uploads', 'studio']);

/** Project the reviewed Storage contract and reject every raw member at runtime. */
export function createScopedStorageProxy(
  options: ScopedStorageProxyOptions,
): ScopedStorageService {
  const grouped: Record<string, unknown> = {
    drives: options.drives,
    objects: options.objects,
    permissions: options.permissions,
    uploads: options.uploads,
    studio: options.studio,
  };
  const visible = (property: PropertyKey): property is string => (
    typeof property === 'string'
    && (Object.hasOwn(options.methods, property) || GROUPED_MEMBERS.has(property))
  );

  return new Proxy(options.service, {
    get(target, property) {
      if (typeof property === 'string' && Object.hasOwn(grouped, property)) {
        return grouped[property];
      }
      if (typeof property === 'string' && Object.hasOwn(options.methods, property)) {
        return Reflect.get(options.methods, property, options.methods);
      }
      if (typeof property === 'string') {
        throw new Error(
          `[server-services] Storage member "${property}" is not available through the request-scoped facade; use zero.unsafe.storage for deliberate privileged access.`,
        );
      }
      return Reflect.get(target, property, target);
    },
    has(_target, property) {
      return visible(property);
    },
    ownKeys() {
      return [...GROUPED_MEMBERS, ...Object.keys(options.methods)];
    },
    getOwnPropertyDescriptor(_target, property) {
      return visible(property) ? { configurable: true, enumerable: true } : undefined;
    },
  }) as unknown as ScopedStorageService;
}
