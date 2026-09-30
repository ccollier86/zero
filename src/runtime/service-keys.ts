import type { SchedulerService } from '../scheduler/scheduler-service';
import type { NotificationService } from '../notifications/notification-service';
import type { RoomService } from '../rooms/room-service';
import type { KvService } from '../kv/kv-service';
import type { AIService } from '../ai/ai-service';
import type { VectorService } from '../vector/vector-service';
import type { PdfService } from '../pdf/pdf-service';
import type { PlatformTokenService } from '../tokens/token-service';
import type { PlatformTokenStore } from '../tokens/token-store';
import type { ResourceRegistry } from '../resources/resource-registry';
import type { WorkflowRegistry } from '../workflows/workflow-registry';
import type { WorkflowService } from '../workflows/workflow-service';
import type { ReactiveDB } from '../sync/reactive-db';
import type { PlatformSQLiteService } from '../persistence/storage-types';
import type { DatabaseManager } from '../databases/database-manager';
import type { UserStore } from '../auth/user-store';
import type { TokenService } from '../auth/token-service';
import type { EmailRuntime } from '../email/types';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type { StorageService } from '../storage/storage-service';
import type { TenancyService } from '../auth/tenancy';
import type { AuthSessionService } from '../auth/auth-session-service';
import type { AuthorizationKernel } from '../auth/authorization-kernel';
import type { AuthorizationRoleService } from '../auth/authorization-role-service';
import type { AuthAuditService } from '../auth/auth-audit-service';
import type { AuthApiKeyService } from '../auth/auth-api-key-service';
import type { AuthRequestCredentialResolver } from '../auth/auth-api-key-types';
import { createZeroRuntimeServiceKey } from './zero-app-runtime';

export const ZERO_SYNC_DB = createZeroRuntimeServiceKey<ReactiveDB>(
  'Reactive database',
);

export const ZERO_SQLITE_SERVICE = createZeroRuntimeServiceKey<PlatformSQLiteService>(
  'Platform SQLite service',
);

export const ZERO_DATABASE_MANAGER = createZeroRuntimeServiceKey<DatabaseManager>(
  'Database manager',
);

export const ZERO_AUTH_STORE = createZeroRuntimeServiceKey<UserStore>('Auth user store');
export const ZERO_AUTH_TOKEN_SERVICE = createZeroRuntimeServiceKey<TokenService>(
  'Auth token service',
);
export const ZERO_AUTH_API_KEY_SERVICE = createZeroRuntimeServiceKey<AuthApiKeyService>(
  'Guardian API key service',
);
export const ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER =
  createZeroRuntimeServiceKey<AuthRequestCredentialResolver>(
    'Guardian request credential resolver',
  );
export const ZERO_AUTH_TENANCY_SERVICE = createZeroRuntimeServiceKey<TenancyService>(
  'Auth tenancy service',
);
export const ZERO_AUTH_SESSION_SERVICE = createZeroRuntimeServiceKey<AuthSessionService>(
  'Auth durable session service',
);
export const ZERO_AUTHORIZATION_KERNEL = createZeroRuntimeServiceKey<AuthorizationKernel>(
  'Auth authorization kernel',
);
export const ZERO_AUTHORIZATION_ROLE_SERVICE =
  createZeroRuntimeServiceKey<AuthorizationRoleService>(
    'Auth advanced role service',
  );
export const ZERO_AUTH_AUDIT_SERVICE = createZeroRuntimeServiceKey<AuthAuditService>(
  'Auth control-plane audit service',
);
export const ZERO_EMAIL_RUNTIME = createZeroRuntimeServiceKey<EmailRuntime>('Email runtime');
export const ZERO_OBSERVABILITY_RUNTIME =
  createZeroRuntimeServiceKey<PlatformObservabilityRuntime>('Observability runtime');

/** App-local Scheduler service installed by the managed scheduler plugin. */
export const ZERO_SCHEDULER_SERVICE = createZeroRuntimeServiceKey<SchedulerService>(
  'Scheduler service',
);

export const ZERO_NOTIFICATION_SERVICE = createZeroRuntimeServiceKey<NotificationService>(
  'Notification service',
);

export const ZERO_ROOM_SERVICE = createZeroRuntimeServiceKey<RoomService>(
  'Room service',
);

export const ZERO_KV_SERVICE = createZeroRuntimeServiceKey<KvService>(
  'KV service',
);

export const ZERO_AI_SERVICE = createZeroRuntimeServiceKey<AIService>('AI service');
export const ZERO_VECTOR_SERVICE = createZeroRuntimeServiceKey<VectorService>('Vector service');
export const ZERO_PDF_SERVICE = createZeroRuntimeServiceKey<PdfService>('PDF service');
export const ZERO_PLATFORM_TOKEN_SERVICE = createZeroRuntimeServiceKey<PlatformTokenService>(
  'Platform token service',
);
export const ZERO_PLATFORM_TOKEN_STORE = createZeroRuntimeServiceKey<PlatformTokenStore>(
  'Platform token store',
);
export const ZERO_RESOURCE_REGISTRY = createZeroRuntimeServiceKey<ResourceRegistry>(
  'Resource registry',
);

export const ZERO_WORKFLOW_REGISTRY = createZeroRuntimeServiceKey<WorkflowRegistry>(
  'Workflow registry',
);

export const ZERO_WORKFLOW_SERVICE = createZeroRuntimeServiceKey<WorkflowService>(
  'Workflow service',
);

export const ZERO_STORAGE_SERVICE = createZeroRuntimeServiceKey<StorageService>(
  'Storage service',
);
