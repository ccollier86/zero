import { AuthError } from '../../../auth/types';
import type { PdfService } from '../../../pdf/pdf-service';
import { ZeroPdfStorageWriter } from '../../../pdf/pdf-storage-writer';
import type {
  PdfRenderInput,
  PdfRenderResult,
  PdfServiceStatus,
  PdfStorageTarget,
  PdfStoredResult,
} from '../../../pdf/pdf-types';
import type { StorageObjectApi } from '../../../storage/storage-service';
import type { ScopedStorageObjectApi } from './scoped-storage-contracts';
import {
  restrictedServiceProxy,
  type CompleteServiceMemberInventory,
} from './restricted-service-proxy';

export type ScopedPdfStorageTarget = Omit<PdfStorageTarget, 'createdBy'>;

/** PDF operations with Storage creator identity sealed to the current actor. */
export interface ScopedPdfService {
  render(input: PdfRenderInput): Promise<PdfRenderResult>;
  renderToStorage(
    input: PdfRenderInput,
    target: ScopedPdfStorageTarget,
  ): Promise<PdfStoredResult>;
  status(): PdfServiceStatus;
}
type DeniedPdfMember = 'close';

const PDF_SERVICE_INVENTORY: CompleteServiceMemberInventory<
  PdfService,
  keyof ScopedPdfService,
  DeniedPdfMember
> = true;
void PDF_SERVICE_INVENTORY;

const DENIED_PDF_MEMBERS: ReadonlySet<DeniedPdfMember> = new Set(['close']);

export function createRequestPdfService(
  service: PdfService,
  storage: { readonly objects: Pick<ScopedStorageObjectApi, 'upload'> } | null,
  actorUserId: string | null,
  assertCurrentAuthority: () => Promise<void>,
  assertCurrentAuthoritySync: () => void,
): ScopedPdfService {
  const writer = storage
    ? createScopedPdfStorageWriter(storage)
    : null;
  const methods: ScopedPdfService = {
    async render(input) {
      await assertCurrentAuthority();
      const result = await service.render(input);
      await assertCurrentAuthority();
      return result;
    },
    async renderToStorage(input, target) {
      if (!writer) {
        throw new AuthError(
          'A committed application or tenant scope is required for PDF storage',
          'FORBIDDEN',
          403,
        );
      }
      await assertCurrentAuthority();
      const result = await service.renderToStorage(input, {
        ...target,
        createdBy: actorUserId,
      }, writer);
      return result;
    },
    status() {
      assertCurrentAuthoritySync();
      return service.status();
    },
  };
  return restrictedServiceProxy(service, methods, DENIED_PDF_MEMBERS, 'PDF');
}

function createScopedPdfStorageWriter(
  storage: { readonly objects: Pick<ScopedStorageObjectApi, 'upload'> },
): ZeroPdfStorageWriter {
  const upload: StorageObjectApi['upload'] = (
    driveId,
    path,
    data,
    fileName,
    _userId,
    options,
  ) => storage.objects.upload(driveId, path, data, fileName, options);
  return new ZeroPdfStorageWriter(() => ({ objects: { upload } }));
}
