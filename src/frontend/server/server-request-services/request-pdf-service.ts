import { AuthError } from '../../../auth/types';
import type { PdfService } from '../../../pdf/pdf-service';
import { ZeroPdfStorageWriter } from '../../../pdf/pdf-storage-writer';
import type { StorageService } from '../../../storage/storage-service';
import {
  restrictedServiceProxy,
  type CompleteServiceMemberInventory,
} from './restricted-service-proxy';

type RequestPdfMethods = Pick<PdfService, 'render' | 'renderToStorage' | 'status'>;
type DeniedPdfMember = 'close';

const PDF_SERVICE_INVENTORY: CompleteServiceMemberInventory<
  PdfService,
  keyof RequestPdfMethods,
  DeniedPdfMember
> = true;
void PDF_SERVICE_INVENTORY;

const DENIED_PDF_MEMBERS: ReadonlySet<DeniedPdfMember> = new Set(['close']);

export function createRequestPdfService(
  service: PdfService,
  storage: StorageService | null,
  actorUserId: string | null,
  assertCurrentAuthority: () => Promise<void>,
): RequestPdfMethods {
  const writer = storage ? new ZeroPdfStorageWriter(() => storage) : null;
  const methods: RequestPdfMethods = {
    render: (input) => service.render(input),
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
        createdBy: target.createdBy ?? actorUserId,
      }, writer);
      await assertCurrentAuthority();
      return result;
    },
    status: () => service.status(),
  };
  return restrictedServiceProxy(service, methods, DENIED_PDF_MEMBERS, 'PDF');
}
